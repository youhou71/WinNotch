/**
 * Analyse des tâches par Claude Code, en arrière-plan.
 *
 * Principe : WinNotch lance `claude -p` (mode non interactif, sans terminal)
 * sur un **lot** de tâches actives, avec une sortie JSON contrainte par
 * `--json-schema`. Claude renvoie, pour chaque tâche, un résumé d'une ligne
 * et une conclusion Markdown ; c'est WinNotch qui écrit les fichiers
 * (`<moduleConfig.tasks.conclusionsDir>/<id>.md`) et met à jour `Task.analysis`.
 *
 * Pourquoi ne pas laisser Claude écrire lui-même ? Deux raisons :
 *  - `config.json` est tenu par electron-store : une écriture concurrente
 *    depuis un autre process écraserait ou serait écrasée ;
 *  - Claude n'a alors besoin d'AUCUN outil d'écriture — on ne lui autorise
 *    que de la lecture (web + fichiers locaux cités dans une tâche).
 *
 * Déclenchement :
 *  - automatique (réglage `moduleConfig.tasks.autoAnalyze`) : 2 min après le
 *    dernier ajout / changement de libellé, pour qu'une rafale d'ajouts
 *    parte dans un seul lot (un seul process, un seul chargement de contexte) ;
 *  - manuel : bouton « Analyser » de la vue tâches (`analyzeNow`).
 *
 * Une seule analyse à la fois. Une tâche éditée PENDANT l'analyse garde
 * `analyzedText` = l'ancien libellé → elle repart au lot suivant.
 */
import { spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { basename, isAbsolute, join } from 'path';
import { app } from 'electron';
import type { Task } from '../../../shared/types';
import { needsAnalysis } from '../../../shared/tasks';
import {
  getConfiguredConclusionsDir,
  getTasks,
  isAutoAnalyzeEnabled,
  patchTasks,
} from './tasksService';

/** Délai de regroupement après le dernier ajout (analyse automatique). */
const DEBOUNCE_MS = 2 * 60_000;
/** Relance rapide quand un lot plafonné laisse des tâches en attente. */
const FOLLOW_UP_MS = 5_000;
/** Au-delà, le process est tué et le lot passe en erreur. */
const RUN_TIMEOUT_MS = 15 * 60_000;
/** Taille max d'un lot : au-delà, les conclusions deviennent superficielles. */
const MAX_BATCH = 8;

/** Outils en lecture seule accordés à Claude (aucune écriture possible). */
const ALLOWED_TOOLS = 'WebSearch WebFetch Read Glob Grep';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          summary: { type: 'string' },
          markdown: { type: 'string' },
        },
        required: ['id', 'summary', 'markdown'],
      },
    },
  },
  required: ['items'],
};

interface AnalysisItem {
  id: string;
  summary: string;
  markdown: string;
}

let timer: NodeJS.Timeout | null = null;
let child: ChildProcess | null = null;
let running = false;

/**
 * Dossier des conclusions : réglage utilisateur s'il est absolu, sinon
 * `<userData>/task-conclusions`. Relu à chaque lot (modifiable à chaud) ;
 * les conclusions déjà écrites restent où elles sont (`conclusionPath`).
 */
function conclusionsDir(): string {
  const configured = getConfiguredConclusionsDir();
  return configured && isAbsolute(configured)
    ? configured
    : join(app.getPath('userData'), 'task-conclusions');
}

function candidates(force: boolean): Task[] {
  return getTasks().filter((t) => needsAnalysis(t, force));
}

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * Planifie une analyse automatique (appelé à chaque ajout / édition).
 * Chaque appel repousse l'échéance : c'est le dernier ajout qui compte.
 */
export function scheduleAnalysis(delayMs = DEBOUNCE_MS): void {
  if (!isAutoAnalyzeEnabled()) return;
  if (candidates(false).length === 0) return;
  clearTimer();
  timer = setTimeout(() => {
    timer = null;
    // Réglage relu à l'échéance : il a pu être coupé entre-temps.
    // Si une analyse tourne encore, `runBatch` replanifiera à sa fin.
    if (!running && isAutoAnalyzeEnabled()) void runBatch(false);
  }, delayMs);
}

/** Bouton « Analyser » : immédiat, inclut les tâches en erreur. */
export function analyzeNow(): { ok: boolean; error?: string } {
  if (running) return { ok: false, error: 'Une analyse est déjà en cours' };
  if (candidates(true).length === 0) {
    return { ok: false, error: 'Aucune tâche à analyser' };
  }
  clearTimer();
  void runBatch(true);
  return { ok: true };
}

