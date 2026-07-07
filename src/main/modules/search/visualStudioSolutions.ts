/**
 * Scan récursif des fichiers de solution Visual Studio.
 *
 * Stratégie pragmatique (pas d'accès au MRU officiel de VS qui réside
 * dans un blob encodé dans ApplicationPrivateSettings.xml — fragile entre
 * versions). On scanne les racines configurées (Réglages → Recherche, défaut
 * `C:/Projets`) à profondeur limitée pour trouver les `*.sln` et `*.slnx`
 * (nouveau format VS 17.x XML simplifié). Racines fournies par `searchService`
 * (ce module reste pur, sans dépendance Electron/Settings).
 *
 * Limites pour éviter d'écraser le système :
 *  - Profondeur max : 5 niveaux
 *  - Limite résultats : 30 (les plus récemment modifiés)
 *  - Skip des dossiers `node_modules`, `bin`, `obj`, `.git`, etc.
 *
 * Modèle de cache : stale-while-revalidate. `peekVsSolutions()` renvoie
 * immédiatement le dernier scan connu (même périmé) et `refreshVsSolutions()`
 * re-scanne en tâche de fond. C'est `searchService` qui orchestre le refresh
 * et pousse la liste fraîche au renderer — ce module reste pur (aucune
 * dépendance Electron).
 */
import { promises as fs } from 'fs';
import { join, basename, extname } from 'path';
import type { SearchResult } from '../../../shared/types';
import { relativeLabel } from './relativeLabel';

const CACHE_TTL_MS = 60_000;
const MAX_DEPTH = 5;
const MAX_RESULTS = 30;

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

/** Scan effectif du FS. Ne touche pas au cache — cf. `refreshVsSolutions`. */
async function scan(roots: string[]): Promise<SearchResult[]> {
  const found: Found[] = [];
  await Promise.all(roots.map((r) => walk(r, 0, found)));
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const sliced = found.slice(0, MAX_RESULTS);

  return sliced.map((f) => ({
    kind: 'vs-solution',
    name: basename(f.path),
    path: f.path,
    meta: relativeLabel(f.mtimeMs),
  }));
}

/**
 * Renvoie le dernier scan connu de façon synchrone, ou `null` si aucun scan
 * n'a encore abouti. Volontairement indifférent au TTL : l'appelant affiche
 * ce cache instantanément puis déclenche un refresh si `isVsCacheStale()`.
 */
export function peekVsSolutions(): SearchResult[] | null {
  return cache ? cache.results : null;
}

/** `true` si aucun cache ou si le dernier scan a plus de `CACHE_TTL_MS`. */
export function isVsCacheStale(): boolean {
  return !cache || Date.now() - cache.at >= CACHE_TTL_MS;
}

/**
 * Re-scanne le FS, met à jour le cache interne puis retourne les résultats.
 * `roots` = racines à parcourir (fournies par `searchService` depuis les
 * réglages). Racines vides → aucun résultat.
 */
export async function refreshVsSolutions(
  roots: string[],
): Promise<SearchResult[]> {
  const results = await scan(roots);
  cache = { at: Date.now(), results };
  return results;
}
