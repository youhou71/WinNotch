/**
 * Façade IPC du module Audio.
 *
 * Centralise :
 *  - les 4 handlers `invoke` consommés par le renderer (get/set volume,
 *    set muted, set device)
 *  - un polling toutes les 2 s pour détecter les changements externes
 *    (touches Volume Windows, sleep, etc.)
 *  - un push événementiel `audio:change` quand l'état diffère du cache
 *
 * Budget spawns (audit perf P2) — le polling spawnait 3 process/cycle
 * (loudness ×2 + SoundVolumeView + fichier temp), soit ~90 process/min en
 * continu, chacun scanné par l'antivirus. Désormais :
 *  - le polling ne lit QUE volume+muted via UN spawn (`getVolumeInfo`)
 *  - la liste des devices (SoundVolumeView + fichier temp) n'est lue qu'à
 *    la demande : ouverture du panneau audio (`AudioGetState`) avec un
 *    cache TTL, et après un changement de device (`AudioSetDevice`).
 *    Un branchement de casque externe est donc reflété au prochain
 *    `AudioGetState` — suffisant, la liste n'est visible que panneau ouvert.
 *  - les lectures concurrentes sont mutualisées (garde in-flight, pattern
 *    de systemService) : plus d'empilement de process si le système ralentit
 *    (le timeout SVV de 8 s pouvait empiler jusqu'à 4 instances).
 *  - le polling est suspendu pendant la mise en veille (powerMonitor).
 *
 * L'état est mis en cache pour pouvoir réagir gracieusement aux échecs
 * partiels : si une source (volume / devices) échoue à un cycle, on
 * conserve la dernière valeur connue pour les autres.
 *
 * **Surveillance en rétracté** (depuis l'ajout de la chip « sortie
 * courante »). La chip affiche le type de sortie même notch fermé, donc
 * quelqu'un lit bien cet état — mais on ne réactive pas pour autant le
 * cycle de 2 s. Le compromis retenu :
 *  - un tick léger relit les endpoints audio **dans le registre**, via le
 *    PowerShell résident : aucune création de process (cf. `endpoints.ts`) ;
 *  - il ne déclenche `SoundVolumeView` (1 process) que si la liste des
 *    sorties actives a changé — casque branché, appareil BT connecté, dock ;
 *  - un filet de sécurité espacé (`fullCheckMs`, 5 min par défaut) couvre
 *    le seul cas que le registre ne montre pas : un changement de sortie
 *    par défaut fait depuis le panneau Windows ;
 *  - le volume n'est **pas** relu dans ce mode (la chip ne l'affiche pas),
 *    donc le binaire `loudness` reste au repos.
 */
import { ipcMain, powerMonitor } from 'electron';
import Store from 'electron-store';
import {
  DEFAULT_SETTINGS,
  IpcChannel,
  type AudioState,
  type AudioDevice,
  type Settings,
} from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import { getNotchMode, onNotchModeChange } from '../../shortcuts/altPeek';
import { getVolumeInfo, setVolume, setMuted, type VolumeInfo } from './volume';
import { listOutputDevices, setDefaultOutput } from './devices';
import {
  endpointsSignature,
  listActiveEndpoints,
  type AudioEndpointInfo,
} from './endpoints';

/**
 * Intervalle du polling volume/muted. 2 s est un compromis entre réactivité
 * (l'utilisateur voit son volume bouger après avoir appuyé sur les touches
 * média) et coût (un spawn léger par cycle).
 */
const POLL_INTERVAL_MS = 2000;

/**
 * Durée de validité du cache devices. À l'ouverture du panneau audio, une
 * liste plus jeune que ce TTL est resservie telle quelle (zéro spawn SVV) ;
 * plus vieille, elle est relue. 30 s suffit : un changement de périphérique
 * pendant que le panneau est ouvert passe par `AudioSetDevice` qui force
 * le refresh.
 */
const DEVICES_TTL_MS = 30_000;

/**
 * Délais (ms) de relance de la liste des sorties au démarrage à froid.
 *
 * Au login, le service audio Windows et/ou SoundVolumeView ne sont pas
 * toujours prêts : le premier `refresh({withDevices:true})` renvoie une
 * liste vide. On enchaîne alors des relectures à délais croissants jusqu'à
 * obtenir au moins un périphérique, puis on s'arrête. Chaque essai passe
 * par `refresh()` → broadcast `audio:change` dès que la liste se remplit,
 * sans attendre l'ouverture du panneau audio. Fenêtre totale ~60 s, ce qui
 * laisse aussi le temps au circuit breaker SVV (cooldown 15 s) de repasser
 * en half-open si le premier spawn avait time-out.
 */
