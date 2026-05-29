/**
 * Lecture du cache statusline WinNotch.
 *
 * Le wrapper `resources/winnotch-statusline.cjs`, installé dans
 * `~/.claude/settings.json` via `statuslineInstaller.ts`, écrit ce fichier
 * à chaque turn de Claude Code. Il contient les `rate_limits` exposés par
 * Claude Code depuis sa v1.2.80.
 *
 * Format produit par le wrapper :
 * ```json
 * {
 *   "capturedAt": 1739000000000,
 *   "rate_limits": {
 *     "5h":  { "used_percentage": 12.3, "resets_at": 1739010000000 },
 *     "7d":  { "used_percentage":  4.2, "resets_at": 1739600000000 }
 *   },
 *   "session_id": "...",
 *   "model": "claude-opus-4-7"
 * }
 * ```
 *
 * Les timestamps `resets_at` côté Claude Code sont en **secondes** ou **ms**
 * selon les versions — on normalise systématiquement en ms.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const USAGE_CACHE_PATH = path.join(os.homedir(), '.claude', 'winnotch-usage.json');

export interface StatuslineCacheWindow {
  percent: number;
  resetsAt: number;
}

export interface StatuslineCache {
  capturedAt: number;
  fiveH: StatuslineCacheWindow | null;
  weekly: StatuslineCacheWindow | null;
}

/**
 * Lit et parse le cache. Retourne `null` si :
 *  - le fichier n'existe pas
 *  - il est trop vieux (au-delà de `maxAgeMs`) — on considère qu'il
 *    n'est plus pertinent
 *  - il est corrompu / le schéma a changé
 *
 * `maxAgeMs` est volontairement large (typiquement 7 j) : la péremption
 * logique d'une valeur d'usage est portée par son champ `resetsAt`, pas
 * par la mtime du fichier. Tant que la fenêtre n'a pas reset, le
 * `used_percentage` reste valide même si Claude Code n'a pas tourné
 * depuis plusieurs heures (la conso ne peut que monter). Le service
 * main gère la rotation post-reset.
 */
export async function readStatuslineCache(maxAgeMs: number): Promise<StatuslineCache | null> {
  let stat;
  try {
    stat = await fs.stat(USAGE_CACHE_PATH);
  } catch {
    return null;
  }

  if (Date.now() - stat.mtimeMs > maxAgeMs) return null;

  let raw;
  try {
    raw = await fs.readFile(USAGE_CACHE_PATH, 'utf8');
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const rl = parsed.rate_limits ?? parsed.rate_limit ?? parsed.rateLimits;
  if (!rl || typeof rl !== 'object') return null;

  // Le format Anthropic exact n'est pas figé : selon les versions de
  // Claude Code on peut voir `5h` / `five_hour` / `session`, et
  // `7d` / `weekly` / `weekly_max`. On essaie chaque variante.
  return {
    capturedAt: Number(parsed.capturedAt) || stat.mtimeMs,
    fiveH: extractWindow(
      rl['5h'] ?? rl.five_hour ?? rl.fiveHour ?? rl.session ?? rl['5_hour'],
    ),
    weekly: extractWindow(
      rl['7d'] ?? rl.weekly ?? rl.seven_day ?? rl.sevenDay ?? rl['7_day'],
    ),
  };
}

function extractWindow(obj: unknown): StatuslineCacheWindow | null {
  if (!obj || typeof obj !== 'object') return null;
  const w = obj as Record<string, unknown>;
  const rawPercent = numericOrNull(
    w.used_percentage ?? w.usedPercentage ?? w.percent ?? w.percentage,
  );
  const reset = numericOrNull(
    w.resets_at ?? w.resetsAt ?? w.reset ?? w.reset_at,
  );
  if (rawPercent === null || reset === null) return null;
  // Garde-fou : Anthropic doit retourner 0..100. Si on tombe sur une
  // valeur clairement absolue (ex. "1234 messages utilisés" sous une
  // clé qu'on a interprétée comme un %), on logue et on retombe à 0
  // plutôt que d'afficher 100% trompeur.
  let percent = rawPercent;
  if (percent > 100) {
    console.warn(
      `[claudeUsage] valeur % suspecte ${rawPercent} dans le cache statusline — clamp à 0 (probable valeur absolue mal interprétée)`,
    );
    percent = 0;
  } else if (percent < 0) {
    percent = 0;
  }
  // Si la valeur est exprimée en fraction [0,1] au lieu de [0,100], on
  // détecte (seuil heuristique : exactement 1 = quasi impossible en %),
  // mais on reste prudent — par défaut on ne convertit pas.
  return {
    percent,
    // Normalise s → ms : si l'epoch est < 10^11, c'est en secondes.
    resetsAt: reset < 1e11 ? reset * 1000 : reset,
  };
}

function numericOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
