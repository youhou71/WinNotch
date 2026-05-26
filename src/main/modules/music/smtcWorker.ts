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

function bufferToDataUrl(buf: Buffer | undefined | null): string | null {
  if (!buf || buf.length === 0) return null;
  const mime = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
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
    thumbnail: bufferToDataUrl(session.media?.thumbnail),
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

  let debounceTimer: NodeJS.Timeout | null = null;
  const emit = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      send({ type: 'state', state: safeReadCurrent() });
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

  // Tick 1 s pour faire avancer la timeline même quand SMTC n'émet pas
  // de timeline event (cas Spotify).
  setInterval(() => {
    send({ type: 'state', state: safeReadCurrent() });
  }, 1000);

  // Émission initiale.
  emit();

  send({ type: 'ready' });

  parentPort?.on('message', (event: Electron.MessageEvent) => {
    const msg = event.data as { type?: string } | undefined;
    if (msg?.type === 'getState') {
      send({ type: 'state', state: safeReadCurrent() });
    } else if (msg?.type === 'shutdown') {
      try { monitor?.destroy?.(); } catch { /* ignore */ }
      process.exit(0);
    }
  });
}

main();