const DEVICE_WARMUP_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

/**
 * Plancher de la cadence de surveillance en rétracté. Le tick ne spawne
 * rien, mais il occupe le PowerShell résident partagé avec les modules
 * Système / Confidentialité / VPN : inutile de descendre plus bas.
 */
const MIN_WATCH_MS = 2_000;

/**
 * Durée de validité du cache des endpoints registre. Volontairement court :
 * la lecture est quasi gratuite, ce TTL ne sert qu'à mutualiser les appels
 * rapprochés (tick de surveillance + lecture SVV déclenchée juste après).
 */
const ENDPOINTS_TTL_MS = 3_000;

/**
 * Attente **souple** de la lecture registre. Au tout premier appel, le
 * PowerShell résident paie l'autoload de ses modules (plusieurs secondes sur
 * un poste avec EDR) : sans ce garde-fou, la première énumération des
 * sorties audio au démarrage attendrait cet autoload avant même de lancer
 * SoundVolumeView — soit exactement le symptôme « Aucune sortie au
 * lancement automatique » corrigé précédemment.
 *
 * Passé ce délai, on repart avec le cache (vide au boot → classification
 * par nom pour ce cycle) ; la lecture continue en tâche de fond et son
 * résultat servira au cycle suivant. On ne raccourcit **pas** le timeout de
 * `runPersistentPowershell` à la place : son expiration tue le process
 * résident, que les modules Système / Confidentialité / VPN partagent.
 */
const ENDPOINTS_SOFT_WAIT_MS = 2_500;

/**
 * Période de grâce après le démarrage pendant laquelle **aucune** lecture
 * registre n'est envoyée au PowerShell résident.
 *
 * Pourquoi : la boucle traite ses requêtes **séquentiellement** et est
 * partagée avec les modules Système (1 Hz), Confidentialité (4 s) et VPN
 * (10 s). Au démarrage à froid, son premier appel paie l'autoload des
 * modules CDXML/CIM — plusieurs secondes, davantage avec un EDR qui scanne.
 * Y ajouter une requête toutes les 5 s dès la première seconde allonge la
 * file au pire moment : constaté en conditions réelles, la lecture registre
 * ET la détection VPN expiraient toutes deux (à l'époque, une expiration
 * tuait encore le process partagé — ce n'est plus le cas, cf. l'expiration
 * souple de `persistentPowershell.ts`, mais deux lectures perdues restent
 * deux lectures perdues).
 *
 * Pendant la grâce, le type de sortie vient de l'heuristique de nom
 * (`classifyDevice`) : la chip est correcte dans les cas courants dès le
 * boot, et se corrige d'elle-même au premier tick suivant.
 */
const ENDPOINTS_BOOT_GRACE_MS = 20_000;

/** Instant de chargement du module ≈ démarrage de l'app. */
const startedAt = Date.now();

const store = new Store<Settings>({
  defaults: DEFAULT_SETTINGS,
  name: 'config',
});

/** Dernier état connu — sert de fallback en cas d'échec partiel. */
let cached: AudioState = {
  level: 0,
  muted: false,
  devices: [],
  currentDeviceId: null,
};

let pollTimer: NodeJS.Timeout | null = null;
/** Désabonnement du changement de mode notch (armé par `startAudioPolling`). */
let unsubscribeMode: (() => void) | null = null;
/** Timer de la relance devices en cours (warm-up boot/réveil), null si aucune. */
let warmupTimer: NodeJS.Timeout | null = null;
/** True entre les events powerMonitor suspend → resume : gèle le polling. */
let suspended = false;

/** Timestamp de la dernière lecture devices réussie (epoch ms, 0 = jamais). */
let devicesFetchedAt = 0;

/** Tick de surveillance en rétracté (cf. en-tête), null si à l'arrêt. */
let watchTimer: NodeJS.Timeout | null = null;
/** Garde de réentrance du tick de surveillance. */
let watchInFlight = false;
/** Endpoints registre en cache + horodatage de la dernière lecture. */
let endpointsCache: AudioEndpointInfo[] = [];
let endpointsFetchedAt = 0;
let endpointsInFlight: Promise<AudioEndpointInfo[]> | null = null;
/**
 * Signature des endpoints au tick précédent. `null` = pas encore de
 * référence : le premier tick ne déclenche donc aucune lecture SVV (il
 * n'a rien à comparer).
 */
