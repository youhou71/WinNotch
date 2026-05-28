/**
 * Service central du module Git local.
 *
 * Responsabilités :
 *  - Scanner les `rootDirs` configurés pour trouver les repos `.git`.
 *  - Récolter par repo : branche, ahead/behind (vs upstream), uncommitted.
 *  - Broadcast IPC `gitlocal:change` à chaque tick.
 *  - Handler `gitlocal:openRepo` : détection `.sln`/`.slnx` à la racine
 *    → Visual Studio (association Windows), sinon → VS Code (`code -n`).
 *
 * Flag d'arrêt : `WINNOTCH_DISABLE_GITLOCAL=1` saute l'enregistrement.
 *
 * Concurrence : les statuts par repo sont collectés en parallèle avec
 * `Promise.all`, ce qui sature à N (nb de repos). Pour des installations
 * avec 50+ repos, on pourrait introduire `p-limit`. Pour l'instant on
 * laisse Node gérer — git status est I/O bound et le moteur node lance
 * les sous-process en parallèle sans plafond gênant en pratique.
 */
import { ipcMain } from 'electron';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import Store from 'electron-store';
import { simpleGit } from 'simple-git';
import {
  DEFAULT_SETTINGS,
  IpcChannel,
  type GitLocalRepo,
  type GitLocalState,
  type Settings,
} from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import { scanForRepos } from './gitlocalScanner';

const MIN_POLL_MS = 15_000;

const store = new Store<Settings>({
  defaults: DEFAULT_SETTINGS,
  name: 'config',
});

let currentState: GitLocalState = {
  configured: false,
  repos: [],
  lastScanAt: null,
  lastError: null,
};

let pollTimer: NodeJS.Timeout | null = null;
let scanInFlight: Promise<void> | null = null;

function broadcast(): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.GitLocalChange, currentState);
}

/**
 * Récupère le statut d'un repo. Toutes les erreurs sont remontées via
 * `error` sur l'objet — jamais throw, pour qu'un repo cassé n'empêche
 * pas les autres de s'afficher.
 */
async function readRepoStatus(path: string): Promise<GitLocalRepo> {
  const name = basename(path);
  const git = simpleGit(path);
  try {
    const status = await git.status();
    const branch = status.current ?? '';
    const tracking = status.tracking ?? null;
    const noUpstream = !tracking;
    const ahead = status.ahead ?? 0;
    const behind = status.behind ?? 0;
    // status.files contient tout ce qui n'est ni clean ni ignoré
    // (untracked, modified, staged, conflicted, …).
    const uncommitted = status.files.length;
    const isDirty = uncommitted > 0 || ahead > 0;
    return {
      path,
      name,
      branch,
      ahead,
      behind,
      uncommitted,
      isDirty,
      noUpstream,
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      path,
      name,
      branch: '',
      ahead: 0,
      behind: 0,
      uncommitted: 0,
      isDirty: false,
      noUpstream: false,
      error: msg,
    };
  }
}

/**
 * Vérifie que `git` répond. Sert à fournir un `lastError` lisible quand
 * Git n'est pas dans le PATH (sinon chaque repo échoue séparément).
 */
async function checkGitAvailable(): Promise<string | null> {
  try {
    await simpleGit().raw(['--version']);
    return null;
  } catch (err) {
    return (
      'Git introuvable dans le PATH. Installe Git pour Windows (https://git-scm.com/) ' +
      'puis redémarre WinNotch. (' +
      (err instanceof Error ? err.message : String(err)) +
      ')'
    );
  }
}

/** Scan + statuts + broadcast. Réentrance protégée par `scanInFlight`. */
async function refreshOnce(): Promise<GitLocalState> {
  if (scanInFlight) {
    await scanInFlight;
    return currentState;
  }
  const cfg = store.get('moduleConfig').gitlocal;
  const rootDirs = cfg.rootDirs.filter((d) => d.trim().length > 0);
  if (rootDirs.length === 0) {
    currentState = {
      configured: false,
      repos: [],
      lastScanAt: currentState.lastScanAt,
      lastError: null,
    };
    broadcast();
    return currentState;
  }

  const task = (async () => {
    const gitErr = await checkGitAvailable();
    if (gitErr) {
      currentState = {
        configured: true,
        repos: [],
        lastScanAt: new Date().toISOString(),
        lastError: gitErr,
      };
      broadcast();
      return;
    }
    try {
      const paths = await scanForRepos(rootDirs, cfg.scanDepth, cfg.ignorePatterns);
      const repos = await Promise.all(paths.map((p) => readRepoStatus(p)));
      // Tri : dirty d'abord (pour attirer l'œil), puis ordre alpha.
      repos.sort((a, b) => {
        if (a.isDirty !== b.isDirty) return a.isDirty ? -1 : 1;
        return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
      });
      currentState = {
        configured: true,
        repos,
        lastScanAt: new Date().toISOString(),
        lastError: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      currentState = {
        configured: true,
        repos: currentState.repos,
        lastScanAt: currentState.lastScanAt,
        lastError: msg,
      };
    }
    broadcast();
  })();
  scanInFlight = task;
  try {
    await task;
  } finally {
    scanInFlight = null;
  }
  return currentState;
}

function restartPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  const cfg = store.get('moduleConfig').gitlocal;
  const ms = Math.max(MIN_POLL_MS, cfg.pollMs || 60_000);
  pollTimer = setInterval(() => {
    void refreshOnce();
  }, ms);
}

