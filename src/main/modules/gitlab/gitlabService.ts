/**
 * Service central du module GitLab.
 *
 * Responsabilités :
 *  - Lecture/écriture des credentials (URL + PAT chiffré) via les Settings.
 *  - Chiffrement du PAT via Electron `safeStorage` (DPAPI sous Windows) :
 *    le PAT brut ne quitte jamais le main process. Le renderer ne voit que
 *    le statut booléen `configured`.
 *  - Polling périodique des MR à reviewer, des MR créées par l'utilisateur,
 *    des issues à label surveillé et des work items qui lui sont assignés.
 *  - Broadcast IPC `gitlab:change` à chaque changement d'état.
 *
 * Erreurs réseau / 401 : on les attrape silencieusement et on stocke un
 * `lastError` dans le GitLabState — pas de crash, le module reste utilisable.
 */
import { ipcMain, safeStorage } from 'electron';
import Store from 'electron-store';
import {
  DEFAULT_SETTINGS,
  IpcChannel,
  type GitLabState,
  type GitLabUser,
  type Settings,
} from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import {
  fetchCurrentUser,
  fetchIssuesByLabel,
  fetchMrDetail,
  fetchMrPipelineStatus,
  fetchMrsAuthored,
  fetchMrsToReview,
  fetchMyReviewedMrIds,
  fetchMyWorkItems,
  GitLabAuthError,
  GitLabNetworkError,
} from './gitlabClient';
import type { GitLabMrDetail } from '../../../shared/types';
import { broadcastSettings } from '../settings/settingsService';

/** Borne minimale pour `pollMs` (sécurité contre une config trop agressive). */
const MIN_POLL_MS = 30_000;

/**
 * Store partagé avec settingsService — même fichier `config.json`, même
 * defaults. On accède directement à `moduleConfig.gitlab` pour lire l'URL
 * et le token chiffré, et pour persister le profil après un test réussi.
 */
const store = new Store<Settings>({
  defaults: DEFAULT_SETTINGS,
  name: 'config',
});

/** Snapshot courant — exposé via `gitlab:getState`. */
let currentState: GitLabState = {
  configured: false,
  user: null,
  toReview: [],
  mine: [],
  watchedIssues: [],
  myWorkItems: [],
  lastFetchAt: null,
  lastError: null,
};

let pollTimer: NodeJS.Timeout | null = null;

/**
 * Déchiffre le PAT depuis le store via safeStorage.
 *
 * Renvoie `null` si :
 *  - aucun token n'est stocké
 *  - safeStorage n'est pas disponible (très rare, ex. session Linux sans keychain)
 *  - le déchiffrement échoue (clé OS différente après réinstall, etc.)
 */
function readToken(): string | null {
  const cfg = store.get('moduleConfig').gitlab;
  if (!cfg.encryptedToken) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[gitlab] safeStorage indisponible — token inaccessible');
    return null;
  }
  try {
    const buf = Buffer.from(cfg.encryptedToken, 'base64');
    return safeStorage.decryptString(buf);
  } catch (err) {
    console.warn('[gitlab] échec déchiffrement token:', err);
    return null;
  }
}

/** Chiffre + persiste le PAT. Lève si safeStorage indispo (pour signaler à l'UI). */
function writeToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "Chiffrement OS indisponible — impossible de stocker le token de manière sécurisée.",
    );
  }
  const buf = safeStorage.encryptString(token);
  const cfg = store.get('moduleConfig');
  store.set('moduleConfig', {
    ...cfg,
    gitlab: { ...cfg.gitlab, encryptedToken: buf.toString('base64') },
  });
}

function clearToken(): void {
  const cfg = store.get('moduleConfig');
  store.set('moduleConfig', {
    ...cfg,
    gitlab: { ...cfg.gitlab, encryptedToken: null, account: null },
  });
}

function setUrl(url: string): void {
  const cfg = store.get('moduleConfig');
  store.set('moduleConfig', {
    ...cfg,
    gitlab: { ...cfg.gitlab, url },
  });
}

function setAccount(user: GitLabUser | null): void {
  const cfg = store.get('moduleConfig');
  store.set('moduleConfig', {
    ...cfg,
    gitlab: { ...cfg.gitlab, account: user },
  });
}