let lastEndpointsSig: string | null = null;

/**
 * Gardes anti-réentrance : une seule lecture volume et une seule lecture
 * devices en vol à la fois. Les appelants concurrents (tick du polling +
 * invokes IPC simultanés) partagent la même promesse au lieu d'empiler
 * des child_process.
 */
let volumeInFlight: Promise<VolumeInfo> | null = null;
let devicesInFlight: Promise<AudioDevice[]> | null = null;

/**
 * Coalescence latest-wins des écritures de volume (défense en profondeur
 * derrière le throttle du renderer) : pendant qu'un spawn `setVolume` est
 * en vol, les nouvelles demandes ne font que remplacer la cible. Au retour,
 * un seul spawn supplémentaire applique la dernière valeur demandée. Une
 * rafale de N demandes coûte donc au plus 2 spawns sérialisés au lieu de N
 * concurrents.
 */
let pendingVolume: number | null = null;
let setVolumeDrain: Promise<void> | null = null;

function setVolumeCoalesced(level: number): Promise<void> {
  pendingVolume = level;
  if (!setVolumeDrain) {
    setVolumeDrain = (async () => {
      while (pendingVolume !== null) {
        const target = pendingVolume;
        pendingVolume = null;
        await setVolume(target);
      }
    })().finally(() => {
      setVolumeDrain = null;
    });
  }
  return setVolumeDrain;
}

function readVolumeInfo(): Promise<VolumeInfo> {
  if (!volumeInFlight) {
    volumeInFlight = getVolumeInfo().finally(() => {
      volumeInFlight = null;
    });
  }
  return volumeInFlight;
}

function readDevices(): Promise<AudioDevice[]> {
  if (!devicesInFlight) {
    devicesInFlight = readEndpoints()
      .then((endpoints) => listOutputDevices(endpoints))
      .then((devices) => {
        devicesFetchedAt = Date.now();
        return devices;
      })
      .finally(() => {
        devicesInFlight = null;
      });
  }
  return devicesInFlight;
}

/**
 * Lit les endpoints du registre (type réel + Bluetooth), avec mutualisation
 * des appels concurrents et un TTL court.
 *
 * Une lecture qui revient **vide** est traitée comme un échec probable
 * (PowerShell résident indisponible, coupe-circuit ouvert) : on conserve le
 * cache précédent plutôt que de perdre la classification. Conséquence
 * assumée : le cas « plus aucune sortie active du tout » (rarissime, et de
 * toute façon sans chip à afficher) n'est pas distingué.
 */
function readEndpoints(force = false): Promise<AudioEndpointInfo[]> {
  // Grâce de démarrage : on ne met rien dans la file du PowerShell résident
  // tant que les autres modules n'ont pas eu le temps de le chauffer.
  if (Date.now() - startedAt < ENDPOINTS_BOOT_GRACE_MS) {
    return Promise.resolve(endpointsCache);
  }
  if (!force && Date.now() - endpointsFetchedAt < ENDPOINTS_TTL_MS) {
    return Promise.resolve(endpointsCache);
  }
  if (!endpointsInFlight) {
    endpointsInFlight = listActiveEndpoints()
      .then((list) => {
        if (list.length > 0) {
          endpointsCache = list;
          endpointsFetchedAt = Date.now();
        }
        return endpointsCache;
      })
      .finally(() => {
        endpointsInFlight = null;
      });
  }
  // Course souple : on ne bloque jamais l'appelant plus longtemps que
  // `ENDPOINTS_SOFT_WAIT_MS`. La lecture en vol n'est pas annulée — elle
  // remplira le cache pour le prochain cycle.
  return Promise.race([
    endpointsInFlight,
    new Promise<AudioEndpointInfo[]>((resolve) => {
      // `unref` : ce timer ne doit jamais retenir la boucle d'événements.
      setTimeout(() => resolve(endpointsCache), ENDPOINTS_SOFT_WAIT_MS).unref();
    }),
  ]);
}

function devicesCacheStale(): boolean {
  return Date.now() - devicesFetchedAt > DEVICES_TTL_MS;
}

/** Le module Audio est-il activé (footer + chip + pollings) ? */
function audioEnabled(): boolean {
  return store.get('modules').audio !== false;
}

/** Config du module, avec repli sur les défauts si le store est incomplet. */
function audioConfig(): Settings['moduleConfig']['audio'] {
  return store.get('moduleConfig').audio ?? DEFAULT_SETTINGS.moduleConfig.audio;
}

