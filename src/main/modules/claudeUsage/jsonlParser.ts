/**
 * Fallback : estimation de l'usage Claude par parsing local des `.jsonl`
 * dans `~/.claude/projects/`.
 *
 * Utilisé quand le statusline WinNotch n'a jamais tourné OU quand son
 * cache est trop vieux. Approche :
 *
 *  1. On scanne récursivement `~/.claude/projects/` à la recherche de
 *     `.jsonl` modifiés dans la fenêtre considérée (5 h ou 7 j).
 *  2. Pour chaque fichier, on compte les events `type === 'assistant'`
 *     **avec `message.stop_reason === 'end_turn'`** (un seul par tour
 *     utilisateur — les chunks intermédiaires `tool_use`, `null`,
 *     `stop_sequence` ne sont pas comptés). C'est l'événement qui
 *     reflète la consommation d'un quota côté Anthropic.
 *  3. Le pourcentage est calculé par rapport à un nominal hardcodé par
 *     plan (approximation, sera plus précis quand le statusline aura
 *     tourné au moins une fois).
 *
 * Cette estimation est volontairement grossière — son but est juste
 * d'éviter d'afficher des barres vides en attendant le premier turn.
 * Le statusline est la source de vérité.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Nominal de "messages" par fenêtre pour chaque plan. Ces chiffres sont
 * des ordres de grandeur communiqués par Anthropic dans le centre d'aide
 * (https://support.claude.com — articles "Usage limit best practices").
 * Ils servent uniquement à dériver un pourcentage estimé.
 *
 * Plans équipe : Team Standard est aligné sur Pro par seat ; Team Premium
 * est aligné sur Max 5× par seat. Les deux paires sont fusionnées sous un
 * même identifiant (`pro` / `max5x`) — cf. `ClaudeUsagePlan` dans
 * `shared/types.ts`. Le statusline reste la source de vérité, ces
 * nominaux ne sont qu'un repli quand le wrapper n'a jamais tourné.
 */
const PLAN_NOMINAL_5H: Record<string, number> = {
  pro: 45,
  max5x: 225,
  max20x: 900,
};
const PLAN_NOMINAL_7D: Record<string, number> = {
  pro: 1000,
  max5x: 5000,
  max20x: 20_000,
};

export interface JsonlEstimate {
  fiveH: { percent: number; assistantTurns: number };
  weekly: { percent: number; assistantTurns: number };
}

/**
 * Compte les events `type === 'assistant'` dans les fenêtres glissantes
 * et retourne le pourcentage estimé selon le plan.
 *
 * Si `plan === 'unknown'`, le percentage est 0 (impossible à estimer
 * faute de nominal). Le service main affichera alors un état dégradé.
 */
export async function estimateUsageFromJsonl(plan: string): Promise<JsonlEstimate> {
  const now = Date.now();
  const since5h = now - FIVE_HOURS_MS;
  const since7d = now - SEVEN_DAYS_MS;

  let count5h = 0;
  let count7d = 0;

  try {
    await walkAndCount(PROJECTS_DIR, since5h, since7d, (in5h, in7d) => {
      if (in7d) count7d += 1;
      if (in5h) count5h += 1;
    });
  } catch {
    // Dossier inexistant ou erreur d'accès → tout reste à 0.
  }

  const nominal5h = PLAN_NOMINAL_5H[plan] ?? 0;
  const nominal7d = PLAN_NOMINAL_7D[plan] ?? 0;

  return {
    fiveH: {
      assistantTurns: count5h,
      percent: nominal5h > 0 ? clamp(100 * count5h / nominal5h, 0, 100) : 0,
    },
    weekly: {
      assistantTurns: count7d,
      percent: nominal7d > 0 ? clamp(100 * count7d / nominal7d, 0, 100) : 0,
    },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

async function walkAndCount(
  dir: string,
  since5h: number,
  since7d: number,
  onAssistantTurn: (in5h: boolean, in7d: boolean) => void,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkAndCount(full, since5h, since7d, onAssistantTurn);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      let stat;
      try {
        stat = await fs.stat(full);
      } catch {
        continue;
      }
      // Heuristique d'évitement : si la mtime est plus vieille que 7 j,
      // aucun event utile ne peut s'y trouver pour notre fenêtre.
      if (stat.mtimeMs < since7d) continue;
      await scanFile(full, since5h, since7d, onAssistantTurn);
    }
  }
}

async function scanFile(
  file: string,
  since5h: number,
  since7d: number,
  onAssistantTurn: (in5h: boolean, in7d: boolean) => void,
): Promise<void> {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || event.type !== 'assistant') continue;
    // On ne compte QUE les events qui marquent la fin d'un tour
    // utilisateur. Claude Code écrit un event `assistant` par chunk de
    // réponse (tool_use intermédiaire, message partiel, etc.) — si on
    // les comptait tous, un seul "tour" pourrait apparaître comme
    // 30 messages dans le fallback. `stop_reason === 'end_turn'` est
    // l'indicateur fiable d'un tour fini côté Claude. On accepte aussi
    // `stop_sequence` qui apparaît plus rarement mais clôt un tour.
    const stop = event.message?.stop_reason;
    if (stop !== 'end_turn' && stop !== 'stop_sequence') continue;
    const ts = parseTimestamp(event.timestamp ?? event.created_at ?? event.ts);
    if (!ts) continue;
    if (ts < since7d) continue;
    onAssistantTurn(ts >= since5h, true);
  }
}

function parseTimestamp(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v < 1e11 ? v * 1000 : v;
  }
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}
