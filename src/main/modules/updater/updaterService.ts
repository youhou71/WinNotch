/**
 * Service de mise à jour automatique (electron-updater).
 *
 * Stratégie :
 *  - Provider GitHub Releases (configuré dans `electron-builder.yml` au
 *    section `publish`). electron-updater lit le `latest.yml` publié à
 *    côté de l'installeur NSIS.
 *  - `autoDownload = false` : on attend l'action explicite de l'utilisateur
 *    avant de télécharger. Confirme via toast cliquable dans le notch.
 *  - `autoInstallOnAppQuit = false` : pareil, l'install nécessite un
 *    `quitAndInstall()` explicite (l'utilisateur clique le toast "Prêt
 *    à installer").
 *  - Check au démarrage (après 30 s pour ne pas bloquer le boot) et
 *    toutes les heures ensuite.
 *
 * Le service ne fonctionne **qu'en production** : `autoUpdater` refuse
 * de chercher des updates en dev (`app.isPackaged === false`). On gère
 * ce cas en exposant un `idle` permanent côté renderer plutôt qu'un
 * crash.
 */
import { app, ipcMain } from 'electron';
import electronUpdater from 'electron-updater';
import {
  IpcChannel,
  type UpdateState,
} from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';

// electron-updater est CJS — on récupère le singleton via le default export.
const { autoUpdater } = electronUpdater;

/** Intervalle entre deux checks périodiques. 1 h est le standard. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Délai après le boot avant le 1er check (laisse l'app se stabiliser). */
const INITIAL_CHECK_DELAY_MS = 30 * 1000;

let currentState: UpdateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  latestVersion: null,
  downloadPercent: null,
  error: null,
};

let checkInterval: NodeJS.Timeout | null = null;
let initialTimeout: NodeJS.Timeout | null = null;

function broadcast(): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.UpdaterChange, currentState);
}

function setState(patch: Partial<UpdateState>): void {
  currentState = { ...currentState, ...patch };
  broadcast();
}

function setupAutoUpdaterListeners(): void {
  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking', error: null });
  });

  autoUpdater.on('update-available', (info) => {
    setState({
      status: 'available',
      latestVersion: info?.version ?? null,
      error: null,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    setState({
      status: 'no-update',
      latestVersion: info?.version ?? currentState.currentVersion,
      error: null,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    setState({
      status: 'downloading',
      downloadPercent: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setState({
      status: 'downloaded',
      latestVersion: info?.version ?? currentState.latestVersion,
      downloadPercent: 100,
    });
  });

  autoUpdater.on('error', (err) => {
    setState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Lance un check. En dev (`!app.isPackaged`), autoUpdater plante avec
 * une erreur peu claire — on cours-circuite proprement.
 */
async function checkNow(): Promise<UpdateState> {
  if (!app.isPackaged) {
    setState({
      status: 'idle',
      error: 'Updater désactivé en mode développement.',
    });
    return currentState;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return currentState;
}

async function downloadUpdate(): Promise<{ ok: boolean; error?: string }> {
  if (!app.isPackaged) {
    return { ok: false, error: 'Updater désactivé en mode développement.' };
  }
  if (currentState.status !== 'available') {
    return {
      ok: false,
      error: 'Aucune mise à jour disponible à télécharger.',
    };
  }
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function quitAndInstall(): { ok: boolean; error?: string } {
  if (!app.isPackaged) {
    return { ok: false, error: 'Updater désactivé en mode développement.' };
  }
  if (currentState.status !== 'downloaded') {
    return {
      ok: false,
      error: "Mise à jour pas encore téléchargée.",
    };
  }
  try {
    // `isSilent: false, isForceRunAfter: true` : montre brièvement le
    // setup NSIS pendant la copie + relance l'app après.
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Enregistre les handlers IPC + démarre le check périodique.
 *
 * Idempotent — sûr à appeler plusieurs fois (les listeners autoUpdater
 * sont ajoutés une seule fois grâce au flag interne).
 */
let initialized = false;
export function registerUpdaterIpc(): void {
  if (!initialized) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    setupAutoUpdaterListeners();
    initialized = true;
  }

  ipcMain.handle(IpcChannel.UpdaterGetState, () => currentState);
  ipcMain.handle(IpcChannel.UpdaterCheckNow, () => checkNow());
  ipcMain.handle(IpcChannel.UpdaterDownload, () => downloadUpdate());
  ipcMain.handle(IpcChannel.UpdaterQuitAndInstall, () => quitAndInstall());

  // 1er check après le délai de stabilisation, puis interval périodique.
  if (app.isPackaged && !initialTimeout) {
    initialTimeout = setTimeout(() => {
      void checkNow();
      checkInterval = setInterval(() => {
        void checkNow();
      }, CHECK_INTERVAL_MS);
    }, INITIAL_CHECK_DELAY_MS);
  }
}

export function stopUpdater(): void {
  if (initialTimeout) {
    clearTimeout(initialTimeout);
    initialTimeout = null;
  }
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}