/** La chip de sortie est-elle demandée dans le notch rétracté ? */
function collapsedChipEnabled(): boolean {
  return audioEnabled() && audioConfig().collapsed;
}

/**
 * Lit l'état audio. `Promise.allSettled` garantit qu'une erreur sur une
 * source n'écrase pas les valeurs de l'autre (ex. SVV peut être en
 * circuit-breaker pendant que loudness fonctionne très bien).
 *
 * @param withDevices relit la liste des devices via SoundVolumeView
 *                    (coûteux : spawn + fichier temp). Sinon, le cache
 *                    devices est resservi tel quel.
 * @param withVolume  relit volume + mute via le binaire `loudness`
 *                    (1 spawn). Passer `false` quand seul le périphérique
 *                    de sortie intéresse — c'est le cas de la surveillance
 *                    en rétracté, où la chip n'affiche pas le volume.
 */
async function readState(
  withDevices: boolean,
  withVolume = true,
): Promise<AudioState> {
  const [volRes, devRes] = await Promise.allSettled([
    withVolume
      ? readVolumeInfo()
      : Promise.resolve({ level: cached.level, muted: cached.muted }),
    withDevices ? readDevices() : Promise.resolve(cached.devices),
  ]);
  if (volRes.status === 'rejected') console.error('[audio] getVolumeInfo rejected:', volRes.reason);
  if (devRes.status === 'rejected') console.error('[audio] listOutputDevices rejected:', devRes.reason);
  const level = volRes.status === 'fulfilled' ? volRes.value.level : cached.level;
  const muted = volRes.status === 'fulfilled' ? volRes.value.muted : cached.muted;
  const devices = devRes.status === 'fulfilled' ? devRes.value : cached.devices;
  const current = devices.find((d) => d.isDefault) ?? null;
  return {
    level,
    muted,
    devices,
    currentDeviceId: current?.id ?? null,
  };
}

/** Push asynchrone d'un AudioState au renderer (canal `audio:change`). */
function broadcast(state: AudioState): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.AudioChange, state);
}

/**
 * Empreinte de la liste des sorties. Comparer les longueurs ne suffit plus
 * depuis que la chip rétractée affiche le **type** : brancher un casque qui
 * remplace une sortie (même compte, autre nature) doit repeindre l'UI.
 */
function devicesSignature(devices: AudioDevice[]): string {
  return devices
    .map((d) => `${d.id}:${d.type}:${d.bluetooth ? 'bt' : '-'}:${d.isDefault ? 'D' : '-'}`)
    .join('|');
}

/**
 * Lit le nouvel état, met à jour le cache, et émet `audio:change` si quelque
 * chose a changé.
 */
async function refresh(
  opts: { withDevices?: boolean; withVolume?: boolean } = {},
): Promise<AudioState> {
  const next = await readState(opts.withDevices ?? false, opts.withVolume ?? true);
  const changed =
    next.level !== cached.level ||
    next.muted !== cached.muted ||
    next.currentDeviceId !== cached.currentDeviceId ||
    devicesSignature(next.devices) !== devicesSignature(cached.devices);
  cached = next;
  if (changed) broadcast(next);
  return next;
}

/** Annule la relance devices en cours, s'il y en a une. */
function cancelDeviceWarmup(): void {
  if (warmupTimer) {
    clearTimeout(warmupTimer);
    warmupTimer = null;
  }
}

/**
 * Planifie la n-ième relance de la liste des sorties. S'arrête au premier
 * succès (liste non vide) ou une fois tous les délais épuisés. Pendant la
 * veille, l'essai est reporté sans consommer d'étape.
 */
function scheduleDeviceWarmup(attempt: number): void {
  if (attempt >= DEVICE_WARMUP_DELAYS_MS.length) {
    warmupTimer = null;
    return;
  }
  warmupTimer = setTimeout(() => {
    warmupTimer = null;
    if (suspended) {
      scheduleDeviceWarmup(attempt); // reporte le même essai
      return;
    }
    void refresh({ withDevices: true }).then((state) => {
      if (state.devices.length === 0) scheduleDeviceWarmup(attempt + 1);
    });
  }, DEVICE_WARMUP_DELAYS_MS[attempt]);
}

/** (Re)démarre une chaîne de relance devices depuis le premier délai. */
function startDeviceWarmup(): void {
  cancelDeviceWarmup();
  scheduleDeviceWarmup(0);
}