/**
 * Supprime les conclusions Markdown des tâches retirées de la liste.
 * Best-effort, et uniquement un fichier nommé `<id-de-la-tâche>.md` : un
 * chemin arbitraire (config.json édité à la main) n'est jamais supprimé.
 * Le contrôle porte sur le nom et non sur le dossier, qui a pu changer
 * depuis l'écriture.
 */
export function discardConclusions(tasks: Task[]): void {
  for (const t of tasks) {
    const p = t.analysis?.conclusionPath;
    if (!p || basename(p) !== `${t.id}.md`) continue;
    try {
      unlinkSync(p);
    } catch {
      // Déjà supprimé ou verrouillé (ouvert dans un éditeur) : sans gravité.
    }
  }
}

/** Au démarrage : répare les analyses interrompues puis relance si besoin. */
export function startAnalyzer(): void {
  const interrupted = getTasks()
    .filter((t) => t.analysis?.status === 'running')
    .map((t) => t.id);
  if (interrupted.length > 0) {
    // `analyzedText` effacé → la tâche repasse candidate automatiquement.
    patchTasks(interrupted, (t) => ({
      ...t,
      analysis: {
        ...t.analysis!,
        status: 'error',
        analyzedText: undefined,
        error: 'Analyse interrompue (WinNotch fermé)',
      },
    }));
  }
  scheduleAnalysis();
}

export function stopAnalyzer(): void {
  clearTimer();
  if (child && !child.killed) child.kill();
  child = null;
}

