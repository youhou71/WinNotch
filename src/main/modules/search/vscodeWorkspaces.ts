/**
 * Lecture des workspaces VS Code récents depuis `state.vscdb`.
 *
 * VS Code stocke son MRU dans un SQLite à
 * `%APPDATA%/Code/User/globalStorage/state.vscdb`, table `ItemTable`,
 * clé `history.recentlyOpenedPathsList`. La valeur est un JSON sérialisé
 * de la forme :
 *
 * ```json
 * {
 *   "entries": [
 *     { "folderUri": "file:///c:/Projets/...", "label": "MyProj" },
 *     { "workspace": { "id": "...", "configPath": "file:///..." } },
 *     { "fileUri": "file:///..." }   // fichiers isolés — on les ignore
 *   ]
 * }
 * ```
 *
 * On extrait uniquement les folders et workspaces. Cache de 30 s pour ne
 * pas réouvrir le SQLite à chaque keystroke utilisateur.
 */
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import type { SearchResult } from '../../../shared/types';

const CACHE_TTL_MS = 30_000;

let cache: { at: number; results: SearchResult[] } | null = null;

function resolveStateDbPath(): string | null {
  const appData = process.env['APPDATA'];
  if (!appData) return null;
  const p = join(appData, 'Code', 'User', 'globalStorage', 'state.vscdb');
  return existsSync(p) ? p : null;
}

/**
 * Convertit `file:///c:/...` en chemin Windows natif `C:\...`.
 * Tolère les URI mal-formées en retournant la chaîne brute.
 */
function uriToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

interface RawEntry {
  folderUri?: string;
  fileUri?: string;
  workspace?: { id?: string; configPath?: string };
  label?: string;
}

interface RawList {
  entries?: RawEntry[];
}

export function listVsCodeWorkspaces(): SearchResult[] {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.results;
  }
  const dbPath = resolveStateDbPath();
  if (!dbPath) return [];

  let raw: string | null = null;
  try {
    // `readonly: true` + `fileMustExist: true` : lecture sans verrou
    // (VS Code peut être ouvert pendant qu'on lit).
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = db
        .prepare(
          `SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList'`,
        )
        .get() as { value: Buffer | string } | undefined;
      if (row) {
        raw = typeof row.value === 'string' ? row.value : row.value.toString('utf8');
      }
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn('[search/vscode] lecture state.vscdb échouée:', err);
    return [];
  }

  if (!raw) return [];

  let parsed: RawList;
  try {
    parsed = JSON.parse(raw) as RawList;
  } catch (err) {
    console.warn('[search/vscode] JSON invalide:', err);
    return [];
  }

  const results: SearchResult[] = [];
  for (const entry of parsed.entries ?? []) {
    if (entry.folderUri) {
      const path = uriToPath(entry.folderUri);
      results.push({
        kind: 'vscode-folder',
        name: entry.label ?? basename(path),
        path,
        meta: 'Workspace',
      });
    } else if (entry.workspace?.configPath) {
      const path = uriToPath(entry.workspace.configPath);
      results.push({
        kind: 'vscode-workspace',
        name: entry.label ?? basename(path),
        path,
        meta: 'Multi-root workspace',
      });
    }
    // fileUri : on ignore — l'utilisateur veut ouvrir un projet, pas un fichier.
  }

  cache = { at: Date.now(), results };
  return results;
}

/** Invalide le cache (utile au test ou après une action). */
export function invalidateVsCodeCache(): void {
  cache = null;
}
