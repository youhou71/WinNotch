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
} from '../../../shared/types';
import {
  createAutostartTask,
  isAutostartTaskRegistered,
  removeAutostartTask,
} from './autostartTask';

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
  'claude.live': true,
  'claude.usage': true,
  tasks: true,
  vpn: true,
  teams: true,
  system: true,
  bambu: true,
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
  // Migration v1.1 — refonte ModuleId hiérarchique. Le module historique
  // `claude` devient `claude.live` (groupe Claude regroupant aussi le
  // nouveau `claude.usage`). On renomme les clés persistées AVANT le
  // merge normal pour que les préférences utilisateur survivent au bump.
  // Idempotente : à la seconde passe, plus aucune clé `claude` n'est
  // présente, le bloc est no-op.
  migrateClaudeLiveRename();

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

  // Migration douce `pollSec` (legacy) → `pollMs` (v1.0+). Si une vieille
  // config porte encore `pollSec`, on le convertit (×1000) puis on retire
  // le champ legacy. Ainsi les préférences utilisateur survivent au bump.
  migratePollSecToPollMs(mergedModuleConfig);

  // Clamp des champs avec borne dure (sécurité contre un édit manuel
  // du config.json qui pousserait des valeurs aberrantes).
  clampModuleConfigBounds(mergedModuleConfig);

  store.set('moduleConfig', mergedModuleConfig);
}

/**
 * Clamps de sécurité pour les champs `ModuleConfig` à borne dure. Le UI
 * Settings borne déjà via `<input type="range" min max>`, mais un édit
 * direct du `config.json` pourrait pousser une valeur aberrante (ex.
 * `clipboard.maxItems = 50000` qui ferait gonfler l'historique chiffré).
 */
function clampModuleConfigBounds(config: ModuleConfig): void {
  // clipboard.maxItems : limite [10, 500]. Au-delà de 500 entrées texte
  // chiffrées DPAPI, la latence de lecture-décodage devient sensible et
  // la sérialisation IPC bourdonne. 10 est un plancher de sécurité pour
  // ne pas perdre tout l'historique si quelqu'un règle à 0.
  if (typeof config.clipboard?.maxItems === 'number') {
    config.clipboard.maxItems = Math.max(
      10,
      Math.min(500, Math.round(config.clipboard.maxItems)),
    );
  }
}

/**
 * Migration v1.1 : renomme `claude` (legacy moduleId plat) en `claude.live`
 * (nouveau moduleId hiérarchique de la famille « Claude »).
 *
 * Touche trois emplacements persistés dans `config.json` :
 *  - `modules.claude` (boolean) → `modules['claude.live']`
 *  - `moduleConfig.claude` (object) → `moduleConfig['claude.live']`
 *  - `dashboardLayout[].id === 'claude'` → `'claude.live'`
 *
 * Idempotente : à la seconde passe les clés `claude` n'existent plus, le
 * bloc est no-op. Aucun risque de perte si l'utilisateur a déjà la
 * nouvelle clé renseignée — on ne renomme que si elle est absente.
 */
function migrateClaudeLiveRename(): void {
  let mutated = false;

  // 1. modules.claude → modules['claude.live']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modules = store.get('modules') as any;
  if (modules && typeof modules === 'object' && 'claude' in modules) {
    if (!('claude.live' in modules)) {
      modules['claude.live'] = modules.claude;
    }
    delete modules.claude;
    store.set('modules', modules);
    mutated = true;
  }

  // 2. moduleConfig.claude → moduleConfig['claude.live']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moduleConfig = store.get('moduleConfig') as any;
  if (moduleConfig && typeof moduleConfig === 'object' && 'claude' in moduleConfig) {
    if (!('claude.live' in moduleConfig)) {
      moduleConfig['claude.live'] = moduleConfig.claude;
    }
    delete moduleConfig.claude;
    store.set('moduleConfig', moduleConfig);
    mutated = true;
  }

  // 3. dashboardLayout : remplace { id: 'claude' } par { id: 'claude.live' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layout = store.get('dashboardLayout') as any;
  if (Array.isArray(layout)) {
    let layoutMutated = false;
    for (const tile of layout) {
      if (tile && tile.id === 'claude') {
        tile.id = 'claude.live';
        layoutMutated = true;
      }
    }
    if (layoutMutated) {
      store.set('dashboardLayout', layout);
      mutated = true;
    }
  }

  if (mutated) {
    console.log('[settings] migration v1.1: claude → claude.live (modules / moduleConfig / dashboardLayout)');
  }
}

/**
 * Migration `pollSec` → `pollMs` au boot (v0.9.x → v1.0).
 *
 * 4 modules concernés : `vpn`, `teams`, `gitlab`, `gitlocal`. Pour chacun :
 *  - si la config persistée contient encore `pollSec` (cast volontaire car
 *    le type TS ne l'a plus), on calcule `pollMs = pollSec × 1000`
 *  - on supprime le champ legacy pour que la prochaine lecture parte propre
 *
 * Idempotent : déjà migré → no-op.
 */
