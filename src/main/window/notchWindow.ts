/**
 * Gestion de la fenêtre Electron qui héberge le Notch.
 *
 * Stratégie : une fenêtre frameless et transparente de **largeur fixe**
 * (800 px) et de **hauteur égale à la `workArea` de l'écran principal**
 * (écran moins la barre des tâches Windows). Le notch lui-même est dessiné
 * en CSS à l'intérieur et s'anime via les transitions Chromium (width/
 * height/border-radius + courbe spring `linear()`).
 *
 * Pourquoi prendre toute la hauteur workArea ? Le notch étendu doit pouvoir
 * grossir jusqu'à `workArea.height - 100 px` selon son contenu (cf.
 * `Notch.tsx` qui mesure le contenu réel via ResizeObserver). Comme la
 * fenêtre est transparente et passe-plat (`setIgnoreMouseEvents`), le
 * surplus de surface invisible ne gêne ni l'utilisateur ni les clics.
 *
 * Politique multi-écrans : le notch reste **ancré à l'écran principal**.
 * Il ne suit pas le curseur. La fenêtre est repositionnée et redimensionnée
 * si l'utilisateur change le primary display, branche/débranche un écran,
 * modifie la DPI / résolution (déclenche `display-metrics-changed`).
 *
 * Pourquoi pas `setBounds({ animate: true })` ? L'option `animate` est
 * silencieusement ignorée sur Windows par Electron — seule macOS en
 * bénéficie. On laisse donc le rendu CSS faire l'animation à l'intérieur
 * d'une fenêtre suffisamment grande.
 *
 * Le click-through est géré dynamiquement : par défaut la fenêtre laisse
 * passer la souris (`setIgnoreMouseEvents(true, { forward: true })`) et le
 * renderer demande la capture via IPC quand le curseur survole le notch.
 */
import { BrowserWindow, screen } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { IpcChannel } from '../../shared/types';

/**
 * Chemin vers l'icône de fenêtre.
 *  - dev : on lit `build/icon.ico` directement depuis la racine du projet
 *    (résolu depuis `out/main/` produit par electron-vite).
 *  - prod : l'icône est copiée via `extraResources` à côté de l'exe
 *    (`resources/icon.ico`).
 *
 * Indispensable côté BrowserWindow pour que l'icône s'affiche dans
 * Alt+Tab, le gestionnaire des tâches et le menu Aero Peek — sans ça,
 * Electron retombe sur son icône par défaut même si l'exe lui-même a
 * été patché par rcedit au packaging.
 */
const WINDOW_ICON_PATH = is.dev
  ? join(__dirname, '../../build/icon.ico')
  : join(process.resourcesPath, 'icon.ico');

/**
 * Largeur fixe de la fenêtre. La hauteur est déterminée dynamiquement à
 * partir de `workArea.height` (cf. `computeBounds`).
 */
export const WINDOW_WIDTH = 800;

let notchWindow: BrowserWindow | null = null;

/**
 * Calcule la position top-center et la hauteur sur l'**écran principal**
 * Windows.
 *
 * `workArea` (et non `bounds`) respecte la position et la taille de la
 * barre des tâches Windows. La fenêtre prend toute la hauteur du
 * workArea : ainsi le notch étendu peut grossir jusqu'à
 * `window.innerHeight - 100` côté renderer sans dépasser la fenêtre.
 *
 * `screen.getPrimaryDisplay()` retourne toujours l'écran défini comme
 * "principal" dans les paramètres Windows — change si l'utilisateur le
 * modifie dans Paramètres → Système → Affichage.
 */
function computeBounds(): Electron.Rectangle {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  return {
    x: Math.round(x + (width - WINDOW_WIDTH) / 2),
    y,
    width: WINDOW_WIDTH,
    height,
  };
}

/** Accesseur lecture seule pour les modules qui ont besoin de la fenêtre. */
export function getNotchWindow(): BrowserWindow | null {
  return notchWindow;
}

/**
 * Crée la BrowserWindow unique du Notch.
 *
 * Choix de configuration importants :
 *  - `transparent: true` + `backgroundColor: '#00000000'` → fond strictement
 *    transparent, seul le `<div class="notch">` peint des pixels visibles
 *  - `hasShadow: false` → évite un halo DWM autour de la fenêtre
 *  - `skipTaskbar: true` → pas d'icône dans la barre des tâches Windows
 *  - `resizable/movable: false` → l'utilisateur ne doit jamais pouvoir
 *    déplacer la fenêtre (le Notch est fixe par essence)
 *  - `setAlwaysOnTop('pop-up-menu')` → niveau moins agressif que
 *    `'screen-saver'` ; ne bloque pas les prompts UAC ni les notifications
 *  - `setIgnoreMouseEvents(true, { forward: true })` → click-through par
 *    défaut, mais les `mousemove` sont quand même livrés au renderer pour
 *    permettre le hit-test (voir useHitTest)
 */
export function createNotchWindow(): BrowserWindow {
  const bounds = computeBounds();

  notchWindow = new BrowserWindow({
    ...bounds,
    icon: WINDOW_ICON_PATH,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false, // on attend ready-to-show pour éviter un flash de transparence
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      // Le preload est compilé en .mjs par electron-vite (ESM côté preload).
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  notchWindow.setAlwaysOnTop(true, 'pop-up-menu');
  notchWindow.setIgnoreMouseEvents(true, { forward: true });

  notchWindow.on('ready-to-show', () => {
    notchWindow?.show();
  });

  // Quand la fenêtre perd le focus (clic outside, alt-tab, etc.), on
  // demande au renderer de rétracter. Le renderer décide selon son
  // état actuel : si mode='collapsed', no-op ; si mode='expanded', il
  // bascule à 'collapsed'. Le main n'a pas accès à ce state.
  notchWindow.on('blur', () => {
    if (!notchWindow || notchWindow.isDestroyed()) return;
    notchWindow.webContents.send(IpcChannel.ShellRequestCollapse);
  });

  notchWindow.on('closed', () => {
    notchWindow = null;
  });

  // En dev, on charge l'URL Vite (HMR renderer). En prod, on lit le HTML
  // bundlé dans `out/renderer/`.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    notchWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    notchWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return notchWindow;
}

/**
 * Replace la fenêtre top-center de l'écran principal Windows.
 *
 * Appelée à chaque événement écran (changement de primary display,
 * branchement, débranchement, modif DPI/résolution).
 */
export function repositionToPrimaryScreen(): void {
  if (!notchWindow) return;
  const bounds = computeBounds();
  notchWindow.setBounds(bounds);
}

/**
 * Branche les écouteurs sur les événements `screen` d'Electron.
 *
 * Pas d'écoute du focus de fenêtre ou du curseur : le notch est ancré
 * à l'écran principal et n'a aucune raison de bouger tant que la
 * configuration matérielle/Windows ne change pas.
 *
 * `display-metrics-changed` couvre aussi les changements de DPI et la
 * désignation d'un nouvel écran principal dans Paramètres Windows.
 */
export function registerScreenListeners(): void {
  screen.on('display-metrics-changed', repositionToPrimaryScreen);
  screen.on('display-added', repositionToPrimaryScreen);
  screen.on('display-removed', repositionToPrimaryScreen);
}