/**
 * Un tick de surveillance en rétracté.
 *
 * Relit les endpoints dans le registre (gratuit) et ne dépense un spawn SVV
 * que dans deux cas :
 *  - la liste des sorties actives a changé → il y a un nouveau périphérique
 *    par défaut à découvrir (Windows bascule tout seul sur un casque qu'on
 *    branche) ;
 *  - le cache des sorties a dépassé `fullCheckMs` → filet de sécurité pour
 *    le changement de sortie fait depuis le panneau Windows, que le registre
 *    ne reflète pas.
 *
 * Volume non relu (`withVolume: false`) : la chip ne l'affiche pas, donc le
 * binaire `loudness` n'a aucune raison de tourner notch fermé.
 */
async function watchTick(): Promise<void> {
  // Garde de réentrance (même pattern que privacyService / systemService) :
  // un tick lent — PowerShell résident occupé, SVV qui traîne — ne doit pas
  // se cumuler avec le suivant. Les gardes in-flight en aval empêchent déjà
  // la multiplication des process, celui-ci évite en plus d'écraser
  // `lastEndpointsSig` depuis deux ticks concurrents.
  if (watchInFlight) return;
  if (suspended) return;
  // Filet : si le notch s'est ouvert entre-temps, le polling normal a la
  // main et relit déjà tout — inutile de doubler.
  if (getNotchMode() !== 'collapsed') return;
  if (!collapsedChipEnabled()) return;

  watchInFlight = true;
  try {
    const endpoints = await readEndpoints(true);
    // Liste vide = rien de fiable à comparer : grâce de démarrage, lecture
    // trop lente (course souple) ou registre indisponible. On ne touche PAS
    // à `lastEndpointsSig` — l'écraser avec une signature vide provoquerait
    // un faux « le matériel a changé » (donc un spawn SVV pour rien) au
    // premier tick qui rendrait enfin des données.
    let hardwareChanged = false;
    if (endpoints.length > 0) {
      const signature = endpointsSignature(endpoints);
      hardwareChanged =
        lastEndpointsSig !== null && signature !== lastEndpointsSig;
      lastEndpointsSig = signature;
    }

    const cfg = audioConfig();
    const stale = Date.now() - devicesFetchedAt > Math.max(60_000, cfg.fullCheckMs);
    if (!hardwareChanged && !stale) return;
    await refresh({ withDevices: true, withVolume: false });
  } finally {
    watchInFlight = false;
  }
}

/** Arrête la surveillance en rétracté. Idempotent. */
function stopCollapsedWatch(): void {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
}

/**
 * (Re)démarre la surveillance en rétracté si la chip est demandée. Appelée
 * au boot, à chaque passage en rétracté et à chaque changement de réglage
 * (cadence, toggle de la chip, activation du module).
 */
function startCollapsedWatch(): void {
  stopCollapsedWatch();
  if (!collapsedChipEnabled()) return;
  const ms = Math.max(MIN_WATCH_MS, audioConfig().watchMs || 5_000);
  watchTimer = setInterval(() => {
    void watchTick();
  }, ms);
}

/**
 * Réagit aux changements de réglages sans redémarrage de l'app : cadence de
 * surveillance, toggle de la chip rétractée, activation du module.
 */
function subscribeConfigChanges(): void {
  store.onDidChange('moduleConfig', (newVal, oldVal) => {
    const n = newVal?.audio;
    const o = oldVal?.audio;
    if (!n || !o) return;
    if (n.watchMs !== o.watchMs || n.collapsed !== o.collapsed) {
      if (getNotchMode() === 'collapsed') startCollapsedWatch();
    }
  });
  store.onDidChange('modules', (newVal, oldVal) => {
    if (newVal?.audio === oldVal?.audio) return;
    if (newVal?.audio === false) {
      stopCollapsedWatch();
      cancelDeviceWarmup();
      return;
    }
    // Réactivation : on resynchronise tout de suite (l'état a pu dériver
    // pendant que le module était éteint) puis on relance la surveillance.
    void refresh({ withDevices: true });
    if (getNotchMode() === 'collapsed') startCollapsedWatch();
  });
}

/**
 * Enregistre les 4 handlers `invoke` du module Audio.
 *
 * Chaque setter retourne le nouvel état après application : le renderer
 * peut donc faire une mise à jour optimiste puis réconcilier avec la
 * réponse, sans attendre le prochain polling.
 */
