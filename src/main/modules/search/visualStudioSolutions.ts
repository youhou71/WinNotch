/**
 * Scan récursif des fichiers de solution Visual Studio.
 *
 * Stratégie pragmatique (pas d'accès au MRU officiel de VS qui réside
 * dans un blob encodé dans ApplicationPrivateSettings.xml — fragile entre
 * versions). On scanne le dossier `C:/Projets` à profondeur limitée pour
 * trouver les `*.sln` et `*.slnx` (nouveau format VS 17.x XML simplifié).
 *
 * Limites pour éviter d'écraser le système :
 *  - Profondeur max : 5 niveaux
 *  - Limite résultats : 30 (les plus récemment modifiés)
 *  - Skip des dossiers `node_modules`, `bin`, `obj`, `.git`, etc.
 *  - Cache de 60 s pour ne pas re-scanner à chaque keystroke
 */
import { promises as fs } from 'fs';
import { join, basename, extname } from 'path';
import type { SearchResult } from '../../../shared/types';

const CACHE_TTL_MS = 60_000;
const MAX_DEPTH = 5;
const MAX_RESULTS = 30;
const ROOTS = ['C:/Projets'];

const SKIP_DIRS = new Set([
  'node_modules',
  'bin',
  'obj',
  '.git',
  '.vs',
  'dist',
  'out',
  'build',
  '.next',
  '.svelte-kit',
  '.idea',
]);

const TARGET_EXTS = new Set(['.sln', '.slnx']);

let cache: { at: number; results: SearchResult[] } | null = null;

interface Found {
  path: string;
  mtimeMs: number;
}

/**
 * Walk asynchrone bounded. Limite la profondeur ET ignore les sous-arbres
 * "bruyants" (node_modules, bin/obj) qui exploseraient le scan sans
 * apporter de solutions exploitables.
 */
async function walk(
  dir: string,
  depth: number,
  acc: Found[],
): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // Permission denied, dossier inexistant, etc. — on continue.
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // Aussi skip les dossiers cachés (commencent par '.') sauf cas listés.
      if (entry.name.startsWith('.')) continue;
      await walk(join(dir, entry.name), depth + 1, acc);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (!TARGET_EXTS.has(ext)) continue;
      const full = join(dir, entry.name);
      try {
        const stat = await fs.stat(full);
        acc.push({ path: full, mtimeMs: stat.mtimeMs });
      } catch {
        // Stat échoué — on saute l'entrée.
      }
    }
  }
}

/**
 * Convertit un timestamp en libellé court "il y a X min/h/j/sem".
 * Garde une cohérence visuelle avec les libellés du prototype.
 */
function relativeLabel(mtimeMs: number): string {
  const diff = Date.now() - mtimeMs;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'à l\'instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d} j`;
  const w = Math.floor(d / 7);
  if (w < 5) return `il y a ${w} sem`;
  const mo = Math.floor(d / 30);
  return `il y a ${mo} mois`;
}

export async function listVsSolutions(): Promise<SearchResult[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.results;
  }
  const found: Found[] = [];
  await Promise.all(ROOTS.map((r) => walk(r, 0, found)));
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const sliced = found.slice(0, MAX_RESULTS);

  const results: SearchResult[] = sliced.map((f) => ({
    kind: 'vs-solution',
    name: basename(f.path),
    path: f.path,
    meta: relativeLabel(f.mtimeMs),
  }));

  cache = { at: Date.now(), results };
  return results;
}

export function invalidateVsCache(): void {
  cache = null;
}
