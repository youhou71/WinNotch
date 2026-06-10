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
 * Budget I/O (audit perf P5) — avant, chaque tick (30 s) relisait
 * INTÉGRALEMENT tous les `.jsonl` modifiés sous 7 jours (`readFile` de
 * fichiers pouvant peser des centaines de Mo). Désormais :
 *  - Résultat mémoïsé 5 min (`ESTIMATE_TTL_MS`) — une estimation grossière
 *    n'a pas besoin de suivre le pollMs de 30 s du statusline.
 *  - Mémo par fichier `{mtime, size, byteOffset, turnTimestamps}` :
 *    fichier inchangé → zéro lecture ; fichier qui a grossi (les .jsonl
 *    Claude sont append-only) → lecture incrémentale du delta depuis
 *    `byteOffset`. La relecture complète ne sert que de repli (troncature).
 *  - Lecture par chunks de 4 MB (jamais tout le fichier en RAM).
 *  - Préfiltre substring avant `JSON.parse` : seules les lignes contenant
 *    `end_turn`/`stop_sequence` sont parsées (élimine > 95 % des parses).
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

/** Durée de validité du résultat complet (découplée du pollMs du service). */
const ESTIMATE_TTL_MS = 5 * 60 * 1000;

/** Taille des blocs de lecture — borne la RAM quel que soit le fichier. */
const READ_CHUNK_BYTES = 4 * 1024 * 1024;

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
 * Mémo par fichier. `byteOffset` pointe toujours juste APRÈS un '\n'
 * consommé (donc sur un début de ligne) — la lecture incrémentale repart
 * de là. `turnTimestamps` garde les fins de tour de la fenêtre 7 j
 * (épuré au fil de l'eau, jamais plus de quelques milliers d'entrées).
 */
interface FileMemo {
  mtimeMs: number;
  size: number;
  byteOffset: number;
  turnTimestamps: number[];
}

const fileMemos = new Map<string, FileMemo>();

let lastEstimate: { at: number; plan: string; result: JsonlEstimate } | null =
  null;

/**
 * Compte les events `type === 'assistant'` dans les fenêtres glissantes
 * et retourne le pourcentage estimé selon le plan.
 *
 * Si `plan === 'unknown'`, le percentage est 0 (impossible à estimer
 * faute de nominal). Le service main affichera alors un état dégradé.
 */
export async function estimateUsageFromJsonl(plan: string): Promise<JsonlEstimate> {
  if (
    lastEstimate &&
    lastEstimate.plan === plan &&
    Date.now() - lastEstimate.at < ESTIMATE_TTL_MS
  ) {
    return lastEstimate.result;
  }

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

  // Épuration des mémos de fichiers définitivement sortis de la fenêtre
  // 7 j (ils ne peuvent plus contribuer ; sans ça la Map grossirait au fil
  // des sessions).
  for (const [file, memo] of fileMemos) {
    if (memo.mtimeMs < since7d) fileMemos.delete(file);
  }

  const nominal5h = PLAN_NOMINAL_5H[plan] ?? 0;
  const nominal7d = PLAN_NOMINAL_7D[plan] ?? 0;

  const result: JsonlEstimate = {
    fiveH: {
      assistantTurns: count5h,
      percent: nominal5h > 0 ? clamp(100 * count5h / nominal5h, 0, 100) : 0,
    },
    weekly: {
      assistantTurns: count7d,
      percent: nominal7d > 0 ? clamp(100 * count7d / nominal7d, 0, 100) : 0,
    },
  };
  lastEstimate = { at: Date.now(), plan, result };
  return result;
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
      const timestamps = await getFileTurnTimestamps(
        full,
        { mtimeMs: stat.mtimeMs, size: stat.size },
        since7d,
      );
      for (const ts of timestamps) {
        if (ts < since7d) continue;
        onAssistantTurn(ts >= since5h, true);
      }
    }
  }
}

