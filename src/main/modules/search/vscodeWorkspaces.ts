/**
 * Lecture des workspaces VS Code récents depuis `workspaceStorage`.
 *
 * ⚠️ VS Code ≥ 1.10x ne stocke plus le MRU dans `state.vscdb`
 * (`ItemTable` / clé `history.recentlyOpenedPathsList`) : la clé a disparu
 * (constaté sur 1.122). On dérive donc la liste depuis
 * `%APPDATA%/Code/User/workspaceStorage/<hash>/workspace.json`, qui contient
 * l'URI du dossier ouvert (`folder`) ou du workspace multi-root
 * (`workspace`, chemin d'un `.code-workspace`).
 *
 * Récence : le mtime le plus récent des fichiers du dossier `<hash>` (son
 * `state.vscdb` interne bouge à chaque usage) → capte même le workspace
 * actuellement ouvert, contrairement au mtime du dossier lui-même (NTFS ne
 * le met pas à jour quand un fichier interne change en place).
 *
 * Filtre : si des racines de recherche sont configurées (Réglages →
 * Recherche), on ne garde que les workspaces situés sous l'une d'elles —
 * masque le bruit (WSL, dossiers hors projets). Racines vides = pas de
 * filtre (on montre tout).
 *
 * Modèle de cache : stale-while-revalidate. `peekVsCodeWorkspaces()` renvoie
 * immédiatement la dernière lecture connue (même périmée) et
 * `refreshVsCodeWorkspaces()` re-scanne. `searchService` orchestre le refresh
 * en tâche de fond et pousse la liste fraîche au renderer.
 */
import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import type { SearchResult } from '../../../shared/types';
import { relativeLabel } from './relativeLabel';

const CACHE_TTL_MS = 30_000;
const MAX_RESULTS = 30;

let cache: { at: number; results: SearchResult[] } | null = null;

function resolveWorkspaceStorageDir(): string | null {
  const appData = process.env['APPDATA'];
  if (!appData) return null;
  return join(appData, 'Code', 'User', 'workspaceStorage');
}

/**
 * Convertit `file:///c:/...` en chemin Windows natif `C:\...`.
 * Tolère les URI mal-formées (ex. `file://wsl.localhost/...`) en retournant
 * le meilleur effort de `fileURLToPath`, sinon la chaîne brute.
 */
function uriToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

/** Normalise un chemin pour comparaison insensible casse + séparateurs. */
function normalizeForCompare(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/**
 * `true` si `path` est situé sous l'une des racines (ou égal à elle).
 * Racines vides → toujours `true` (aucun filtre).
 */
function isUnderAnyRoot(path: string, roots: string[]): boolean {
  if (roots.length === 0) return true;
  const p = normalizeForCompare(path);
  return roots.some((r) => {
    const root = normalizeForCompare(r);
    if (!root) return false;
    return p === root || p.startsWith(root + '\\');
  });
}

interface WorkspaceJson {
  folder?: string;
  workspace?: string;
}

/** mtime le plus récent parmi le dossier et ses fichiers directs. */
async function dirRecency(dir: string): Promise<number> {
  let best = 0;
  try {
    const st = await fs.stat(dir);
    best = st.mtimeMs;
    const names = await fs.readdir(dir);
    await Promise.all(
      names.map(async (n) => {
        try {
          const s = await fs.stat(join(dir, n));
          if (s.mtimeMs > best) best = s.mtimeMs;
        } catch {
          // fichier disparu entre readdir et stat — on ignore.
        }
      }),
    );
  } catch {
    // dossier illisible — récence 0 (retombera en fin de liste).
  }
  return best;
}

interface Found {
  kind: SearchResult['kind'];
  name: string;
  path: string;
  mtimeMs: number;
}

/**
 * Scan effectif de `workspaceStorage`. Ne touche pas au cache — cf.
 * `refreshVsCodeWorkspaces`.
 */
async function scan(roots: string[]): Promise<SearchResult[]> {
  const root = resolveWorkspaceStorageDir();
  if (!root) return [];

  let hashDirs: import('fs').Dirent[];
  try {
    hashDirs = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: Found[] = [];
  await Promise.all(
    hashDirs.map(async (h) => {
      if (!h.isDirectory()) return;
      const dir = join(root, h.name);
      let parsed: WorkspaceJson;
      try {
        const raw = await fs.readFile(join(dir, 'workspace.json'), 'utf8');
        parsed = JSON.parse(raw) as WorkspaceJson;
      } catch {
        // Fenêtre "vide" (sans dossier) ou json illisible — on ignore.
        return;
      }
      let kind: SearchResult['kind'];
      let target: string;
      if (parsed.folder) {
        kind = 'vscode-folder';
        target = uriToPath(parsed.folder);
      } else if (parsed.workspace) {
        kind = 'vscode-workspace';
        target = uriToPath(parsed.workspace);
      } else {
        return;
      }
      if (!isUnderAnyRoot(target, roots)) return;
      const mtimeMs = await dirRecency(dir);
      found.push({ kind, name: basename(target), path: target, mtimeMs });
    }),
  );

  found.sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Dédup par chemin (un même dossier peut avoir plusieurs `<hash>` après
  // réouvertures) — la 1re occurrence (la plus récente) gagne.
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const f of found) {
    const key = normalizeForCompare(f.path);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      kind: f.kind,
      name: f.name,
      path: f.path,
      meta: relativeLabel(f.mtimeMs),
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

/**
 * Renvoie la dernière lecture connue de façon synchrone, ou `null` si aucune
 * lecture n'a encore abouti. Indifférent au TTL : l'appelant affiche ce cache
 * instantanément puis déclenche un refresh si `isVsCodeCacheStale()`.
 */
export function peekVsCodeWorkspaces(): SearchResult[] | null {
  return cache ? cache.results : null;
}

/** `true` si aucun cache ou si la dernière lecture a plus de `CACHE_TTL_MS`. */
export function isVsCodeCacheStale(): boolean {
  return !cache || Date.now() - cache.at >= CACHE_TTL_MS;
}

/**
 * Re-scanne `workspaceStorage`, met à jour le cache interne puis retourne les
 * résultats. `roots` filtre la liste (cf. en-tête du module).
 */
export async function refreshVsCodeWorkspaces(
  roots: string[],
): Promise<SearchResult[]> {
  const results = await scan(roots);
  cache = { at: Date.now(), results };
  return results;
}