function broadcast(): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.GitLabChange, currentState);
}

/**
 * Fetch synchrone des MR (reviewer + author). Met à jour `currentState`
 * et broadcast. En cas d'erreur, écrit `lastError` et garde les anciennes
 * listes (vaut mieux des données un peu fraîches que rien).
 */
async function refreshOnce(): Promise<GitLabState> {
  const cfg = store.get('moduleConfig').gitlab;
  const token = readToken();
  if (!cfg.url || !token || !cfg.account) {
    currentState = {
      configured: false,
      user: cfg.account,
      toReview: [],
      mine: [],
      watchedIssues: [],
      myWorkItems: [],
      lastFetchAt: currentState.lastFetchAt,
      lastError: null,
    };
    broadcast();
    return currentState;
  }

  try {
    // Issues : un appel par label surveillé, en parallèle. On dédup
    // ensuite par `id` (une issue peut porter plusieurs labels surveillés
    // → ne pas la lister deux fois) en conservant le 1er `matchedLabel`
    // rencontré.
    const labelFetches = cfg.watchedLabels
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((label) => fetchIssuesByLabel(cfg.url, token, label));

    const [toReviewRaw, mineRaw, issueGroups, myWorkItems, reviewedIds] =
      await Promise.all([
        fetchMrsToReview(cfg.url, token, cfg.account.id),
        fetchMrsAuthored(cfg.url, token, cfg.account.id),
        Promise.all(labelFetches),
        fetchMyWorkItems(cfg.url, token, cfg.account.id),
        // État de reviewer (GraphQL) : ids des MR que j'ai déjà reviewées.
        // `.catch` local → un échec GraphQL ne fait pas rejeter le Promise.all
        // (donc pas de lastError parasite) ; on retombe sur la liste complète.
        fetchMyReviewedMrIds(cfg.url, token, cfg.account.username).catch(
          (err) => {
            console.warn(
              '[gitlab] filtre MR reviewées indisponible (GraphQL):',
              err,
            );
            return new Set<number>();
          },
        ),
      ]);

    // Le filtre REST `reviewer_id` garde les MR tant qu'elles sont ouvertes,
    // même après ma review → on retire ici celles que j'ai déjà reviewées.
    const toReview = reviewedIds.size
      ? toReviewRaw.filter((mr) => !reviewedIds.has(mr.id))
      : toReviewRaw;

    // Pré-fetch du statut pipeline pour les MR « mine » uniquement (badge
    // collapsed + toast « pipeline échoué »). Les MR à reviewer récupèrent
    // leur détail à la demande au survol. `fetchMrPipelineStatus` absorbe
    // ses propres erreurs (→ null), donc ne casse pas le refresh.
    const mine = await Promise.all(
      mineRaw.map(async (mr) => ({
        ...mr,
        pipelineStatus: await fetchMrPipelineStatus(
          cfg.url,
          token,
          mr.projectId,
          mr.iid,
        ),
      })),
    );

    const dedup = new Map<number, GitLabState['watchedIssues'][number]>();
    for (const group of issueGroups) {
      for (const issue of group) {
        if (!dedup.has(issue.id)) dedup.set(issue.id, issue);
      }
    }
    const watchedIssues = [...dedup.values()].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );

    currentState = {
      configured: true,
      user: cfg.account,
      toReview,
      mine,
      watchedIssues,
      myWorkItems,
      lastFetchAt: new Date().toISOString(),
      lastError: null,
    };
  } catch (err) {
    const msg =
      err instanceof GitLabAuthError
        ? 'Token GitLab invalide ou expiré'
        : err instanceof GitLabNetworkError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
    currentState = {
      ...currentState,
      configured: true,
      user: cfg.account,
      lastError: msg,
    };
  }
  broadcast();
  return currentState;
}

/**
 * Démarre / restart le polling avec l'intervalle courant. À appeler après
 * tout changement de config (save / clear / pollMs).
 */
function restartPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  const cfg = store.get('moduleConfig').gitlab;
  const ms = Math.max(MIN_POLL_MS, cfg.pollMs || 120_000);
  pollTimer = setInterval(() => {
    void refreshOnce();
  }, ms);
}

/* ─────────────────────────────────────────────────────────────────────
 *  Handlers IPC
 * ─────────────────────────────────────────────────────────────────── */

