/**
 * Script preload : pont sécurisé main ↔ renderer.
 *
 * `contextIsolation: true` isole le contexte JS du renderer du Node.js
 * du preload. On expose donc volontairement une surface API étroite via
 * `contextBridge.exposeInMainWorld('notch', ...)` plutôt que de tout balancer
 * sur `window`. Côté renderer, `window.notch.*` est le seul point d'entrée
 * vers le main process — il n'y a aucune fuite de `require` ou `process`.
 *
 * Le shape de l'API est strictement défini par le type `NotchApi` dans
 * `shared/types.ts` pour rester synchronisé avec les handlers main.
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannel,
  type AudioState,
  type CalendarProviderId,
  type ClaudeSession,
  type ClipboardState,
  type DashTile,
  type Density,
  type GitLabState,
  type GitLabUser,
  type GitLocalState,
  type Meeting,
  type ModuleConfig,
  type ModuleId,
  type MusicState,
  type NotchApi,
  type SearchResult,
  type Settings,
  type UpdateState,
} from '../shared/types';

const api: NotchApi = {
  shell: {
    setMouseCapture: (capture: boolean) => {
      // One-way (send/on) suffit : le main applique sans retour, et le
      // renderer n'a aucune décision à prendre sur le résultat.
      ipcRenderer.send(IpcChannel.MouseCapture, capture);
    },
    onPeek: (cb: (on: boolean) => void) => {
      const handler = (_: unknown, on: boolean) => cb(on);
      ipcRenderer.on(IpcChannel.PeekChange, handler);
      // Retourne la fonction de désabonnement pour que React puisse
      // nettoyer dans son cleanup d'useEffect.
      return () => {
        ipcRenderer.off(IpcChannel.PeekChange, handler);
      };
    },
    launchClaude: (prompt: string) =>
      ipcRenderer.invoke(IpcChannel.ShellLaunchClaude, prompt),
    openExternal: (url: string) =>
      ipcRenderer.invoke(IpcChannel.ShellOpenExternal, url),
    openPath: (path: string) =>
      ipcRenderer.invoke(IpcChannel.ShellOpenPath, path),
    notifyModeChanged: (mode: 'collapsed' | 'expanded') => {
      ipcRenderer.send(IpcChannel.ShellModeChanged, mode);
    },
    onToggle: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on(IpcChannel.ShellToggleNotch, handler);
      return () => {
        ipcRenderer.off(IpcChannel.ShellToggleNotch, handler);
      };
    },
    onRequestCollapse: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on(IpcChannel.ShellRequestCollapse, handler);
      return () => {
        ipcRenderer.off(IpcChannel.ShellRequestCollapse, handler);
      };
    },
    onFullscreenChange: (cb: (fullscreen: boolean) => void) => {
      const handler = (_: unknown, fullscreen: boolean) => cb(fullscreen);
      ipcRenderer.on(IpcChannel.ShellFullscreenChange, handler);
      return () => {
        ipcRenderer.off(IpcChannel.ShellFullscreenChange, handler);
      };
    },
  },
  clipboard: {
    getState: () => ipcRenderer.invoke(IpcChannel.ClipboardGetState),
    pin: (id: string) => ipcRenderer.invoke(IpcChannel.ClipboardPin, id),
    unpin: (id: string) => ipcRenderer.invoke(IpcChannel.ClipboardUnpin, id),
    copyAgain: (id: string) =>
      ipcRenderer.invoke(IpcChannel.ClipboardCopyAgain, id),
    remove: (id: string) => ipcRenderer.invoke(IpcChannel.ClipboardRemove, id),
    clear: (keepPinned: boolean) =>
      ipcRenderer.invoke(IpcChannel.ClipboardClear, keepPinned),
    markSeen: () => ipcRenderer.invoke(IpcChannel.ClipboardMarkSeen),
    unfurl: (id: string) => ipcRenderer.invoke(IpcChannel.ClipboardUnfurl, id),
    saveImage: (id: string) =>
      ipcRenderer.invoke(IpcChannel.ClipboardSaveImage, id) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    getImageDataUrl: (id: string) =>
      ipcRenderer.invoke(IpcChannel.ClipboardGetImageDataUrl, id) as Promise<
        string | null
      >,
    openPath: (id: string) =>
      ipcRenderer.invoke(IpcChannel.ClipboardOpenPath, id) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    onChange: (cb: (state: ClipboardState) => void) => {
      const handler = (_: unknown, state: ClipboardState) => cb(state);
      ipcRenderer.on(IpcChannel.ClipboardChange, handler);
      return () => {
        ipcRenderer.off(IpcChannel.ClipboardChange, handler);
      };
    },
    onFocusCard: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on(IpcChannel.ClipboardFocusCard, handler);
      return () => {
        ipcRenderer.off(IpcChannel.ClipboardFocusCard, handler);
      };
    },
  },
  audio: {
    getState: () => ipcRenderer.invoke(IpcChannel.AudioGetState),
    setVolume: (level: number) =>
      ipcRenderer.invoke(IpcChannel.AudioSetVolume, level),
    setMuted: (muted: boolean) =>
      ipcRenderer.invoke(IpcChannel.AudioSetMuted, muted),
    setDevice: (id: string) =>
      ipcRenderer.invoke(IpcChannel.AudioSetDevice, id),
    onChange: (cb: (state: AudioState) => void) => {
      const handler = (_: unknown, state: AudioState) => cb(state);
      ipcRenderer.on(IpcChannel.AudioChange, handler);
      return () => {
        ipcRenderer.off(IpcChannel.AudioChange, handler);
      };
    },
  },
  music: {
    getState: () => ipcRenderer.invoke(IpcChannel.MusicGetState),
    playPause: () => ipcRenderer.invoke(IpcChannel.MusicPlayPause),
    next: () => ipcRenderer.invoke(IpcChannel.MusicNext),
    previous: () => ipcRenderer.invoke(IpcChannel.MusicPrevious),
    onChange: (cb: (state: MusicState) => void) => {
      const handler = (_: unknown, state: MusicState) => cb(state);
      ipcRenderer.on(IpcChannel.MusicChange, handler);
      return () => {
        ipcRenderer.off(IpcChannel.MusicChange, handler);
      };
    },
  },
  search: {
    listVsCode: () => ipcRenderer.invoke(IpcChannel.SearchListVsCode),
    listVs: () => ipcRenderer.invoke(IpcChannel.SearchListVs),
    openVsCode: (path: string, kind: SearchResult['kind']) =>
      ipcRenderer.invoke(IpcChannel.SearchOpenVsCode, path, kind),
    openVs: (path: string) =>
      ipcRenderer.invoke(IpcChannel.SearchOpenVs, path),
  },
  claude: {
    list: () => ipcRenderer.invoke(IpcChannel.ClaudeList),
    onChange: (cb: (sessions: ClaudeSession[]) => void) => {
      const handler = (_: unknown, sessions: ClaudeSession[]) => cb(sessions);
      ipcRenderer.on(IpcChannel.ClaudeChange, handler);
      return () => {
        ipcRenderer.off(IpcChannel.ClaudeChange, handler);
      };
    },
  },
  updater: {
    getState: () => ipcRenderer.invoke(IpcChannel.UpdaterGetState),
    checkNow: () => ipcRenderer.invoke(IpcChannel.UpdaterCheckNow),
    download: () =>
      ipcRenderer.invoke(IpcChannel.UpdaterDownload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    quitAndInstall: () =>
      ipcRenderer.invoke(IpcChannel.UpdaterQuitAndInstall) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    onChange: (cb: (state: UpdateState) => void) => {
      const handler = (_: unknown, state: UpdateState) => cb(state);
      ipcRenderer.on(IpcChannel.UpdaterChange, handler);
      return () => {
        ipcRenderer.off(IpcChannel.UpdaterChange, handler);
      };
    },
  },
  gitlab: {
    getState: () => ipcRenderer.invoke(IpcChannel.GitLabGetState),
    testConnection: (url: string, token: string) =>
      ipcRenderer.invoke(IpcChannel.GitLabTestConnection, url, token) as Promise<{
        ok: boolean;
        user?: GitLabUser;
        error?: string;
      }>,
    saveCredentials: (url: string, token: string) =>
      ipcRenderer.invoke(IpcChannel.GitLabSaveCredentials, url, token) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    clearCredentials: () => ipcRenderer.invoke(IpcChannel.GitLabClearCredentials),
    refresh: () => ipcRenderer.invoke(IpcChannel.GitLabRefresh),
    onChange: (cb: (state: GitLabState) => void) => {
      const handler = (_: unknown, state: GitLabState) => cb(state);
      ipcRenderer.on(IpcChannel.GitLabChange, handler);
      return () => {
        ipcRenderer.off(IpcChannel.GitLabChange, handler);
      };
    },
  },
  gitlocal: {
    getState: () => ipcRenderer.invoke(IpcChannel.GitLocalGetState),
    refresh: () => ipcRenderer.invoke(IpcChannel.GitLocalRefresh),
    openRepo: (path: string) =>
      ipcRenderer.invoke(IpcChannel.GitLocalOpenRepo, path) as Promise<{
        ok: boolean;
        via?: 'sln' | 'vscode';
        error?: string;
      }>,
    onChange: (cb: (state: GitLocalState) => void) => {
      const handler = (_: unknown, state: GitLocalState) => cb(state);
      ipcRenderer.on(IpcChannel.GitLocalChange, handler);
      return () => {
        ipcRenderer.off(IpcChannel.GitLocalChange, handler);
      };
    },
  },
  meetings: {
    connect: (provider: CalendarProviderId) =>
      ipcRenderer.invoke(IpcChannel.MeetingsConnect, provider),
    disconnect: (accountId: string) =>
      ipcRenderer.invoke(IpcChannel.MeetingsDisconnect, accountId),
    list: () => ipcRenderer.invoke(IpcChannel.MeetingsList),
    refresh: () => ipcRenderer.invoke(IpcChannel.MeetingsRefresh),
    hasDefaults: () => ipcRenderer.invoke(IpcChannel.MeetingsHasDefaults),
    onChange: (cb: (meetings: Meeting[]) => void) => {
      const handler = (_: unknown, meetings: Meeting[]) => cb(meetings);
      ipcRenderer.on(IpcChannel.MeetingsChange, handler);
      return () => {
        ipcRenderer.off(IpcChannel.MeetingsChange, handler);
      };
    },
  },
  settings: {
    getAll: () => ipcRenderer.invoke(IpcChannel.SettingsGetAll),
    toggleDnd: () => ipcRenderer.invoke(IpcChannel.SettingsToggleDnd),
    addTask: (text: string) =>
      ipcRenderer.invoke(IpcChannel.SettingsAddTask, text),
    toggleTask: (id: string) =>
      ipcRenderer.invoke(IpcChannel.SettingsToggleTask, id),
    removeTask: (id: string) =>
      ipcRenderer.invoke(IpcChannel.SettingsRemoveTask, id),
    clearDoneTasks: () =>
      ipcRenderer.invoke(IpcChannel.SettingsClearDoneTasks),
    setModule: (id: ModuleId, enabled: boolean) =>
      ipcRenderer.invoke(IpcChannel.SettingsSetModule, id, enabled),
    setDensity: (density: Density) =>
      ipcRenderer.invoke(IpcChannel.SettingsSetDensity, density),
    patchModuleConfig: <K extends ModuleId>(
      id: K,
      patch: Partial<ModuleConfig[K]>,
    ) => ipcRenderer.invoke(IpcChannel.SettingsPatchModuleConfig, id, patch),
    setAutoStart: (enabled: boolean) =>
      ipcRenderer.invoke(IpcChannel.SettingsSetAutoStart, enabled),
    setDashboardLayout: (layout: DashTile[]) =>
      ipcRenderer.invoke(IpcChannel.SettingsSetDashboardLayout, layout),
    onChange: (cb: (state: Settings) => void) => {
      const handler = (_: unknown, state: Settings) => cb(state);
      ipcRenderer.on(IpcChannel.SettingsChange, handler);
      return () => {
        ipcRenderer.off(IpcChannel.SettingsChange, handler);
      };
    },
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('notch', api);
  } catch (err) {
    console.error('[preload] expose failed', err);
  }
} else {
  // Fallback sans contextIsolation : ne devrait jamais être pris en
  // production (on force contextIsolation:true dans notchWindow.ts) mais
  // garde l'app fonctionnelle si quelqu'un retire l'isolation pour debug.
  // @ts-expect-error fallback
  window.notch = api;
}
