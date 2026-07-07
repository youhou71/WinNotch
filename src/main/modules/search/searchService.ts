/**
 * Façade IPC du module Search (modes `/` et `vs` de la search bar).
 *
 * Expose les handlers :
 *  - `search:listVsCode`  : liste des workspaces VS Code récents
 *  - `search:listVs`      : liste des solutions Visual Studio scannées
 *  - `search:openVsCode`  : `code <path>` détaché
 *  - `search:openVs`      : `start "" <path>` (association de fichier)
 *
 * Cache stale-while-revalidate : les deux `list*` renvoient immédiatement le
 * dernier cache connu (affichage instantané, plus de spinner à chaque `/`
 * ou `vs`) puis, si le cache est périmé, relancent un scan en tâche de fond.
 * Quand ce scan aboutit avec une liste différente, on pousse le résultat au
 * renderer via `search:vsUpdated` / `search:vscodeUpdated`. `warmSearchCaches`
 * amorce les deux caches au démarrage pour que même le 1er usage soit instant.
 *
 * Spawn détaché pour les ouvertures : si WinNotch est fermé après le
 * lancement, l'éditeur cible reste vivant.
 */
import { ipcMain } from 'electron';
import { spawn } from 'child_process';
import { createHash } from 'node:crypto';
import { IpcChannel, type SearchResult } from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import { getSearchRoots, settingsEvents } from '../settings/settingsService';
import {
  peekVsCodeWorkspaces,
  isVsCodeCacheStale,
  refreshVsCodeWorkspaces,
} from './vscodeWorkspaces';
import {
  peekVsSolutions,
  isVsCacheStale,
  refreshVsSolutions,
} from './visualStudioSolutions';

/** Ops de hash autorisées pour `search:transform` (mode `;` de la search bar). */
const HASH_OPS = new Set(['md5', 'sha1', 'sha256', 'sha512']);

/**
 * Transforme une chaîne côté main — actuellement uniquement le hash (crypto
 * Node, indisponible côté renderer pour MD5). Digest hex minuscule.
 */
