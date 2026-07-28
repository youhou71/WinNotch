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
 * Concurrence (audit perf P8) : les statuts par repo sont collectés via
 * un pool de 4 workers (`mapLimit`) — l'ancien `Promise.all` non borné
 * lançait un `git.exe` par repo SIMULTANÉMENT à chaque tick (rafales de
 * 20-50 process, chacun scanné par l'AV → pics d'I/O et micro-freezes
 * périodiques). La rafale devient un défilé.
 *
 * Caches (audit perf P8) :
 *  - découverte des repos (walk readdir récursif) mémoïsée 10 min — les
 *    repos n'apparaissent/disparaissent pas toutes les 60 s ; refresh
 *    manuel ou changement de config = re-scan forcé ;
 *  - `checkGitAvailable` (un spawn `git --version` par tick) mémoïsé
 *    après le premier succès.
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
  type GitLocalAction,
  type GitLocalActionResult,
  type GitLocalRepo,
  type GitLocalState,
  type Settings,
} from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import { scanForRepos } from './gitlocalScanner';

const MIN_POLL_MS = 15_000;
/** Nombre max de `git status` simultanés. */
const STATUS_CONCURRENCY = 4;
/** Durée de validité de la liste des repos découverts. */
const REPO_DISCOVERY_TTL_MS = 10 * 60 * 1000;
/**
 * Au-delà de ce délai, un repo est re-scanné même si son `.git` n'a pas bougé.
 *
 * Indispensable : la signature ci-dessous ne voit QUE le dossier `.git`, donc
 * un commit, un checkout ou un fetch. Éditer un fichier suivi ne touche pas
 * `.git` — sans ce rattrapage, le compteur « non commité » resterait figé.
 */
const FULL_RESCAN_MS = 5 * 60 * 1000;

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
/** Cache de découverte (walk récursif des rootDirs). */
let repoPathsCache: { paths: string[]; at: number } | null = null;

/**
 * Statut mémoïsé par repo, réutilisé tant que le `.git` n'a pas bougé.
 *
 * Motivation (audit perf) : `git status` était relancé sur CHAQUE repo à
 * CHAQUE tick, sans le moindre test de fraîcheur. Sur un poste avec 20 repos
 * et un tick de 60 s, cela faisait 20 `git.exe` par minute — et autant de
 * `conhost.exe`, chaque process console en allouant un — soit ~57 600
 * créations de process par jour, toutes interceptées et scannées par
 * l'antivirus/EDR, alors que la quasi-totalité des repos n'avait pas changé.
 * Un `git status` coûte ici de 0,7 à 1,9 s (mesuré) : le scan complet occupait
 * ~18 s de travail disque par minute pour un résultat presque toujours
 * identique.
 *
 * Borné par construction : purgé à chaque scan des repos qui ont disparu de la
 * découverte, il ne peut pas dépasser le nombre de repos réellement présents.
 */
interface RepoCacheEntry {
  repo: GitLocalRepo;
  /** Empreinte du `.git` (mtimes) au moment du dernier `git status`. */
  signature: string;
  scannedAt: number;
}
const repoCache = new Map<string, RepoCacheEntry>();

/**
 * Empreinte bon marché de l'état d'un repo : mtimes de `.git/index` (staging,
 * refresh d'index), `.git/HEAD` (changement de branche) et `.git/refs`
 * (commits, fetch). Trois `fs.stat`, zéro process — à comparer aux ~1 s et aux
 * deux process (`git.exe` + `conhost.exe`) d'un `git status`.
 *
 * Une entrée illisible devient `-` : un repo dont le `.git` est un fichier
 * (worktree lié, sous-module) garde donc une signature constante et ne dépend
 * que du rattrapage `FULL_RESCAN_MS`, ce qui reste correct.
 */
async function repoSignature(repoPath: string): Promise<string> {
  const parts = await Promise.all(
    ['index', 'HEAD', 'refs'].map(async (entry) => {
      try {
        const st = await fs.stat(join(repoPath, '.git', entry));
        return String(st.mtimeMs);
      } catch {
        return '-';
      }
    }),
  );
  return parts.join('|');
}

/**
 * Exécute `fn` sur chaque item avec au plus `limit` exécutions simultanées.
 * Préserve l'ordre des résultats.
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

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
/**
 * Variables d'environnement que simple-git refuse de transmettre à git
 * (`blockUnsafeOperationsPlugin` — elles permettent l'exécution de commandes
 * arbitraires : éditeur, pager, ssh…). Passer `process.env` tel quel à
 * `.env()` fait donc échouer TOUS les repos dès que l'utilisateur a un
 * `EDITOR` défini dans son environnement. On les retire : un `git status`
 * en lecture seule n'ouvre ni éditeur, ni pager, ni connexion ssh.
 * Liste alignée sur `@simple-git/argv-parser` (clés comparées en lowercase).
 */