/**
 * Retourne les timestamps de fin de tour d'un fichier, via le mémo :
 *  - mtime+size inchangés → zéro lecture, on ressert le mémo ;
 *  - fichier qui a grossi → lecture incrémentale du delta (append-only) ;
 *  - sinon (troncature, réécriture) → relecture complète.
 */
async function getFileTurnTimestamps(
  file: string,
  stat: { mtimeMs: number; size: number },
  since7d: number,
): Promise<number[]> {
  const memo = fileMemos.get(file);

  if (memo && memo.mtimeMs === stat.mtimeMs && memo.size === stat.size) {
    return memo.turnTimestamps;
  }

  if (memo && stat.size >= memo.byteOffset) {
    const delta = await readTurnTimestamps(file, memo.byteOffset, stat.size);
    if (delta) {
      memo.turnTimestamps = [...memo.turnTimestamps, ...delta.timestamps].filter(
        (ts) => ts >= since7d,
      );
      memo.byteOffset = delta.nextOffset;
      memo.mtimeMs = stat.mtimeMs;
      memo.size = stat.size;
      return memo.turnTimestamps;
    }
  }

  const whole = await readTurnTimestamps(file, 0, stat.size);
  if (!whole) {
    fileMemos.delete(file);
    return [];
  }
  const turnTimestamps = whole.timestamps.filter((ts) => ts >= since7d);
  fileMemos.set(file, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    byteOffset: whole.nextOffset,
    turnTimestamps,
  });
  return turnTimestamps;
}

/**
 * Lit `[fromOffset, size)` par chunks et extrait les timestamps des fins
 * de tour. Ne consomme que des lignes COMPLÈTES : la dernière ligne peut
 * être en cours d'écriture par Claude Code, le reliquat après le dernier
 * '\n' sera relu au prochain passage (`nextOffset` s'arrête au '\n').
 * Retourne `null` en cas d'erreur d'I/O (l'appelant retombera sur une
 * relecture complète au tick suivant).
 */
async function readTurnTimestamps(
  file: string,
  fromOffset: number,
  size: number,
): Promise<{ timestamps: number[]; nextOffset: number } | null> {
  if (size <= fromOffset) {
    return { timestamps: [], nextOffset: fromOffset };
  }
  const timestamps: number[] = [];
  let carry: Buffer = Buffer.alloc(0);
  let consumedUpTo = fromOffset;
  try {
    const fh = await fs.open(file, 'r');
    try {
      for (let pos = fromOffset; pos < size; pos += READ_CHUNK_BYTES) {
        const len = Math.min(READ_CHUNK_BYTES, size - pos);
        const chunk = Buffer.alloc(len);
        const { bytesRead } = await fh.read(chunk, 0, len, pos);
        if (bytesRead <= 0) break;
        const data = carry.length
          ? Buffer.concat([carry, chunk.subarray(0, bytesRead)])
          : chunk.subarray(0, bytesRead);
        // Découpe au dernier '\n' : la fin (ligne incomplète ou coupée par
        // le chunk) repart dans `carry` pour le bloc suivant.
        const lastNl = data.lastIndexOf(0x0a);
        if (lastNl < 0) {
          carry = data;
          continue;
        }
        collectTimestamps(data.subarray(0, lastNl + 1).toString('utf8'), timestamps);
        carry = Buffer.from(data.subarray(lastNl + 1));
        consumedUpTo = pos + bytesRead - carry.length;
      }
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
  return { timestamps, nextOffset: consumedUpTo };
}

/** Parse les lignes complètes d'un bloc et pousse les fins de tour. */
function collectTimestamps(text: string, out: number[]): void {
  for (const line of text.split('\n')) {
    if (!line) continue;
    // Préfiltre : un event de fin de tour contient forcément la valeur de
    // son stop_reason en clair. Élimine > 95 % des JSON.parse (chunks
    // tool_use, messages partiels, events système). Les faux positifs
    // (la chaîne apparaît dans un contenu) sont éliminés par le check
    // structuré ci-dessous.
    if (!line.includes('end_turn') && !line.includes('stop_sequence')) continue;
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
    out.push(ts);
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
