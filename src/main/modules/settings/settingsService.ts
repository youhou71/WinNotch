/**
 * Service de persistance des réglages utilisateur (electron-store).
 *
 * Stocke un objet `Settings` dans `%APPDATA%/WinNotch/config.json`
 * (chemin par défaut d'electron-store). En mode dev (`npm run dev`),
 * `src/main/bootstrap.ts` override `userData` vers `WinNotch-dev` pour
 * isoler la config du build installé. Le store survit entre les
 * lancements et est partagé entre tous les modules de l'app.
 *
 * Tous les setters retournent le `Settings` complet à jour pour que le
 * renderer puisse réconcilier son state sans seconde IPC. Un push
 * `settings:change` est aussi émis pour les changements déclenchés hors
 * du renderer (ex. raccourci global Ctrl+Shift+D dans le main).
 *
 * Évolution de schéma : electron-store ne fait pas de migration
 * automatique pour les champs ajoutés à `defaults` après installation.
 * On force donc un `mergeDefaults` au démarrage qui complète chaque
 * propriété absente — utile quand on ajoute un nouveau module ou une
 * nouvelle config.
 */
import { app, ipcMain } from 'electron';
import Store from 'electron-store';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'node:events';
import {
  DEFAULT_SETTINGS,
  IpcChannel,
  type DashTile,
  type DashTileId,
  type Density,
  type ModuleConfig,
  type ModuleId,
  type Settings,
  type Task,
} from '../../../shared/types';

/**
 * IDs valides pour une tuile du dashboard — utilisé en validation runtime
 * de `dashboardLayout` quand le renderer pousse un nouveau layout (drag-
 * and-drop dans Settings → Disposition) ET au boot pour réconcilier un
 * `config.json` éventuellement périmé.
 *
 * On déclare une table `Record<DashTileId, true>` (via `satisfies`) plutôt
 * qu'un simple `DashTileId[]` : ainsi TypeScript échoue au build si un
 * nouvel ID est ajouté à l'union sans être enregistré ici. Sans ce filet,
 * un drag-and-drop d'une nouvelle tuile serait silencieusement filtré par
 * `mergeDashboardLayout()` et l'utilisateur ne pourrait jamais la
 * réordonner. Cas réel rencontré au moment d'ajouter la tuile `system`.
 */
const DASH_TILE_ID_TABLE = {
  music: true,
  meetings: true,
  gitlab: true,
  gitlocal: true,
  claude: true,
  tasks: true,
  vpn: true,
  teams: true,
  system: true,
} satisfies Record<DashTileId, true>;

const VALID_DASH_TILE_IDS = Object.keys(DASH_TILE_ID_TABLE) as DashTileId[];
import { getNotchWindow } from '../../window/notchWindow';

const store = new Store<Settings>({
  defaults: DEFAULT_SETTINGS,
  name: 'config',
});

/**
 * Bus d'événements interne au main process, utilisé par les modules qui
 * doivent réagir à un changement de réglage sans dépendre d'un push IPC.
 *
 * Événements :
 *  - `dnd:changed` `{ value: boolean, source: 'user' | 'external' }` —
 *    émis quand `dnd` bascule. `source='user'` quand l'utilisateur a
 *    cliqué (UI, Ctrl+Shift+D), `source='external'` quand un autre module
 *    a forcé la valeur via `setDndFromExternal` (typiquement le module
 *    Teams qui synchronise le DND avec le statut DoNotDisturb de Teams).
 *    Les consommateurs filtrent par `source` pour éviter les boucles —
 *    par exemple Teams ignore `source='external'` car c'est lui qui a
 *    initié la mise à jour.
 */
export const settingsEvents = new EventEmitter();
export interface DndChangedPayload {
  value: boolean;
  source: 'user' | 'external';
}

/**
 * Complète l'état persisté avec les valeurs par défaut pour gérer les
 * évolutions de schéma sans casser une installation existante.
 * Merge à 2 niveaux : top-level Settings + chaque section moduleConfig.
 */
function mergeDefaults(): void {
  const current: Partial<Settings> = {
    dnd: store.get('dnd'),
    tasks: store.get('tasks'),
    density: store.get('density'),
    modules: store.get('modules'),
    moduleConfig: store.get('moduleConfig'),
    autoStart: store.get('autoStart'),
    dashboardLayout: store.get('dashboardLayout'),
  };

  store.set('dnd', current.dnd ?? DEFAULT_SETTINGS.dnd);
  store.set('tasks', current.tasks ?? DEFAULT_SETTINGS.tasks);
  store.set('density', current.density ?? DEFAULT_SETTINGS.density);
  store.set('modules', { ...DEFAULT_SETTINGS.modules, ...(current.modules ?? {}) });
  store.set('autoStart', current.autoStart ?? DEFAULT_SETTINGS.autoStart);
  store.set('dashboardLayout', mergeDashboardLayout(current.dashboardLayout));

  // Shallow merge par section : suffisant tant qu'on n'a pas de configs
  // imbriquées profondes (gitlab.account est plat, par exemple).
  // Le cast via `as any` est volontaire — TS ne peut pas exprimer
  // "même clé du même type" dans une boucle d'enum.
  const existing = current.moduleConfig ?? ({} as Partial<ModuleConfig>);
  const mergedModuleConfig = { ...DEFAULT_SETTINGS.moduleConfig } as ModuleConfig;
  for (const key of Object.keys(DEFAULT_SETTINGS.moduleConfig) as ModuleId[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mergedModuleConfig as any)[key] = {
      ...DEFAULT_SETTINGS.moduleConfig[key],
      ...((existing as Partial<ModuleConfig>)[key] ?? {}),
    };
  }
  store.set('moduleConfig', mergedModuleConfig);
}