const UNSAFE_GIT_ENV_KEYS = new Set([
  'editor',
  'pager',
  'prefix',
  'git_askpass',
  'ssh_askpass',
  'git_config',
  'git_config_count',
  'git_config_global',
  'git_config_system',
  'git_editor',
  'git_sequence_editor',
  'git_exec_path',
  'git_external_diff',
  'git_pager',
  'git_proxy_command',
  'git_template_dir',
  'git_ssh',
  'git_ssh_command',
]);

/**
 * Environnement passé aux `git status` : `process.env` épuré des clés
 * bloquées + `GIT_OPTIONAL_LOCKS=0`. Calculé une fois (l'environnement du
 * process ne change pas en cours de vie).
 */
let gitEnvCache: NodeJS.ProcessEnv | null = null;
function gitEnv(): NodeJS.ProcessEnv {
  if (!gitEnvCache) {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (UNSAFE_GIT_ENV_KEYS.has(key.toLowerCase())) continue;
      env[key] = value;
    }
    // git status en lecture seule ne prend pas le verrou d'index — pas de
    // contention avec un `git` que l'utilisateur lance en parallèle dans
    // le repo (et pas d'écriture disque).
    env.GIT_OPTIONAL_LOCKS = '0';
    gitEnvCache = env;
  }
  return gitEnvCache;
}

