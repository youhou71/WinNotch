/**
 * Utility process Electron qui isole le module natif SMTC.
 *
 * Le constructeur de `new SMTCMonitor()` du package
 * `@coooookies/windows-smtc-monitor` peut crasher nativement (access
 * violation C++) sur certaines configurations Windows. Pour éviter de
 * tuer le main process, on exécute SMTC ici, dans un sous-process Node
 * forké via `utilityProcess.fork()`.
 *
 * Communication avec le main process :
 *  - `process.parentPort.postMessage({ type: 'ready' })` au démarrage OK
 *  - `process.parentPort.postMessage({ type: 'state', state })` à chaque
 *    changement détecté par SMTC (et tick 1 s pour faire avancer le
 *    scrubber côté UI)
 *  - le main peut envoyer `{ type: 'getState' }` pour forcer une lecture
 *
 * Si **ce process crashe**, seul lui meurt — le main process le voit
 * via l'event `exit` et marque SMTC comme désactivé, mais l'app reste
 * fonctionnelle (audio + shell intacts).
 *
 * Important : ce fichier est compilé en tant qu'entrée séparée par
 * electron-vite (cf. electron.vite.config.ts).
 */

interface MediaSession {
  sourceAppId?: string;
  media?: {
    title?: string;
    artist?: string;
    albumTitle?: string;
    thumbnail?: Buffer;
  };
  playback?: { playbackStatus?: number };
  timeline?: { position?: number; duration?: number };
}

interface WorkerMusicState {
  playing: boolean;
  title: string;
  artist: string;
  album: string;
  source: string;
  thumbnail: string | null;
  position: number;
  duration: number;
  updatedAt: number;
}

const EMPTY: WorkerMusicState = {
  playing: false,
  title: '',
  artist: '',
  album: '',
  source: '',
  thumbnail: null,
  position: 0,
  duration: 0,
  updatedAt: 0,
};

const SMTC_PLAYING = 4;

/**
 * Seuil (s) au-delà duquel un écart entre la position lue et la position
 * extrapolée depuis le dernier état envoyé est considéré comme un seek —
 * et justifie un envoi. Aligné sur SEEK_THRESHOLD_SEC du main.
 */
const SEEK_THRESHOLD_SEC = 2;

/**
 * Cache du data URL de la pochette (audit perf P10) : l'encodage base64
 * d'un buffer de plusieurs centaines de Ko tournait à CHAQUE lecture
 * d'état (1 Hz), pour une image qui ne change qu'au changement de piste.
 * Clé = titre|album|taille du buffer.
 */
let thumbCache: { key: string; dataUrl: string | null } | null = null;

function thumbnailDataUrl(session: MediaSession): string | null {
  const buf = session.media?.thumbnail;
  if (!buf || buf.length === 0) return null;
  const key = `${session.media?.title ?? ''}|${session.media?.albumTitle ?? ''}|${buf.length}`;
  if (thumbCache?.key === key) return thumbCache.dataUrl;
  const mime = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : 'image/png';
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
  thumbCache = { key, dataUrl };
  return dataUrl;
}

/**
 * Coerce une valeur potentiellement non-numérique en number finite.
 * Certaines sources SMTC (notamment les titres sans timeline configurée
 * comme livestreams ou previews très courts) peuvent renvoyer `NaN` pour
 * `timeline.position`/`duration`. Sans cette protection, le NaN se
 * propage côté renderer et produit `NaN:NaN` dans elapsed + une largeur
 * `NaN%` ignorée par CSS (= barre vide).
 */
function finiteOrZero(v: number | undefined | null): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function buildState(session: MediaSession | null | undefined): WorkerMusicState {
  if (!session) return EMPTY;
  const title = session.media?.title || '';
  if (!title) return EMPTY;
  return {
    playing: session.playback?.playbackStatus === SMTC_PLAYING,
    title,
    artist: session.media?.artist || '',
    album: session.media?.albumTitle || '',
    source: session.sourceAppId || '',
    thumbnail: thumbnailDataUrl(session),
    position: finiteOrZero(session.timeline?.position),
    duration: finiteOrZero(session.timeline?.duration),
    updatedAt: Date.now(),
  };
}

