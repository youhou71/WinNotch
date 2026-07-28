/**
 * Détecteur d'application en plein écran sur l'écran principal + touche Alt
 * (mode Peek).
 *
 * Stratégie : UN process PowerShell long-running (mutualisé pour les deux
 * usages, cf. `resources/ps/fullscreen-detector.ps1`) :
 *  - poll `GetForegroundWindow` + `GetWindowRect` toutes les ~750 ms et
 *    écrit les bounds sur stdout. Node lit chaque ligne, compare aux bounds
 *    du primary display (via `screen.getPrimaryDisplay().bounds`) et émet
 *    `shell:fullscreenChange` au renderer si l'état bascule.
 *  - poll `GetAsyncKeyState(VK_MENU)` toutes les ~75 ms et émet `ALT,1` /
 *    `ALT,0` UNIQUEMENT sur transition — routé vers le handler enregistré
 *    par `altPeek.ts` via `setAltKeyHandler` (remplace l'ancien hook
 *    clavier global `node-global-key-listener`, qui couplait la latence
 *    clavier de tout Windows à la charge de l'event loop du main).
 *
 * Pourquoi un PS long-running plutôt que `execFile` à chaque tick :
 *  - Spawn PowerShell coûte 150-300 ms et ~5% CPU
 *  - Un seul spawn au boot + read de lignes via pipe = ~0% CPU au repos
 *
 * Pourquoi 750 ms : compromis entre réactivité (l'utilisateur passe en
 * fullscreen → le notch disparaît rapidement) et coût (peu de wake-ups).
 *
 * Détection fullscreen :
 *  - "fullscreen" = la fenêtre foreground couvre **exactement** les
 *    bounds (pas workArea) du primary display
 *  - Tolérance ±2 px sur chaque bord pour gérer les arrondis DPI
 *  - On exclut notre propre fenêtre (sinon expanded déclencherait)
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { screen } from 'electron';
import { IpcChannel } from '../../../shared/types';
import { powershellExe } from './powershellPath';
import { psScriptPath } from './psScriptPath';
import { getNotchWindow } from '../../window/notchWindow';
import { isFullscreenWindow, parseDetectorLine } from './fullscreenLogic';
import {
  isNativeDetectorRunning,
  startNativeDetector,
  stopNativeDetector,
  type NativeDetectorCallbacks,
} from './fullscreenDetectorNative';
import { getNativeWin32Error } from '../../native/win32';

const POLL_INTERVAL_MS = 750;
/**
 * Intervalle du polling Alt (mode Peek). 75 ms = latence de détection
 * imperceptible pour un effet d'opacité, coût d'un GetAsyncKeyState
 * négligeable.
 */
const ALT_POLL_INTERVAL_MS = 75;
// La tolérance de bord vit désormais dans `fullscreenLogic.ts`, partagée par
// les deux implémentations. Ces deux constantes ne servent plus qu'à
// paramétrer le script PowerShell de repli.

let psProcess: ChildProcessWithoutNullStreams | null = null;
let lastEmitted: boolean | null = null;
let altKeyHandler: ((down: boolean) => void) | null = null;

/**
 * Enregistre le handler des transitions Alt (down/up) émises par le script
 * PS. Appelé par `altPeek.ts` AVANT `startFullscreenDetector()` (ordre
 * garanti dans `index.ts`) : la présence d'un handler au moment du spawn
 * décide si le script active son polling Alt. `null` désenregistre.
 */
export function setAltKeyHandler(handler: ((down: boolean) => void) | null): void {
  altKeyHandler = handler;
}

// Le script de détection (Add-Type P/Invoke GetForegroundWindow/GetWindowRect +
// boucle émettant "left,top,right,bottom,pid") vit dans
// `resources/ps/fullscreen-detector.ps1`, lancé via `-File` avec l'intervalle de
// poll passé en argument. On évite ainsi le bloc `Add-Type` inline dans la ligne
// de commande, que les antivirus heuristiques signalent. Faute de lib native
// fournissant les bounds de la fenêtre active avec des prebuilds compatibles
// Electron, ce module reste en PowerShell (le `Add-Type` demeure dans le .ps1).

function emit(fullscreen: boolean): void {
  if (lastEmitted === fullscreen) return;
  lastEmitted = fullscreen;
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.ShellFullscreenChange, fullscreen);
}

/**
 * True si une app est actuellement en plein écran sur l'écran principal
 * (= le notch est masqué côté renderer via `.is-fullscreen-hidden`).
 * Permet aux pollers du main (ex. systemService) de suspendre le travail
 * qui ne sert qu'à alimenter une UI invisible.
 */
export function isFullscreenActive(): boolean {
  return lastEmitted === true;
}

/**
 * Évalue un échantillon de fenêtre et diffuse le verdict. Point de convergence
 * des deux implémentations : le chemin natif l'appelle avec ce que renvoie
 * `user32`, le chemin PowerShell avec ce qu'il a parsé de stdout. La décision
 * elle-même est déléguée à `fullscreenLogic`, donc identique dans les deux cas.
 */
function evaluateSample(
  sample: { rect: { left: number; top: number; right: number; bottom: number }; pid: number } | null,
): void {
  if (!sample) return;
  const display = screen.getPrimaryDisplay();
  emit(isFullscreenWindow(sample.rect, sample.pid, process.pid, display.bounds));
}

function handleLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  // Transitions Alt (mode Peek) — émises uniquement sur changement d'état.
  if (trimmed.startsWith('ALT,')) {
    altKeyHandler?.(trimmed === 'ALT,1');
    return;
  }
  evaluateSample(parseDetectorLine(trimmed));
}

/** Callbacks passés au détecteur natif — mêmes sorties que le parsing stdout. */
const nativeCallbacks: NativeDetectorCallbacks = {
  onAltChange: (down) => altKeyHandler?.(down),
  onWindowSample: (info) =>
    evaluateSample(info ? { rect: info, pid: info.pid } : null),
};

/**
 * Démarre le détecteur, en préférant l'implémentation native.
 *
 * Ordre de préférence :
 *  1. native (koffi → `user32`) : fonctionne quel que soit le mode de langage
 *     PowerShell imposé par la politique du poste, et ne crée aucun process ;
 *  2. PowerShell : repli conservé tant que le natif n'a pas fait ses preuves en
 *     production. Il reste la seule option si le binaire de koffi manque ou si
 *     son chargement est bloqué.
 *
 * Deux échappatoires par variable d'environnement, utiles au diagnostic :
 *  - `WINNOTCH_FORCE_PS_DETECTOR=1` → force le repli PowerShell ;
 *  - `WINNOTCH_FORCE_NATIVE_DETECTOR=1` → interdit le repli, pour vérifier le
 *    chemin natif depuis le dépôt (où PowerShell tourne en `FullLanguage` et
 *    masquerait donc une régression du natif).
 */
export function startFullscreenDetector(): void {
  if (psProcess || isNativeDetectorRunning()) return;

  const forcePs = process.env.WINNOTCH_FORCE_PS_DETECTOR === '1';
  const forceNative = process.env.WINNOTCH_FORCE_NATIVE_DETECTOR === '1';

  if (!forcePs) {
    if (startNativeDetector(nativeCallbacks, altKeyHandler !== null)) {
      console.log('[fullscreen] détecteur natif actif (aucun process PowerShell)');
      return;
    }
    const reason = getNativeWin32Error() ?? 'raison inconnue';
    if (forceNative) {
      console.warn(
        `[fullscreen] natif indisponible (${reason}) et repli interdit ` +
          '(WINNOTCH_FORCE_NATIVE_DETECTOR=1) — détection désactivée',
      );
      return;
    }
    console.warn(`[fullscreen] natif indisponible (${reason}) — repli sur PowerShell`);
  }

  startPowershellDetector();
}

/**
 * Repli historique : un `powershell.exe` résident qui poll `user32` par
 * P/Invoke et écrit ses échantillons sur stdout. Inopérant sur un poste où la
 * politique impose `ConstrainedLanguage` (le `Add-Type` du script y est
 * interdit) — c'est précisément ce que l'implémentation native corrige.
 */
function startPowershellDetector(): void {
  if (psProcess) return;
  try {
    psProcess = spawn(
      powershellExe(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'RemoteSigned',
        '-File',
        psScriptPath('fullscreen-detector.ps1'),
        String(POLL_INTERVAL_MS),
        // 0 = polling Alt désactivé côté script (aucun handler enregistré,
        // ex. WINNOTCH_DISABLE_ALT_PEEK=1 → altPeek jamais démarré).
        String(altKeyHandler ? ALT_POLL_INTERVAL_MS : 0),
      ],
      { windowsHide: true },
    );
  } catch (err) {
    console.warn('[fullscreen] spawn PowerShell échoué — détection désactivée:', err);
    return;
  }

  // `spawn` n'échoue PAS de façon synchrone sur un ENOENT (binaire
  // introuvable) : l'erreur arrive en asynchrone via l'événement 'error'.
  // Sans ce handler, l'ENOENT devient une exception non catchée qui crashe
  // tout le main process. On dégrade donc proprement (détection désactivée).
  psProcess.on('error', (err) => {
    console.warn('[fullscreen] PowerShell indisponible — détection désactivée:', err.message);
    psProcess = null;
    lastEmitted = null;
    // Ne jamais laisser le notch coincé en mode Peek si le poller meurt.
    altKeyHandler?.(false);
  });

  let buffer = '';
  psProcess.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    // Découpage par lignes ; on garde l'éventuel reliquat dans le buffer.
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  });
  psProcess.stderr.on('data', (chunk: Buffer) => {
    // Les warnings PowerShell sont émis ici ; on les ignore tant que
    // le process tourne et que stdout délivre.
    console.warn('[fullscreen] PS stderr:', chunk.toString('utf8').trim());
  });
  psProcess.on('exit', (code) => {
    console.warn(`[fullscreen] détecteur arrêté (code=${code})`);
    psProcess = null;
    lastEmitted = null;
    altKeyHandler?.(false);
  });
}

export function stopFullscreenDetector(): void {
  // Arrête l'implémentation active, quelle qu'elle soit. `stopNativeDetector`
  // notifie le relâchement d'Alt s'il était enfoncé — sans quoi le notch
  // resterait figé en mode Peek.
  stopNativeDetector(nativeCallbacks);
  if (psProcess) {
    try {
      psProcess.kill();
    } catch { /* ignore */ }
    psProcess = null;
  }
  lastEmitted = null;
}