function migratePollSecToPollMs(config: ModuleConfig): void {
  const modules: Array<keyof ModuleConfig> = ['vpn', 'teams', 'gitlab', 'gitlocal'];
  for (const key of modules) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const section = config[key] as any;
    if (!section) continue;
    if (typeof section.pollSec === 'number' && typeof section.pollMs !== 'number') {
      section.pollMs = section.pollSec * 1000;
      console.log(
        `[settings] migration v1: ${key}.pollSec=${section.pollSec}s → pollMs=${section.pollMs}ms`,
      );
    }
    if ('pollSec' in section) delete section.pollSec;
  }
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
 * Depuis v1.0, on passe par le **Task Scheduler** (`Register-ScheduledTask`
 * via PowerShell) et plus par la Run key historique. Raison : la Run key
 * subit le « Startup Delay » de Windows (10 s + jusqu'à 150 s aléatoires),
 * ce qui faisait apparaître WinNotch 1 à 2 minutes après l'ouverture de
 * session. Une task `AtLogOn` se déclenche immédiatement.
 *
 * Migration douce des installations v0.x : à chaque appel (ON ou OFF),
 * on supprime aussi l'éventuelle entrée Run laissée par une version
 * antérieure via `app.setLoginItemSettings({ openAtLogin: false })`. Ça
 * évite que l'utilisateur se retrouve avec les DEUX mécanismes actifs
 * en parallèle après bump.
 *
 * En dev (`!app.isPackaged`), on n'installe **pas** la task — sinon elle
 * pointerait vers `electron.exe` qui n'a aucun sens à lancer seul au
 * boot. Le toggle UI reste fonctionnel mais sans effet système.
 *
 * Le détail d'implémentation est dans `autostartTask.ts`.
 */
async function setAutoStart(enabled: boolean): Promise<Settings> {
  store.set('autoStart', enabled);

  // 1. Cleanup défensif de la Run key v0.x (idempotent).
  try {
    app.setLoginItemSettings({ openAtLogin: false });
  } catch (err) {
    console.warn('[settings] cleanup legacy Run key échec:', err);
  }

  // 2. Apply via Task Scheduler. Skip en dev (cf. docstring).
  if (app.isPackaged) {
    if (enabled) {
      const result = await createAutostartTask(app.getPath('exe'));
      if (!result.ok) {
        console.warn('[settings] createAutostartTask échec:', result.error);
      }
    } else {
      const result = await removeAutostartTask();
      if (!result.ok) {
        console.warn('[settings] removeAutostartTask échec:', result.error);
      }
    }
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
 * Trois cas à gérer :
 *  1. **Migration v0.x → v1** : l'utilisateur avait l'autostart activé
 *     via Run key. Au premier boot v1, on crée la task Scheduler
 *     équivalente et on supprime la legacy Run key. Transparent.
 *  2. **Suppression manuelle de la task** : si l'utilisateur a supprimé
 *     la task via Task Scheduler, msconfig ou « Démarrage » du Gestionnaire
 *     des tâches, on met à jour le store pour que le toggle UI le reflète.
 *  3. **État cohérent** : rien à faire.
 *
 * En dev (`!app.isPackaged`), on saute la sync (la task ne devrait pas
 * exister, cf. `setAutoStart`).
 */
export async function syncAutoStartFromSystem(): Promise<void> {
  try {
    if (!app.isPackaged) return;

    const stored = store.get('autoStart');
    const taskActive = await isAutostartTaskRegistered();
    const legacyRunActive = app.getLoginItemSettings().openAtLogin;

    // Cas 1 : migration v0.x → v1. Store dit « activé » mais aucune task,
    // probablement parce que la version précédente utilisait la Run key.
    // On crée la task et on nettoie la Run key.
    if (stored && !taskActive) {
      const result = await createAutostartTask(app.getPath('exe'));
      if (result.ok) {
        try { app.setLoginItemSettings({ openAtLogin: false }); } catch {
          // Si l'effacement de la Run key échoue, pas grave : la task
          // est en place, l'utilisateur aura juste un doublon temporaire
          // visible dans « Démarrage ». Le prochain toggle nettoiera.
        }
      } else {
        console.warn('[settings] migration v0→v1 autostart échec:', result.error);
      }
      return;
    }

    // Cas 1bis : Run key résiduelle alors que le store dit « désactivé ».
    // Probablement une install v0.x avec autostart actif puis désactivé
    // côté store seulement. Nettoyage opportuniste.
    if (!stored && legacyRunActive) {
      try { app.setLoginItemSettings({ openAtLogin: false }); } catch {
        // ignore — cleanup best-effort
      }
    }

    // Cas 2 : store ≠ état réel de la task → on aligne le store sur le
    // système (l'utilisateur a probablement supprimé la task manuellement).
    // On broadcast pour que le toggle UI dans Settings reflète la réalité
    // même si le renderer était déjà monté avant la sync.
    if (stored !== taskActive) {
      store.set('autoStart', taskActive);
      broadcast(getAll());
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