/**
 * Réconcilie un `dashboardLayout` éventuellement périmé avec les tuiles
 * connues actuellement :
 *  - si stocké null/absent → renvoie le défaut intégral
 *  - les entrées invalides (id inconnu, cols hors [1,12], doublons) sont
 *    filtrées
 *  - les nouvelles tuiles ajoutées au DashTileId entre deux versions
 *    sont concaténées en fin de liste avec leur largeur défaut, pour
 *    que l'utilisateur les retrouve sans devoir reset son layout
 */
function mergeDashboardLayout(stored: DashTile[] | undefined): DashTile[] {
  if (!Array.isArray(stored)) return DEFAULT_SETTINGS.dashboardLayout;
  const seen = new Set<DashTileId>();
  const cleaned: DashTile[] = [];
  for (const item of stored) {
    if (!item || typeof item !== 'object') continue;
    const id = item.id;
    if (!VALID_DASH_TILE_IDS.includes(id) || seen.has(id)) continue;
    const cols = Math.max(1, Math.min(12, Math.round(item.cols)));
    if (!Number.isFinite(cols)) continue;
    cleaned.push({ id, cols });
    seen.add(id);
  }
  // Ajoute les tuiles manquantes (nouveaux modules) avec leur largeur défaut.
  for (const def of DEFAULT_SETTINGS.dashboardLayout) {
    if (!seen.has(def.id)) cleaned.push(def);
  }
  return cleaned;
}

// Migration au boot — idempotente.
mergeDefaults();

/** Lit l'état complet — toujours valide grâce au mergeDefaults au boot. */
function getAll(): Settings {
  return {
    dnd: store.get('dnd'),
    tasks: store.get('tasks'),
    density: store.get('density'),
    modules: store.get('modules'),
    moduleConfig: store.get('moduleConfig'),
    autoStart: store.get('autoStart'),
    dashboardLayout: store.get('dashboardLayout'),
  };
}

/** Push l'état au renderer (pour synchroniser après un toggle externe). */
function broadcast(state: Settings): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.SettingsChange, state);
}

/**
 * Re-publie le `Settings` courant au renderer.
 *
 * Utilisé par les autres services (meetings, etc.) qui modifient
 * `moduleConfig.<id>` directement dans le store et ont besoin de
 * propager la nouvelle valeur au SettingsContext renderer.
 */
export function broadcastSettings(): void {
  broadcast(getAll());
}

/**
 * Bascule l'état DND. Exporté car appelé directement par le raccourci
 * global Ctrl+Shift+D (côté main), pas seulement via IPC.
 *
 * Émet `dnd:changed` avec `source='user'` — c'est l'utilisateur qui a
 * agi (UI ou raccourci). Les consommateurs (ex. teamsService) peuvent
 * réagir en synchronisant un système externe (statut Teams DoNotDisturb).
 */
export function toggleDnd(): Settings {
  const next = !store.get('dnd');
  store.set('dnd', next);
  const state = getAll();
  broadcast(state);
  settingsEvents.emit('dnd:changed', {
    value: next,
    source: 'user',
  } satisfies DndChangedPayload);
  return state;
}

/**
 * Force la valeur de `dnd` depuis un autre module main (ex. teamsService
 * qui a détecté un changement côté Teams). Persiste + broadcast au
 * renderer **sans** ré-émettre `dnd:changed` (sinon le module qui a
 * initié la mise à jour la re-recevrait → boucle infinie).
 */
export function setDndFromExternal(value: boolean): void {
  if (store.get('dnd') === value) return;
  store.set('dnd', value);
  broadcast(getAll());
}

function addTask(text: string): Settings {
  const trimmed = text.trim();
  if (!trimmed) return getAll();
  const task: Task = {
    id: randomUUID(),
    text: trimmed,
    done: false,
    createdAt: Date.now(),
  };
  const tasks = [task, ...store.get('tasks')];
  store.set('tasks', tasks);
  const state = getAll();
  broadcast(state);
  return state;
}

function toggleTask(id: string): Settings {
  const tasks = store
    .get('tasks')
    .map((t) => (t.id === id ? { ...t, done: !t.done } : t));
  store.set('tasks', tasks);
  const state = getAll();
  broadcast(state);
  return state;
}

function removeTask(id: string): Settings {
  const tasks = store.get('tasks').filter((t) => t.id !== id);
  store.set('tasks', tasks);
  const state = getAll();
  broadcast(state);
  return state;
}