async function handleTestConnection(
  url: string,
  token: string,
): Promise<{ ok: boolean; user?: GitLabUser; error?: string }> {
  try {
    const user = await fetchCurrentUser(url, token);
    return { ok: true, user };
  } catch (err) {
    const error =
      err instanceof GitLabAuthError
        ? err.message
        : err instanceof GitLabNetworkError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
    return { ok: false, error };
  }
}

async function handleSaveCredentials(
  url: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const test = await handleTestConnection(url, token);
  if (!test.ok || !test.user) {
    return { ok: false, error: test.error ?? 'Connexion impossible' };
  }
  try {
    setUrl(url);
    writeToken(token);
    setAccount(test.user);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
  // Re-publie les Settings côté renderer (l'UI doit refléter l'`account`
  // qui vient d'être stocké).
  broadcastSettings();
  // Premier fetch + redémarrage du polling avec la nouvelle config.
  void refreshOnce();
  restartPolling();
  return { ok: true };
}

function handleClearCredentials(): void {
  clearToken();
  setUrl('');
  currentState = {
    configured: false,
    user: null,
    toReview: [],
    mine: [],
    watchedIssues: [],
    myWorkItems: [],
    lastFetchAt: null,
    lastError: null,
  };
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  broadcastSettings();
  broadcast();
}

/**
 * Réagit aux changements de `moduleConfig.gitlab` depuis les Settings :
 *  - `watchedLabels` modifié → refresh immédiat (ne pas attendre 120 s
 *    avant de voir la nouvelle liste d'issues correspondante).
 *  - `pollMs` modifié → restart du timer avec le nouvel intervalle.
 *  - autres champs (notify, collapsed, etc.) → pas d'action backend
 *    nécessaire ; le renderer relit `settings.moduleConfig` directement.
 */
function subscribeConfigChanges(): void {
  store.onDidChange('moduleConfig', (newVal, oldVal) => {
    const newG = newVal?.gitlab;
    const oldG = oldVal?.gitlab;
    if (!newG || !oldG) return;

    const labelsChanged =
      JSON.stringify(newG.watchedLabels) !==
      JSON.stringify(oldG.watchedLabels);
    if (labelsChanged && newG.account && newG.encryptedToken) {
      void refreshOnce();
    }

    if (newG.pollMs !== oldG.pollMs && newG.account && newG.encryptedToken) {
      restartPolling();
    }
  });
}

/**
 * Enregistre les handlers IPC + démarre le polling si une config valide
 * est déjà présente au boot (cas typique : redémarrage de l'app après
 * un save précédent).
 */
export function registerGitLabIpc(): void {
  ipcMain.handle(IpcChannel.GitLabGetState, () => currentState);
  ipcMain.handle(
    IpcChannel.GitLabTestConnection,
    (_e, url: string, token: string) => handleTestConnection(url, token),
  );
  ipcMain.handle(
    IpcChannel.GitLabSaveCredentials,
    (_e, url: string, token: string) => handleSaveCredentials(url, token),
  );
  ipcMain.handle(IpcChannel.GitLabClearCredentials, () =>
    handleClearCredentials(),
  );
  ipcMain.handle(IpcChannel.GitLabRefresh, () => refreshOnce());
  ipcMain.handle(
    IpcChannel.GitLabMrDetail,
    async (_e, projectId: number, iid: number): Promise<GitLabMrDetail> => {
      const cfg = store.get('moduleConfig').gitlab;
      const token = readToken();
      const empty: GitLabMrDetail = {
        pipelineStatus: null,
        pipelineWebUrl: null,
        failedJobs: [],
        unresolvedThreads: 0,
        approvalsRequired: null,
        approvalsLeft: null,
        error: null,
      };
      if (!cfg.url || !token) return { ...empty, error: 'Non configuré' };
      try {
        return await fetchMrDetail(cfg.url, token, projectId, iid);
      } catch (err) {
        return { ...empty, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  subscribeConfigChanges();

  // Auto-start si déjà configuré : URL + token chiffré + account présents.
  const cfg = store.get('moduleConfig').gitlab;
  if (cfg.url && cfg.encryptedToken && cfg.account) {
    void refreshOnce();
    restartPolling();
  }
}

export function stopGitLab(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