async function readRepoStatus(path: string): Promise<GitLocalRepo> {
  const name = basename(path);
  const git = simpleGit(path).env(gitEnv());
  try {
    // `--untracked-files=normal` : les dossiers untracked comptent comme UNE
    // entrée au lieu d'être énumérés fichier par fichier (le `-u` par défaut
    // de simple-git = -uall, très coûteux sur un node_modules untracked).
    // Le comptage `uncommitted` reste correct — pas de `-uno` qui le casserait.
    const status = await git.status(['--untracked-files=normal']);
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
 * Mémoïsé après le premier succès : git ne disparaît pas du PATH en cours
 * de session, inutile de spawner `git --version` à chaque tick.
 */
let gitAvailableConfirmed = false;
async function checkGitAvailable(): Promise<string | null> {
  if (gitAvailableConfirmed) return null;
  try {
    await simpleGit().raw(['--version']);
    gitAvailableConfirmed = true;
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

/**
 * `readRepoStatus` mémoïsé : ne relance `git status` (donc `git.exe` +
 * `conhost.exe`) que si le `.git` a bougé, ou si la dernière lecture remonte à
 * plus de `FULL_RESCAN_MS`.
 *
 * Les résultats en erreur ne sont volontairement PAS mémoïsés : un repo
 * momentanément illisible (verrou, disque réseau) doit être retenté au tick
 * suivant plutôt que d'afficher son erreur pendant cinq minutes.
 */
async function readRepoStatusCached(path: string): Promise<GitLocalRepo> {
  const signature = await repoSignature(path);
  const hit = repoCache.get(path);
  if (
    hit &&
    hit.signature === signature &&
    Date.now() - hit.scannedAt < FULL_RESCAN_MS
  ) {
    return hit.repo;
  }
  const repo = await readRepoStatus(path);
  if (!repo.error) {
    repoCache.set(path, { repo, signature, scannedAt: Date.now() });
  }
  return repo;
}

/**
 * Scan + statuts + broadcast. Réentrance protégée par `scanInFlight`.
 * `forceScan` bypasse le cache de découverte (refresh manuel, changement
 * de config).
 */
async function refreshOnce(opts: { forceScan?: boolean } = {}): Promise<GitLocalState> {
  if (opts.forceScan) {
    repoPathsCache = null;
    // Refresh explicite (bouton, changement de config) : l'utilisateur attend
    // des statuts frais, pas ceux mémoïsés.
    repoCache.clear();
  }
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
      // Découverte (walk readdir récursif) mémoïsée : les repos bougent
      // rarement, seuls leurs STATUTS doivent être frais à chaque tick.
      let paths: string[];
      if (repoPathsCache && Date.now() - repoPathsCache.at < REPO_DISCOVERY_TTL_MS) {
        paths = repoPathsCache.paths;
      } else {
        paths = await scanForRepos(rootDirs, cfg.scanDepth, cfg.ignorePatterns);
        repoPathsCache = { paths, at: Date.now() };
      }
      const repos = await mapLimit(paths, STATUS_CONCURRENCY, readRepoStatusCached);
      // Purge des repos disparus (dossier supprimé, rootDir retiré) : garde le
      // cache borné au nombre de repos réellement découverts.
      if (repoCache.size > paths.length) {
        const alive = new Set(paths);
        for (const key of repoCache.keys()) {
          if (!alive.has(key)) repoCache.delete(key);
        }
      }
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
      void refreshOnce({ forceScan: true });
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
 *  Actions Git sûres (opt-in) — Lot 3 #10
 * ─────────────────────────────────────────────────────────────────── */

/** Timeout dur d'une action (anti-hang réseau / verrou). */
const ACTION_TIMEOUT_MS = 20_000;

/** Sous-ensemble sûr pour un nom de branche (validé avant `checkout -b`). */
const BRANCH_NAME_RE = /^[A-Za-z0-9._/-]+$/;

/**
 * Env des actions : `gitEnv()` (clés dangereuses retirées + OPTIONAL_LOCKS)
 * PLUS `GIT_TERMINAL_PROMPT=0` → git échoue VITE au lieu de bloquer sur une
 * invite d'identifiants (HTTPS) ou de passphrase SSH (combiné au strip de
 * GIT_ASKPASS/SSH_ASKPASS, aucune invite interactive n'est possible). C'est
 * ce qui rend `fetch` sûr : au pire un toast d'erreur, jamais un freeze.
 */
function actionEnv(): NodeJS.ProcessEnv {
  return { ...gitEnv(), GIT_TERMINAL_PROMPT: '0' };
}

/**
 * Exécute une action Git SÛRE sur un repo. Refusée si les actions sont
 * désactivées (opt-in) ou si `path` n'est pas un repo connu du dernier
 * scan (empêche le renderer de faire tourner git dans un dossier arbitraire).
 * Re-scanne toujours après (la nouvelle branche / le stash doivent se
 * refléter immédiatement).
 */
async function runRepoAction(
  path: string,
  action: GitLocalAction,
  arg?: string,
): Promise<GitLocalActionResult> {
  const cfg = store.get('moduleConfig').gitlocal;
  if (!cfg.actionsEnabled) {
    return { ok: false, error: 'Actions Git désactivées (Réglages → Git local).' };
  }
  if (!currentState.repos.some((r) => r.path === path)) {
    return { ok: false, error: 'Repo inconnu.' };
  }

  // Timeout dur via les options du constructeur (anti-hang) + env épuré.
  const git = simpleGit(path, {
    timeout: { block: ACTION_TIMEOUT_MS },
  }).env(actionEnv());

  try {
    switch (action) {
      case 'fetch':
        await git.fetch(['--prune']);
        return { ok: true, message: 'Fetch terminé (refs distantes à jour).' };
      case 'stash':
        await git.stash(['push', '-u', '-m', 'WinNotch']);
        return {
          ok: true,
          message: 'Modifications mises de côté (git stash, réversible via « git stash pop »).',
        };
      case 'branch': {
        const name = (arg ?? '').trim();
        if (
          !name ||
          name.length > 200 ||
          !BRANCH_NAME_RE.test(name) ||
          name.includes('..') ||
          name.startsWith('/') ||
          name.endsWith('/') ||
          name.endsWith('.lock')
        ) {
          return { ok: false, error: 'Nom de branche invalide.' };
        }
        await git.checkoutLocalBranch(name);
        return { ok: true, message: `Branche « ${name} » créée et active.` };
      }
      default:
        return { ok: false, error: 'Action inconnue.' };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    // Reflète le nouvel état (branche courante, uncommitted après stash…).
    void refreshOnce({ forceScan: true });
  }
}

/* ─────────────────────────────────────────────────────────────────────
 *  Enregistrement
 * ─────────────────────────────────────────────────────────────────── */

export function registerGitLocalIpc(): void {
  ipcMain.handle(IpcChannel.GitLocalGetState, () => currentState);
  // Refresh manuel = re-scan complet : c'est aussi le chemin emprunté par
  // le renderer après un patch de config (cf. note ci-dessous), qui doit
  // bypasser le cache de découverte.
  ipcMain.handle(IpcChannel.GitLocalRefresh, () => refreshOnce({ forceScan: true }));
  ipcMain.handle(IpcChannel.GitLocalOpenRepo, (_e, path: string) =>
    openRepo(path),
  );
  ipcMain.handle(
    IpcChannel.GitLocalAction,
    (_e, path: string, action: GitLocalAction, arg?: string) =>
      runRepoAction(path, action, arg),
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