async function runBatch(force: boolean): Promise<void> {
  const all = candidates(force);
  if (all.length === 0) return;
  const batch = all.slice(0, MAX_BATCH);
  const ids = batch.map((t) => t.id);
  /** Libellés tels qu'envoyés à Claude (référence pour `analyzedText`). */
  const sentText = new Map(batch.map((t) => [t.id, t.text]));

  running = true;
  patchTasks(ids, (t) => ({
    ...t,
    analysis: { ...t.analysis, status: 'running', error: undefined },
  }));

  try {
    const dir = conclusionsDir();
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      throw new Error(`Dossier des conclusions inaccessible : ${dir}`);
    }
    const items = await runClaude(buildPrompt(batch), dir);
    const byId = new Map(items.map((i) => [i.id, i]));
    const now = Date.now();

    patchTasks(ids, (t) => {
      const item = byId.get(t.id);
      const analyzedText = sentText.get(t.id);
      if (!item) {
        return {
          ...t,
          analysis: {
            ...t.analysis,
            status: 'error',
            analyzedAt: now,
            analyzedText,
            error: "Claude n'a pas renvoyé de conclusion pour cette tâche",
          },
        };
      }
      const path = join(dir, `${t.id}.md`);
      writeFileSync(
        path,
        renderMarkdown(analyzedText ?? t.text, item, now),
        'utf-8',
      );
      return {
        ...t,
        analysis: {
          status: 'done',
          analyzedAt: now,
          analyzedText,
          conclusionPath: path,
          summary: item.summary.trim(),
        },
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const now = Date.now();
    // La conclusion précédente (si elle existe) reste consultable.
    patchTasks(ids, (t) => ({
      ...t,
      analysis: {
        ...t.analysis,
        status: 'error',
        analyzedAt: now,
        analyzedText: sentText.get(t.id),
        error: message,
      },
    }));
  } finally {
    running = false;
    child = null;
  }

  // Reliquat (lot plafonné, ou ajouts pendant l'analyse) : on enchaîne.
  if (isAutoAnalyzeEnabled() && candidates(false).length > 0) {
    scheduleAnalysis(FOLLOW_UP_MS);
  }
}

function buildPrompt(batch: Task[]): string {
  const batchIds = new Set(batch.map((t) => t.id));
  const others = getTasks().filter((t) => !t.done && !batchIds.has(t.id));
  const today = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return [
    "Tu analyses des tâches issues de la liste de tâches personnelle de l'utilisateur (application WinNotch).",
    'Pour CHAQUE tâche à analyser, produis une conclusion utile et actionnable.',
    '',
    'Tu peux utiliser WebSearch / WebFetch pour te documenter, et Read / Glob / Grep si une tâche cite un fichier ou un dossier local. Ne modifie rien.',
    '',
    'Pour chaque tâche, renvoie :',
    "- id : l'identifiant fourni entre crochets, recopié à l'identique ;",
    '- summary : la conclusion en une phrase (140 caractères maximum) ;',
    '- markdown : la conclusion complète, en français, SANS titre de niveau 1, structurée en sections `##` : Compréhension (ce qui est demandé, hypothèses retenues), Analyse, Prochaines étapes (liste ordonnée et concrète), Questions ouvertes (seulement s’il y en a).',
    'Adapte la longueur à la tâche : une tâche triviale mérite quelques lignes, pas une dissertation.',
    '',
    `Date du jour : ${today}.`,
    '',
    'Tâches à analyser :',
    ...batch.map((t) => `- [${t.id}] ${t.text}`),
    ...(others.length > 0
      ? [
          '',
          'Autres tâches actives (contexte seulement — ne pas les analyser) :',
          ...others.map((t) => `- ${t.text}`),
        ]
      : []),
  ].join('\n');
}

function renderMarkdown(text: string, item: AnalysisItem, at: number): string {
  const when = new Date(at).toLocaleString('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
  });
  return [
    `# ${text}`,
    '',
    `> Analysée par Claude Code le ${when} · WinNotch`,
    '',
    `**En bref** : ${item.summary.trim()}`,
    '',
    item.markdown.trim(),
    '',
  ].join('\n');
}

/**
 * Binaire natif de Claude Code (installeur officiel) s'il existe, sinon
 * `claude` résolu via le PATH. Sans shell, seul un `.exe` est trouvable :
 * une installation npm (`claude.cmd`) n'est pas prise en charge.
 */
function claudeExecutable(): string {
  const native = join(homedir(), '.local', 'bin', 'claude.exe');
  return existsSync(native) ? native : 'claude';
}

function runClaude(prompt: string, cwd: string): Promise<AnalysisItem[]> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(
      claudeExecutable(),
      [
        '-p',
        '--output-format',
        'json',
        '--json-schema',
        JSON.stringify(OUTPUT_SCHEMA),
        '--no-session-persistence',
        '--allowedTools',
        ALLOWED_TOOLS,
      ],
      { cwd, windowsHide: true, shell: false },
    );
    child = proc;

    let stdout = '';
    let stderr = '';
    proc.stdout.setEncoding('utf-8');
    proc.stderr.setEncoding('utf-8');
    proc.stdout.on('data', (d: string) => (stdout += d));
    proc.stderr.on('data', (d: string) => (stderr += d));

    const killTimer = setTimeout(() => {
      proc.kill();
      reject(new Error("Délai dépassé (15 min) — l'analyse a été abandonnée"));
    }, RUN_TIMEOUT_MS);

    proc.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(killTimer);
      reject(
        new Error(
          err.code === 'ENOENT'
            ? 'Claude Code introuvable (claude.exe absent du PATH)'
            : err.message,
        ),
      );
    });

    proc.on('close', (code) => {
      clearTimeout(killTimer);
      try {
        resolvePromise(parseOutput(stdout));
      } catch (err) {
        const detail = stderr.trim().split('\n').pop() || `code ${code}`;
        reject(
          new Error(
            `${err instanceof Error ? err.message : String(err)} (${detail})`,
          ),
        );
      }
    });

    // Le prompt passe par stdin : pas de limite de longueur de ligne de
    // commande ni d'échappement à gérer.
    proc.stdin.end(prompt, 'utf-8');
  });
}

/**
 * Extrait les items de la sortie `--output-format json` de `claude -p` :
 * un unique objet `result`, dont `structured_output` porte le JSON validé
 * contre le schéma. On prend la dernière ligne JSON par sécurité (un
 * éventuel message parasite avant ne doit pas casser le parsing).
 */
function parseOutput(stdout: string): AnalysisItem[] {
  const line = stdout
    .trim()
    .split('\n')
    .reverse()
    .find((l) => l.trim().startsWith('{'));
  if (!line) throw new Error('Réponse vide de Claude Code');
  const out = JSON.parse(line) as {
    is_error?: boolean;
    result?: string;
    structured_output?: { items?: unknown };
  };
  if (out.is_error) {
    throw new Error(out.result?.slice(0, 200) || 'Claude Code a échoué');
  }
  const items = out.structured_output?.items;
  if (!Array.isArray(items)) throw new Error('Réponse de Claude Code invalide');
  return items.filter(
    (i): i is AnalysisItem =>
      !!i &&
      typeof i.id === 'string' &&
      typeof i.summary === 'string' &&
      typeof i.markdown === 'string',
  );
}
