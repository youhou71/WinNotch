/**
 * Parser des fichiers .jsonl de session Claude Code.
 *
 * Format observé (Claude Code v2.x) :
 *  - Un fichier `<sessionId>.jsonl` par session, append-only
 *  - Chaque ligne = un event JSON avec `type`, `timestamp`, `cwd`,
 *    `gitBranch`, `slug`, `sessionId`, et `message` (pour les assistant/user)
 *
 * Stratégie :
 *  - On lit **les N derniers events** (tail) pour rester rapide même sur
 *    des sessions à plusieurs MB. 50 events suffisent pour déterminer
 *    statut + texte courant + tokens cumulés récents.
 *  - Le statut est dérivé de la mtime + dernier event (cf. computeStatus).
 *  - Les tokens cumulés sont sommés sur la fenêtre lue (approximation
 *    suffisante pour l'UI ; le total exact nécessiterait de parser tout
 *    le fichier).
 */
import { promises as fs, statSync, readFileSync } from 'fs';
import { basename } from 'path';
import type { ClaudeSession, ClaudeSessionStatus } from '../../../shared/types';

interface JsonlEvent {
  type?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  slug?: string;
  sessionId?: string;
  message?: {
    model?: string;
    role?: string;
    stop_reason?: string;
    content?: Array<{
      type?: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    usage?: {
      output_tokens?: number;
      input_tokens?: number;
    };
  };
}

/** Nombre d'events à conserver pour l'analyse (tail). */
const TAIL_LINES = 50;

/**
 * Tools qui exigent une action manuelle de l'utilisateur avant que
 * Claude puisse reprendre. Tant que leur `tool_result` n'est pas écrit
 * dans le .jsonl, Claude est en attente — exactement comme `end_turn`.
 */
const USER_INPUT_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

/**
 * Détermine si le dernier tour assistant (depuis le dernier message
 * utilisateur humain) contient au moins un `tool_use` d'exécution.
 *
 * Distingue un tour productif (Bash, Read, Write, Edit, Grep, …) d'un
 * tour purement conversationnel (récap, explication, simple réponse
 * texte). Sert à filtrer le toast "Session terminée" pour qu'il ne se
 * déclenche pas après chaque message de Claude.
 *
 * Un message `user` côté JSONL peut être :
 *  - un vrai message humain (contenu = string ou array avec au moins un
 *    `type: 'text'`) → marque le début d'un nouveau tour
 *  - un wrapper de `tool_result` (uniquement `type: 'tool_result'` dans
 *    le content) → réponse à un tool_use de Claude, pas un message humain
 *
 * Les `tool_use` AskUserQuestion / ExitPlanMode sont ignorés ici (ils
 * déclenchent leur propre toast "En attente de ta réponse").
 */
function lastTurnHadWork(events: JsonlEvent[]): boolean {
  let humanIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type !== 'user') continue;
    const content = ev.message?.content;
    if (!Array.isArray(content)) {
      // content string ou absent → considéré comme message humain dès lors
      // que c'est un event user.
      humanIdx = i;
      break;
    }
    const hasNonToolResult = content.some((c) => c.type !== 'tool_result');
    if (hasNonToolResult) {
      humanIdx = i;
      break;
    }
  }
  for (let i = humanIdx + 1; i < events.length; i++) {
    const ev = events[i];
    if (ev.type !== 'assistant') continue;
    const content = ev.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (
        c.type === 'tool_use' &&
        c.name &&
        !USER_INPUT_TOOLS.has(c.name)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Détecte si Claude attend une réponse explicite de l'utilisateur via
 * `AskUserQuestion` / `ExitPlanMode`.
 *
 * Stratégie en 2 passes :
 *  1. On cherche le dernier tool_use d'un nom dans `USER_INPUT_TOOLS`.
 *     Les events `assistant` peuvent être suivis par des events système
 *     (`last-prompt`, `ai-title`, `agent-name`, `permission-mode`,
 *     `file-history-snapshot`, etc.) qui n'invalident pas l'attente —
 *     on parcourt donc à l'envers en ignorant les events sans `content`
 *     array (= events non-conversation).
 *  2. On vérifie qu'aucun `tool_result` n'a été écrit APRÈS cet event.
 *     Le tool_result est la réponse de l'utilisateur ; sa présence signifie
 *     que la question a été traitée.
 */
function isWaitingForUserInput(events: JsonlEvent[]): boolean {
  let lastAskIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const content = events[i].message?.content;
    if (!Array.isArray(content)) continue;
    let found = false;
    for (let j = content.length - 1; j >= 0; j--) {
      const c = content[j];
      if (c.type === 'tool_use' && c.name && USER_INPUT_TOOLS.has(c.name)) {
        lastAskIdx = i;
        found = true;
        break;
      }
    }
    if (found) break;
    // Si on a croisé un autre tool_use (Bash, Read, etc.) avant un
    // user-input tool, ce n'est pas une attente utilisateur.
    if (
      content.some(
        (c) =>
          c.type === 'tool_use' &&
          c.name &&
          !USER_INPUT_TOOLS.has(c.name),
      )
    ) {
      return false;
    }
  }
  if (lastAskIdx < 0) return false;

  // Cherche un tool_result après — = l'utilisateur a déjà répondu.
  for (let i = lastAskIdx + 1; i < events.length; i++) {
    const content = events[i].message?.content;
    if (!Array.isArray(content)) continue;
    if (content.some((c) => c.type === 'tool_result')) {
      return false;
    }
  }
  return true;
}

/**
 * Tail synchrone d'un fichier — lit les derniers N "lignes" (events).
 * Approche pragmatique : on charge depuis la fin par bloc de 256 KB
 * jusqu'à avoir assez de retours à la ligne. Suffisant pour les
 * fichiers Claude qui peuvent atteindre quelques MB.
 */
function tailLines(filePath: string, maxLines: number): string[] {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return [];
  }
  if (stat.size === 0) return [];

  // Pour les fichiers < 512 KB on lit tout — pas de différence perf
  // et c'est plus simple que la gymnastique de buffer-tail.
  const SMALL_FILE_LIMIT = 512 * 1024;
  if (stat.size <= SMALL_FILE_LIMIT) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const all = content.split(/\r?\n/).filter(Boolean);
      return all.slice(-maxLines);
    } catch {
      return [];
    }
  }

  // Fichier plus gros : on lit les 512 KB de fin (assez pour > 50 events).
  try {
    const buf = Buffer.alloc(SMALL_FILE_LIMIT);
    const fd = require('fs').openSync(filePath, 'r');
    try {
      require('fs').readSync(
        fd,
        buf,
        0,
        SMALL_FILE_LIMIT,
        stat.size - SMALL_FILE_LIMIT,
      );
    } finally {
      require('fs').closeSync(fd);
    }
    const content = buf.toString('utf8');
    // On jette la première "demi-ligne" tronquée par le slice.
    const lines = content.split(/\r?\n/).slice(1).filter(Boolean);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

/**
 * Détermine le statut d'une session selon la fraîcheur du fichier
 * et le dernier event.
 *
 * Deux régimes selon le `stop_reason` du dernier event `assistant` :
 *
 * 1. `end_turn` — Claude a explicitement fini son tour, le `.jsonl` ne
 *    sera plus touché tant que l'utilisateur ne reprend pas. On peut
 *    donc considérer la session "waiting" très rapidement après le
 *    write (3 s de garde pour laisser le file flush se terminer).
 *
 * 2. autre (`tool_use`, `max_tokens`, etc.) — Claude est encore actif
 *    entre deux events (exécution d'un tool, par exemple). Le fichier
 *    est silencieux temporairement, on garde le seuil 30 s pour ne pas
 *    déclencher de faux toast "session terminée" entre deux outils.
 *
 * Seuils communs au-delà :
 *  - 3 s à 5 min  : waiting (Claude attend l'utilisateur)
 *  - 5 min à 60 min : idle  (session ouverte mais inactive)
 *  - > 60 min     : done   (session probablement fermée)
 */
function computeStatus(
  mtimeMs: number,
  lastAssistantEvent: JsonlEvent | null,
  waitingForInput: boolean,
): ClaudeSessionStatus {
  const ageMs = Date.now() - mtimeMs;
  const stop = lastAssistantEvent?.message?.stop_reason;
  // Deux cas qui signifient "Claude a la main à l'utilisateur" et le
  // .jsonl ne sera plus touché tant que l'utilisateur ne reprend pas :
  //  - stop_reason === 'end_turn' : tour fini normalement
  //  - tool_use AskUserQuestion / ExitPlanMode : attend une réponse manuelle
  const ended = stop === 'end_turn' || waitingForInput;

  if (ended) {
    // 3 s de garde pour laisser le file write se stabiliser, puis on
    // bascule immédiatement en waiting.
    if (ageMs < 3_000) return 'working';
  } else {
    // Tool automatique en cours (Bash, Read, etc.) — garde longue pour
    // absorber les pauses entre outils sans déclencher de faux toast.
    if (ageMs < 30_000) return 'working';
  }

  if (ageMs < 5 * 60_000) return ended ? 'waiting' : 'working';
  if (ageMs < 60 * 60_000) return 'idle';
  return 'done';
}

/**
 * Extrait un texte court résumant la dernière action :
 *  - tool_use : "Bash · ls /…", "Write · src/foo.ts"
 *  - text : les ~80 premiers chars du dernier message texte
 *  - user message : "[message utilisateur]"
 */
function extractCurrentText(events: JsonlEvent[]): string {
  // On parcourt à l'envers pour trouver le contenu le plus récent
  // exploitable.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const content = ev.message?.content;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const c = content[j];
      if (c.type === 'tool_use' && c.name) {
        const inputDesc = c.input?.description ?? c.input?.command ?? c.input?.file_path;
        const detail = typeof inputDesc === 'string' ? inputDesc : '';
        const truncated = detail.length > 60 ? detail.slice(0, 57) + '…' : detail;
        return truncated ? `${c.name} · ${truncated}` : c.name;
      }
      if (c.type === 'text' && c.text) {
        const flat = c.text.replace(/\s+/g, ' ').trim();
        return flat.length > 80 ? flat.slice(0, 77) + '…' : flat;
      }
    }
  }
  return '';
}