// `process.parentPort` est ajouté par Electron quand on fork via
// utilityProcess.fork(). Sur un Node "nu", il est undefined.
const parentPort = (process as NodeJS.Process & { parentPort?: Electron.ParentPort }).parentPort;

function send(message: unknown): void {
  parentPort?.postMessage(message);
}

function safeReadCurrent(): WorkerMusicState {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SMTCMonitor } = require('@coooookies/windows-smtc-monitor');
    return buildState(SMTCMonitor.getCurrentMediaSession());
  } catch (err) {
    send({ type: 'error', stage: 'readCurrent', message: String(err) });
    return EMPTY;
  }
}

function main(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let monitor: any = null;

  try {
    send({ type: 'log', message: 'smtcWorker: require module' });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@coooookies/windows-smtc-monitor');
    send({ type: 'log', message: 'smtcWorker: require OK, instantiation' });
    monitor = new mod.SMTCMonitor();
    send({ type: 'log', message: 'smtcWorker: instantiation OK' });
  } catch (err) {
    send({ type: 'fatal', message: String(err) });
    return;
  }

  /** Dernier état envoyé au main — sert d'anchor pour le diff du tick. */
  let lastSent: WorkerMusicState = EMPTY;

  const sendState = (state: WorkerMusicState) => {
    lastSent = state;
    send({ type: 'state', state });
  };

  let debounceTimer: NodeJS.Timeout | null = null;
  const emit = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      sendState(safeReadCurrent());
    }, 100);
  };

  try {
    monitor.on('session-media-changed', emit);
    monitor.on('session-playback-changed', emit);
    monitor.on('session-timeline-changed', emit);
    monitor.on('session-added', emit);
    monitor.on('session-removed', emit);
    monitor.on('current-session-changed', emit);
  } catch (err) {
    send({ type: 'error', stage: 'subscribe', message: String(err) });
  }

  /** True si un champ visuel (hors position) diffère entre deux états. */
  const differs = (a: WorkerMusicState, b: WorkerMusicState): boolean =>
    a.title !== b.title ||
    a.playing !== b.playing ||
    a.source !== b.source ||
    a.album !== b.album ||
    a.duration !== b.duration ||
    a.thumbnail !== b.thumbnail;

  // Tick 1 s : détecte les seeks / dérives que SMTC ne notifie pas via
  // timeline event (cas Spotify). Audit perf P10 — avant, ce tick poussait
  // l'état COMPLET (pochette base64 incluse) au main chaque seconde, même
  // en pause. Désormais :
  //  - en pause, on ne lit SMTC qu'1 tick sur 5 (filet si un event de
  //    reprise s'est perdu) ;
  //  - on n'envoie que si un champ visuel a changé OU si la position
  //    s'écarte de l'extrapolation (seek) — le renderer anime la
  //    progression localement depuis l'anchor, il n'a pas besoin d'un
  //    refresh de position par seconde.
  let tickCount = 0;
  setInterval(() => {
    tickCount++;
    if (!lastSent.playing && tickCount % 5 !== 0) return;
    const state = safeReadCurrent();
    const expected = lastSent.playing
      ? lastSent.position + (Date.now() - lastSent.updatedAt) / 1000
      : lastSent.position;
    const seeked = Math.abs(state.position - expected) > SEEK_THRESHOLD_SEC;
    if (!differs(state, lastSent) && !seeked) return;
    sendState(state);
  }, 1000);

  // Émission initiale.
  emit();

  send({ type: 'ready' });

  parentPort?.on('message', (event: Electron.MessageEvent) => {
    const msg = event.data as { type?: string } | undefined;
    if (msg?.type === 'getState') {
      // Demande explicite du main : envoi inconditionnel.
      sendState(safeReadCurrent());
    } else if (msg?.type === 'shutdown') {
      try { monitor?.destroy?.(); } catch { /* ignore */ }
      process.exit(0);
    }
  });
}

main();