function transform(
  op: string,
  input: string,
): { ok: boolean; output?: string; error?: string } {
  try {
    if (HASH_OPS.has(op)) {
      return { ok: true, output: createHash(op).update(input, 'utf8').digest('hex') };
    }
    return { ok: false, error: `Opération inconnue : ${op}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function spawnDetached(
  file: string,
  args: string[],
  options: { useShell?: boolean } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(file, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        shell: options.useShell ?? false,
      });
      child.on('error', reject);
      child.unref();
      resolve();
    } catch (err) {
      reject(err as Error);
    }
  });
}

/**
 * Ouvre un workspace VS Code via la CLI `code`.
 *
 * Important : chaque token (`code`, `-n`, path) est passé en arg
 * **séparé** à spawn. Sinon, concaténer `code "<path>"` en une seule
 * string puis la passer comme argument à `cmd /c` déclenche le quoting
 * MS C-runtime de Node qui réinjecte `\"`, que cmd ne reconnaît pas
 * comme échappement → un arg vide finit par traîner après le path et
 * VS Code l'interprète comme un fichier à ouvrir (bug "ouvre un nouveau
 * fichier nommé comme le dossier").
 *
 * `-n` force une nouvelle fenêtre — pour les workspaces multi-root
 * (.code-workspace), `code` détecte automatiquement le format à partir
 * de l'extension du fichier.
 */
async function openVsCode(
  path: string,
  kind: SearchResult['kind'],
): Promise<{ ok: boolean; error?: string }> {
  try {
    void kind;
    await spawnDetached('cmd.exe', ['/c', 'code', '-n', path]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Ouvre un .sln/.slnx via l'association de fichier Windows (qui pointe
 * vers Visual Studio s'il est installé). On utilise `cmd /c start`
 * avec un titre vide en 1er argument pour éviter que `start` ne le
 * confonde avec le chemin.
 */
async function openVs(path: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await spawnDetached('cmd.exe', ['/c', 'start', '""', path]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Pousse une liste fraîche au renderer si la fenêtre est vivante. */
function broadcast(
  channel: (typeof IpcChannel)[keyof typeof IpcChannel],
  results: SearchResult[],
): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, results);
}

/**
 * Égalité structurelle de deux listes de résultats. Évite un push (et donc un
 * re-render côté renderer) quand le scan de fond retombe sur le même contenu.
 */
function sameResults(a: SearchResult[], b: SearchResult[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].path !== b[i].path || a[i].name !== b[i].name || a[i].meta !== b[i].meta) {
      return false;
    }
  }
  return true;
}

// Gardes anti-concurrence : un seul scan de fond à la fois par source.
let vsRefreshing = false;
let vscodeRefreshing = false;

/** Re-scanne les solutions VS en tâche de fond, pousse si le contenu a changé. */
async function backgroundRefreshVs(): Promise<void> {
  if (vsRefreshing) return;
  vsRefreshing = true;
  const prev = peekVsSolutions();
  try {
    const fresh = await refreshVsSolutions(getSearchRoots());
    if (!prev || !sameResults(prev, fresh)) {
      broadcast(IpcChannel.SearchVsUpdated, fresh);
    }
  } catch (err) {
    console.warn('[search] refresh VS échoué:', err);
  } finally {
    vsRefreshing = false;
  }
}

/** Relit les workspaces VS Code en tâche de fond, pousse si le contenu a changé. */
async function backgroundRefreshVsCode(): Promise<void> {
  if (vscodeRefreshing) return;
  vscodeRefreshing = true;
  const prev = peekVsCodeWorkspaces();
  try {
    const fresh = await refreshVsCodeWorkspaces(getSearchRoots());
    if (!prev || !sameResults(prev, fresh)) {
      broadcast(IpcChannel.SearchVsCodeUpdated, fresh);
    }
  } catch (err) {
    console.warn('[search] refresh VS Code échoué:', err);
  } finally {
    vscodeRefreshing = false;
  }
}

/**
 * Amorce les deux caches au démarrage (appelé une fois par le bootstrap main).
 * Les scans tournent en fond ; le broadcast éventuel est un no-op tant que le
 * renderer n'écoute pas encore.
 */
export function warmSearchCaches(): void {
  void backgroundRefreshVs();
  void backgroundRefreshVsCode();
}

export function registerSearchIpc(): void {
  // Un changement de racines (Réglages → Recherche) impacte les deux modes
  // (scan VS + filtre VS Code) : on force un refresh immédiat qui re-scanne
  // avec les nouvelles racines et pousse la liste à jour au renderer.
  settingsEvents.on('searchRoots:changed', () => {
    warmSearchCaches();
  });

  ipcMain.handle(IpcChannel.SearchListVsCode, async () => {
    const cached = peekVsCodeWorkspaces();
    if (cached) {
      // Cache présent : réponse instantanée + refresh de fond si périmé.
      if (isVsCodeCacheStale()) void backgroundRefreshVsCode();
      return cached;
    }
    // Démarrage à froid (warm pas encore abouti) : un scan direct unique.
    try {
      return await refreshVsCodeWorkspaces(getSearchRoots());
    } catch (err) {
      console.warn('[search] refreshVsCodeWorkspaces failed:', err);
      return [];
    }
  });

  ipcMain.handle(IpcChannel.SearchListVs, async () => {
    const cached = peekVsSolutions();
    if (cached) {
      // Cache présent : réponse instantanée + refresh de fond si périmé.
      if (isVsCacheStale()) void backgroundRefreshVs();
      return cached;
    }
    // Démarrage à froid : un scan bloquant unique, puis tout sort du cache.
    try {
      return await refreshVsSolutions(getSearchRoots());
    } catch (err) {
      console.warn('[search] refreshVsSolutions failed:', err);
      return [];
    }
  });

  ipcMain.handle(
    IpcChannel.SearchOpenVsCode,
    async (_e, path: string, kind: SearchResult['kind']) => {
      return openVsCode(path, kind);
    },
  );

  ipcMain.handle(IpcChannel.SearchOpenVs, async (_e, path: string) => {
    return openVs(path);
  });

  ipcMain.handle(IpcChannel.SearchTransform, (_e, op: string, input: string) =>
    transform(op, input),
  );
}