function clearDoneTasks(): Settings {
  const tasks = store.get('tasks').filter((t) => !t.done);
  store.set('tasks', tasks);
  const state = getAll();
  broadcast(state);
  return state;
}

function setModule(id: ModuleId, enabled: boolean): Settings {
  const modules = { ...store.get('modules'), [id]: enabled };
  store.set('modules', modules);
  const state = getAll();
  broadcast(state);
  return state;
}

function setDensity(density: Density): Settings {
  store.set('density', density);
  const state = getAll();
  broadcast(state);
  return state;
}

/**
 * Merge superficiel d'une section moduleConfig. Pas de deep merge :
 * pour les sous-objets (gitlab.notify, gitlab.account), passer
 * l'objet complet dans le patch.
 */
function patchModuleConfig<K extends ModuleId>(
  id: K,
  patch: Partial<ModuleConfig[K]>,
): Settings {
  const cfg = store.get('moduleConfig');
  const next = { ...cfg, [id]: { ...cfg[id], ...patch } };
  store.set('moduleConfig', next);
  const state = getAll();
  broadcast(state);
  return state;
}

/**
 * Active ou désactive le démarrage automatique avec Windows.
 *
 * `app.setLoginItemSettings({ openAtLogin })` écrit / supprime une entrée
 * dans `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. Pas besoin
 * d'élévation (clé HKCU = courant). En dev (`!app.isPackaged`), Electron
 * crée une entrée qui pointe vers electron.exe — pas idéal, mais le toggle
 * reste fonctionnel pour tester le code.
 *
 * `--hidden` est un flag custom qu'on pourrait lire dans `process.argv`
 * côté `index.ts` pour démarrer en mode super-discret (pas pour l'instant
 * — le notch démarre déjà en collapsed, donc pas d'intrusion).
 */
function setAutoStart(enabled: boolean): Settings {
  store.set('autoStart', enabled);
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      // `path` et `args` sont optionnels : par défaut Electron utilise
      // `process.execPath`, ce qui est ce qu'on veut en prod
      // (l'.exe installé via NSIS).
    });
  } catch (err) {
    console.warn('[settings] setLoginItemSettings échec:', err);
  }
  const state = getAll();
  broadcast(state);
  return state;
}

/**
 * Persiste un nouveau layout pour le dashboard. Le payload reçu du
 * renderer passe par le même filtre que `mergeDashboardLayout` :
 *  - cols clamp à [1,12]
 *  - id inconnus / doublons silencieusement ignorés
 *  - tuiles manquantes ajoutées en queue
 * Garantit que l'état persisté reste cohérent même si le renderer
 * envoie un payload partiel ou corrompu.
 */
function setDashboardLayout(layout: DashTile[]): Settings {
  store.set('dashboardLayout', mergeDashboardLayout(layout));
  const state = getAll();
  broadcast(state);
  return state;
}

/**
 * Réconcilie l'état système avec le store au démarrage.
 *
 * Si l'utilisateur a supprimé manuellement l'entrée Run via msconfig,
 * regedit ou « Démarrage » du Gestionnaire des tâches, on veut que le
 * toggle UI reflète la réalité — pas l'état figé du store.
 */
export function syncAutoStartFromSystem(): void {
  try {
    const stored = store.get('autoStart');
    const actual = app.getLoginItemSettings().openAtLogin;
    if (stored !== actual) {
      store.set('autoStart', actual);
    }
  } catch (err) {
    console.warn('[settings] syncAutoStartFromSystem échec:', err);
  }
}

/**
 * Enregistre les handlers IPC settings. À appeler une seule fois au
 * démarrage du main process, avant la création de la fenêtre.
 */
export function registerSettingsIpc(): void {
  ipcMain.handle(IpcChannel.SettingsGetAll, () => getAll());
  ipcMain.handle(IpcChannel.SettingsToggleDnd, () => toggleDnd());
  ipcMain.handle(IpcChannel.SettingsAddTask, (_e, text: string) => addTask(text));
  ipcMain.handle(IpcChannel.SettingsToggleTask, (_e, id: string) => toggleTask(id));
  ipcMain.handle(IpcChannel.SettingsRemoveTask, (_e, id: string) => removeTask(id));
  ipcMain.handle(IpcChannel.SettingsClearDoneTasks, () => clearDoneTasks());
  ipcMain.handle(
    IpcChannel.SettingsSetModule,
    (_e, id: ModuleId, enabled: boolean) => setModule(id, enabled),
  );
  ipcMain.handle(IpcChannel.SettingsSetDensity, (_e, density: Density) =>
    setDensity(density),
  );
  ipcMain.handle(
    IpcChannel.SettingsPatchModuleConfig,
    (_e, id: ModuleId, patch: Partial<ModuleConfig[ModuleId]>) =>
      patchModuleConfig(id, patch),
  );
  ipcMain.handle(IpcChannel.SettingsSetAutoStart, (_e, enabled: boolean) =>
    setAutoStart(enabled),
  );
  ipcMain.handle(
    IpcChannel.SettingsSetDashboardLayout,
    (_e, layout: DashTile[]) => setDashboardLayout(layout),
  );
}