/**
 * Parse un fichier de session et retourne un `ClaudeSession`.
 * Renvoie `null` si le fichier est inexploitable (vide, corrompu).
 */
export async function parseSessionFile(
  filePath: string,
): Promise<ClaudeSession | null> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size === 0) return null;

  const lines = tailLines(filePath, TAIL_LINES);
  if (lines.length === 0) return null;

  const events: JsonlEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // Ligne partielle ou corrompue — on saute.
    }
  }
  if (events.length === 0) return null;

  const last = events[events.length - 1];
  const sessionId =
    last.sessionId ?? basename(filePath, '.jsonl');
  // Les events `user` (tool_result) n'ont pas de champ `cwd` ni
  // `gitBranch` ni `slug` — seuls les events `assistant` les portent.
  // On rétro-cherche le dernier event qui les contient pour ne pas
  // tomber sur des champs vides.
  const lastWithMeta =
    [...events].reverse().find((e) => e.cwd || e.gitBranch || e.slug) ?? last;
  const cwd = lastWithMeta.cwd ?? '';
  const project = cwd ? basename(cwd) : sessionId.slice(0, 8);
  const branch = lastWithMeta.gitBranch ?? '';
  const slug = lastWithMeta.slug ?? '';
  const lastActivity = last.timestamp ?? new Date(stat.mtimeMs).toISOString();
  const model = last.message?.model ?? lastWithMeta.message?.model ?? '';

  // Cumul des output_tokens sur la fenêtre lue.
  let tokens = 0;
  let lastAssistant: JsonlEvent | null = null;
  for (const ev of events) {
    if (ev.message?.usage?.output_tokens) {
      tokens += ev.message.usage.output_tokens;
    }
    if (ev.type === 'assistant') lastAssistant = ev;
  }

  const waitingForInput = isWaitingForUserInput(events);
  const status = computeStatus(stat.mtimeMs, lastAssistant, waitingForInput);
  const currentText = extractCurrentText(events);
  const hadWork = lastTurnHadWork(events);

  return {
    id: sessionId,
    project,
    cwd,
    branch,
    slug,
    status,
    currentText,
    tokens,
    lastActivity,
    model,
    waitingForInput,
    lastTurnHadWork: hadWork,
  };
}