export function registerAudioIpc(): void {
  // Appelé à l'ouverture du panneau audio : seul endroit (avec SetDevice)
  // où la liste des devices est rafraîchie, sous réserve du TTL. Module
  // désactivé → on resserre au cache : rien ne l'affiche, inutile de payer
  // un spawn parce que le renderer s'abonne au montage.
  ipcMain.handle(IpcChannel.AudioGetState, async () => {
    if (!audioEnabled()) return cached;
    return refresh({ withDevices: devicesCacheStale() });
  });

  ipcMain.handle(IpcChannel.AudioSetVolume, async (_e, level: number) => {
    await setVolumeCoalesced(level);
    // Pas de relecture : le setter vient d'appliquer la valeur (clamp
    // identique à celui de setVolume), rien d'autre n'a changé. Le polling
    // 2 s réconciliera si Windows a ajusté différemment.
    cached = {
      ...cached,
      level: Math.max(0, Math.min(100, Math.round(level))),
    };
    return cached;
  });

  ipcMain.handle(IpcChannel.AudioSetMuted, async (_e, muted: boolean) => {
    await setMuted(muted);
    return refresh();
  });

  ipcMain.handle(IpcChannel.AudioSetDevice, async (_e, id: string) => {
    await setDefaultOutput(id);
    // Refresh forcé (bypass TTL) : c'est précisément `isDefault` qui vient
    // de changer dans la liste.
    return refresh({ withDevices: true });
  });
}

/** Démarre le polling volume/muted. Idempotent. */
export function startAudioPolling(): void {
  if (pollTimer) return;
  subscribeConfigChanges();
  // Premier cycle avec devices : le panneau doit avoir une liste prête
  // dès la première ouverture. Au démarrage à froid, cette 1re lecture
  // revient souvent vide (service audio / SVV pas encore prêts) → on
  // enchaîne des relances à délais croissants jusqu'à obtenir la liste.
  if (audioEnabled()) {
    void refresh({ withDevices: true }).then((state) => {
      if (state.devices.length === 0) startDeviceWarmup();
    });
  }
  // Le notch démarre rétracté : si la chip est demandée, la surveillance
  // légère prend le relais dès maintenant.
  startCollapsedWatch();
  pollTimer = setInterval(() => {
    if (suspended) return;
    // Module éteint : ni footer ni chip, personne ne lit cet état.
    if (!audioEnabled()) return;
    // Notch replié = personne ne lit le **volume** : `AudioFooter` n'existe
    // que dans `ExpandedDashboard`, et la chip repliée n'affiche que le type
    // de sortie. Or chaque cycle spawne le binaire `loudness`, soit 43 200
    // créations de process par jour — dont l'écrasante majorité pour
    // alimenter une interface que personne ne regarde. On saute donc le
    // cycle ; `watchTick` couvre le périphérique de sortie sans spawn, et
    // `onNotchModeChange` resynchronise tout à l'ouverture.
    //
    // Le test porte sur le mode du notch, PAS sur `isFullscreenActive()` :
    // ce dernier repose sur `fullscreen-detector.ps1`, qui ne démarre pas
    // sur un poste en ConstrainedLanguage et y renvoie donc toujours `false`.
    if (getNotchMode() === 'collapsed') return;
    void refresh();
  }, POLL_INTERVAL_MS);

  // Ouverture du notch : l'état a pu dériver pendant la mise en veille du
  // poller (volume changé aux touches média, casque branché). On resynchronise
  // immédiatement, devices compris, pour que le panneau s'affiche à jour.
  // Fermeture : la surveillance légère reprend la main.
  unsubscribeMode = onNotchModeChange((mode) => {
    if (mode === 'collapsed') {
      startCollapsedWatch();
      return;
    }
    stopCollapsedWatch();
    if (suspended || !audioEnabled()) return;
    void refresh({ withDevices: true });
  });

  // Gèle le polling pendant la veille : au réveil, un refresh immédiat
  // (devices compris — un dock/casque a pu apparaître pendant la veille)
  // resynchronise l'état sans attendre le prochain tick.
  powerMonitor.on('suspend', () => {
    suspended = true;
  });
  powerMonitor.on('resume', () => {
    suspended = false;
    if (!audioEnabled()) return;
    // Au réveil, le stack audio peut lui aussi être lent à revenir : même
    // relance progressive si la liste ressort vide.
    void refresh({ withDevices: true }).then((state) => {
      if (state.devices.length === 0) startDeviceWarmup();
    });
  });
}

/** Arrête le polling. Appelé à la fermeture de l'app. */
export function stopAudioPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (unsubscribeMode) {
    unsubscribeMode();
    unsubscribeMode = null;
  }
  stopCollapsedWatch();
  cancelDeviceWarmup();
}