/**
 * Réagit aux changements de `moduleConfig.gitlocal` :
 *  - `rootDirs` / `scanDepth` / `ignorePatterns` modifié → rescan immédiat
 *  - `pollMs` modifié → restart du timer
 */
function subscribeConfigChanges(): void {
  store.onDidChange('moduleConfig', (newVal, oldVal) => {
    const newG = newVal?.gitlocal;
    const oldG = oldVal?.gitlocal;
    if (!newG || !oldG) return;

    const rescanNeeded =
      JSON.stringify(newG.rootDirs) !== JSON.stringify(oldG.rootDirs) ||
      newG.scanDepth !== oldG.scanDepth ||
      JSON.stringify(newG.ignorePatterns) !== JSON.stringify(oldG.ignorePatterns);
    if (rescanNeeded) {
      void refreshOnce();
    }

    if (newG.pollMs !== oldG.pollMs) {
      restartPolling();
    }
  });
}

/* ─────────────────────────────────────────────────────────────────────
 *  Ouverture d'un repo (sln vs VS Code)
 * ─────────────────────────────────────────────────────────────────── */

function spawnDetached(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(file, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        shell: false,
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
 * Cherche un `.sln`/`.slnx` à la racine. Renvoie le 1er trouvé ou `null`.
 * On ne descend pas — la convention Visual Studio veut le sln à la racine.
 */
async function findSolutionFile(repoPath: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(repoPath, { withFileTypes: true });
    // Préférence : .slnx (format moderne) > .sln.
    const slnx = entries.find(
      (e) => e.isFile() && e.name.toLowerCase().endsWith('.slnx'),
    );
    if (slnx) return join(repoPath, slnx.name);
    const sln = entries.find(
      (e) => e.isFile() && e.name.toLowerCase().endsWith('.sln'),
    );
    if (sln) return join(repoPath, sln.name);
    return null;
  } catch {
    return null;
  }
}

/**
 * Ouvre un repo en choisissant intelligemment l'éditeur :
 *  - .sln/.slnx présent → Visual Studio (`cmd /c start "" <path>` →
 *    association de fichier Windows)
 *  - sinon → VS Code (`cmd /c code -n <path>`)
 *
 * Détaché : si WinNotch ferme après le clic, l'éditeur reste vivant.
 */
async function openRepo(
  path: string,
): Promise<{ ok: boolean; via?: 'sln' | 'vscode'; error?: string }> {
  try {
    const sln = await findSolutionFile(path);
    if (sln) {
      await spawnDetached('cmd.exe', ['/c', 'start', '""', sln]);
      return { ok: true, via: 'sln' };
    }
    await spawnDetached('cmd.exe', ['/c', 'code', '-n', path]);
    return { ok: true, via: 'vscode' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ─────────────────────────────────────────────────────────────────────
 *  Enregistrement
 * ─────────────────────────────────────────────────────────────────── */

export function registerGitLocalIpc(): void {
  ipcMain.handle(IpcChannel.GitLocalGetState, () => currentState);
  ipcMain.handle(IpcChannel.GitLocalRefresh, () => refreshOnce());
  ipcMain.handle(IpcChannel.GitLocalOpenRepo, (_e, path: string) =>
    openRepo(path),
  );

  subscribeConfigChanges();

  // Polling démarré inconditionnellement : `electron-store.onDidChange`
  // n'est PAS partagé entre instances (chaque service a son propre Store),
  // donc on ne peut pas se fier à `subscribeConfigChanges()` pour détecter
  // un ajout de rootDir depuis Settings. Le tick lit `store.get()` qui
  // re-lit le fichier — la nouvelle config est donc prise en compte au
  // prochain tick (et le renderer force un refresh explicite après chaque
  // patch via `window.notch.gitlocal.refresh()`).
  void refreshOnce();
  restartPolling();
}

export function stopGitLocal(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
