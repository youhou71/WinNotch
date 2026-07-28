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
 */
import { ipcMain, powerMonitor } from 'electron';
import { IpcChannel, type AudioState, type AudioDevice } from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import { getNotchMode, onNotchModeChange } from '../../shortcuts/altPeek';
import { getVolumeInfo, setVolume, setMuted, type VolumeInfo } from './volume';
import { listOutputDevices, setDefaultOutput } from './devices';

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
    devicesInFlight = listOutputDevices()
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

function devicesCacheStale(): boolean {
  return Date.now() - devicesFetchedAt > DEVICES_TTL_MS;
}

/**
 * Lit l'état audio. `Promise.allSettled` garantit qu'une erreur sur une
 * source n'écrase pas les valeurs de l'autre (ex. SVV peut être en
 * circuit-breaker pendant que loudness fonctionne très bien).
 *
 * @param withDevices relit la liste des devices via SoundVolumeView
 *                    (coûteux : spawn + fichier temp). Sinon, le cache
 *                    devices est resservi tel quel.
 */
async function readState(withDevices: boolean): Promise<AudioState> {
  const [volRes, devRes] = await Promise.allSettled([
    readVolumeInfo(),
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
 * Lit le nouvel état, met à jour le cache, et émet `audio:change` si quelque
 * chose a changé. Comparaison "shallow" suffisante pour notre cas (devices
 * comparés par longueur ; un swap simultané de deux devices serait raté
 * mais reste improbable).
 */
async function refresh(opts: { withDevices?: boolean } = {}): Promise<AudioState> {
  const next = await readState(opts.withDevices ?? false);
  const changed =
    next.level !== cached.level ||
    next.muted !== cached.muted ||
    next.currentDeviceId !== cached.currentDeviceId ||
    next.devices.length !== cached.devices.length;
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
 * Enregistre les 4 handlers `invoke` du module Audio.
 *
 * Chaque setter retourne le nouvel état après application : le renderer
 * peut donc faire une mise à jour optimiste puis réconcilier avec la
 * réponse, sans attendre le prochain polling.
 */
export function registerAudioIpc(): void {
  // Appelé à l'ouverture du panneau audio : seul endroit (avec SetDevice)
  // où la liste des devices est rafraîchie, sous réserve du TTL.
  ipcMain.handle(IpcChannel.AudioGetState, async () => {
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
  // Premier cycle avec devices : le panneau doit avoir une liste prête
  // dès la première ouverture. Au démarrage à froid, cette 1re lecture
  // revient souvent vide (service audio / SVV pas encore prêts) → on
  // enchaîne des relances à délais croissants jusqu'à obtenir la liste.
  void refresh({ withDevices: true }).then((state) => {
    if (state.devices.length === 0) startDeviceWarmup();
  });
  pollTimer = setInterval(() => {
    if (suspended) return;
    // Notch replié = personne ne lit cet état : `AudioFooter` n'existe que
    // dans `ExpandedDashboard`, et la rangée repliée n'affiche aucune chip
    // audio. Or chaque cycle spawne le binaire `loudness`, soit 43 200
    // créations de process par jour — dont l'écrasante majorité pour
    // alimenter une interface que personne ne regarde. On saute donc le
    // cycle, et `onNotchModeChange` resynchronise à l'ouverture.
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
  unsubscribeMode = onNotchModeChange((mode) => {
    if (mode === 'collapsed' || suspended) return;
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
  cancelDeviceWarmup();
}
