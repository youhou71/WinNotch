/**
 * Gestion de la fenêtre Electron qui héberge le Notch.
 *
 * Stratégie : une fenêtre frameless et transparente de **largeur fixe**
 * (800 px) dont la **hauteur épouse le notch réel** (collapsed ~40 px,
 * expanded = hauteur du contenu + marge d'ombre). Le notch lui-même est
 * dessiné en CSS à l'intérieur et s'anime via les transitions Chromium
 * (width/height/border-radius + courbe spring `linear()`).
 *
 * Pourquoi ne PAS prendre toute la hauteur workArea ? Une fenêtre
 * `transparent: true` always-on-top couvrant tout l'écran empêche Windows
 * d'activer le MPO (Multiplane Overlay) : DWM doit recomposer de larges
 * régions à chaque rafraîchissement, ce qui se traduit par des saccades
 * système (curseur, scroll, vidéo) ressenties partout, sans pic CPU/GPU.
 * On borne donc la fenêtre à la taille réelle du notch : le renderer
 * (`Notch.tsx`) mesure son contenu via ResizeObserver et pousse la hauteur
 * souhaitée par `shell:setHeight` ; `setNotchWindowHeight` l'applique.
 *
 * Timing : croissance appliquée immédiatement (le notch doit avoir la
 * place de s'étendre avant l'animation CSS), réduction différée jusqu'à la
 * fin de l'animation (`SHRINK_DELAY_MS`) pour ne pas clipper le notch qui
 * rétrécit.
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
import { BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { IpcChannel } from '../../shared/types';
import { isMouseOverNotch } from '../ipc/mouse';

/**
 * Chemin vers l'icône de fenêtre.
 *  - dev : on lit `build/icon.ico` directement depuis la racine du projet
 *    (résolu depuis `out/main/` produit par electron-vite).
 *  - prod : l'icône est copiée via `extraResources` à côté de l'exe
 *    (`resources/icon.ico`).
 *
 * Indispensable côté BrowserWindow pour que l'icône s'affiche partout où
 * Windows représente la fenêtre (gestionnaire des tâches, boîtes système) —
 * sans ça, Electron retombe sur son icône par défaut même si l'exe lui-même
 * a été patché par rcedit au packaging. Depuis le passage en tool window
 * (cf. `type: 'toolbar'` dans createNotchWindow), le notch n'apparaît en
 * revanche ni dans la barre des tâches ni dans Alt+Tab.
 */
const WINDOW_ICON_PATH = is.dev
  ? join(__dirname, '../../build/icon.ico')
  : join(process.resourcesPath, 'icon.ico');

/**
 * Largeur fixe de la fenêtre. La hauteur est déterminée dynamiquement par
 * le renderer via `shell:setHeight` (cf. `setNotchWindowHeight`).
 */
export const WINDOW_WIDTH = 800;

/**
 * Hauteur initiale au boot, avant que le renderer ne mesure le notch et
 * ne pousse sa hauteur réelle. Couvre le notch collapsed (~34 px) + marge.
 */
const INITIAL_HEIGHT = 80;

/**
 * Délai avant d'appliquer une **réduction** de hauteur. Doit couvrir la
 * durée de l'animation CSS du notch (`transition: height 700ms` dans
 * notch.css) pour ne pas couper le bas du notch pendant qu'il rétrécit.
 */
const SHRINK_DELAY_MS = 760;

/**
 * Seuil sous lequel un changement de hauteur est ignoré : évite un
 * `setBounds` pour des micro-variations (±1-2 px) du contenu mesuré.
 */
const HEIGHT_EPSILON = 2;

/**
 * Au-delà de ce delta, une montée est un « gros saut » (ouverture
 * collapsed→expanded) appliquée immédiatement pour ne jamais clipper le
 * contenu. En-deçà, c'est un raffinement de mesure → coalescé (cf. growTimer).
 */
const BIG_GROW_PX = 120;

/** Fenêtre de coalescence des raffinements de croissance (≈ 2 frames). */
const GROW_COALESCE_MS = 32;

let notchWindow: BrowserWindow | null = null;

/** Hauteur actuellement appliquée à la fenêtre (px). */
let currentHeight = INITIAL_HEIGHT;

/**
 * Dernier rectangle réellement passé à `setBounds`. Sert à sauter les
 * `setBounds` redondants (rectangle identique) : sur une fenêtre
 * `transparent: true` (layered), chaque resize/repositionnement force DWM à
 * réallouer la surface de composition — coûteux et source de saccades
 * système (curseur, scroll) sans pic CPU/GPU. Notamment,
 * `display-metrics-changed` se déclenche aussi sur des changements de
 * DPI/échelle/profil couleur qui ne modifient pas les bounds.
 */
let lastAppliedBounds: Electron.Rectangle | null = null;

/** Timer de réduction différée en attente (annulé si une croissance arrive). */
let shrinkTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Timer de coalescence des raffinements de croissance. Pendant un expand, le
 * renderer pousse d'abord une estimation puis 1-2 mesures affinées du
 * ResizeObserver : on applique la 1re grosse montée tout de suite (le contenu
 * doit avoir la place) mais on fusionne les petits raffinements qui suivent en
 * un seul setBounds → une seule réallocation de surface DWM au lieu de 2-4.
 */
let growTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Hauteurs demandées par **couche** ; la fenêtre prend le max.
 *  - `notch`   : hauteur visible du notch + marge d'ombre (toujours présente).
 *  - `tooltip` : bulle rich d'une chip qui déborde sous le notch en collapsed
 *    (rendue en portal hors du shell). Sans cette couche, une tooltip plus
 *    haute que le notch collapsed serait clippée par le bord de la fenêtre.
 * Les overlays transitoires retirent leur couche (hauteur 0) à la fermeture.
 */
const layerHeights = new Map<string, number>([['notch', INITIAL_HEIGHT]]);

/**
 * Calcule la position top-center sur l'**écran principal** Windows pour une
 * hauteur donnée.
 *
 * `workArea` (et non `bounds`) respecte la position et la taille de la
 * barre des tâches Windows. La fenêtre est ancrée en haut (`y = workArea.y`)
 * et la hauteur est clampée à `workArea.height` pour ne jamais déborder de
 * l'écran. Le notch grandit vers le bas, `y` reste donc constant.
 *
 * `screen.getPrimaryDisplay()` retourne toujours l'écran défini comme
 * "principal" dans les paramètres Windows — change si l'utilisateur le
 * modifie dans Paramètres → Système → Affichage.
 */
function computeBounds(height: number): Electron.Rectangle {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height: workH } = display.workArea;
  return {
    x: Math.round(x + (width - WINDOW_WIDTH) / 2),
    y,
    width: WINDOW_WIDTH,
    height: Math.max(1, Math.min(Math.round(height), workH)),
  };
}

/** Applique immédiatement une hauteur à la fenêtre et mémorise l'état. */
function applyHeight(height: number): void {
  if (!notchWindow || notchWindow.isDestroyed()) return;
  const bounds = computeBounds(height);
  currentHeight = bounds.height;
  // Rectangle inchangé : ne pas re-`setBounds` une fenêtre layered pour rien
  // (évite une réallocation de surface DWM et les saccades associées).
  if (
    lastAppliedBounds &&
    lastAppliedBounds.x === bounds.x &&
    lastAppliedBounds.y === bounds.y &&
    lastAppliedBounds.width === bounds.width &&
    lastAppliedBounds.height === bounds.height
  ) {
    return;
  }
  lastAppliedBounds = bounds;
  notchWindow.setBounds(bounds);
}

/** Hauteur cible = la couche la plus haute demandée. */
function targetHeight(): number {
  let max = 0;
  for (const h of layerHeights.values()) {
    if (h > max) max = h;
  }
  return max;
}

/**
 * (Ré)applique la hauteur cible (max des couches) à la fenêtre.
 *
 * - **Croissance** (cible > actuel) : appliquée tout de suite — le contenu
 *   (notch qui s'étend, tooltip qui apparaît) doit disposer de la place
 *   avant d'être peint, sinon son bas est clippé.
 * - **Réduction** (cible < actuel) : différée de `SHRINK_DELAY_MS` pour
 *   laisser l'animation CSS du notch se jouer dans une fenêtre encore assez
 *   grande. Toute nouvelle demande annule le timer en attente : une
 *   croissance pendant la temporisation reprend la main immédiatement.
 */
function reconcileHeight(): void {
  if (!notchWindow || notchWindow.isDestroyed()) return;
  if (shrinkTimer) {
    clearTimeout(shrinkTimer);
    shrinkTimer = null;
  }
  const target = computeBounds(targetHeight()).height;
  if (Math.abs(target - currentHeight) <= HEIGHT_EPSILON) return;
  if (target > currentHeight) {
    if (target - currentHeight > BIG_GROW_PX) {
      // Gros saut (ouverture) : appliqué tout de suite, sinon le bas du notch
      // serait clippé le temps de l'animation CSS.
      if (growTimer) {
        clearTimeout(growTimer);
        growTimer = null;
      }
      applyHeight(target);
    } else {
      // Raffinement de mesure : coalescé sur ~2 frames (dernière cible gagne).
      // La fenêtre est déjà quasi à la bonne taille → aucun clip visible.
      if (growTimer) clearTimeout(growTimer);
      growTimer = setTimeout(() => {
        growTimer = null;
        const t = computeBounds(targetHeight()).height;
        if (t > currentHeight + HEIGHT_EPSILON) applyHeight(t);
      }, GROW_COALESCE_MS);
    }
  } else {
    if (growTimer) {
      clearTimeout(growTimer);
      growTimer = null;
    }
    shrinkTimer = setTimeout(() => {
      shrinkTimer = null;
      applyHeight(target);
    }, SHRINK_DELAY_MS);
  }
}

/**
 * Enregistre (ou retire) la hauteur souhaitée pour une couche, puis
 * réconcilie. `height <= 0` retire la couche (overlay fermé). La couche
 * `notch` n'est jamais retirée — elle garde un plancher si on lui pousse 0.
 */
export function setNotchWindowHeight(height: number, layer = 'notch'): void {
  if (height > 0) {
    layerHeights.set(layer, height);
  } else {
    layerHeights.delete(layer);
  }
  if (!layerHeights.has('notch')) {
    layerHeights.set('notch', INITIAL_HEIGHT);
  }
  reconcileHeight();
}

/**
 * Enregistre le handler IPC `shell:setHeight`. À appeler avant
 * `createNotchWindow` (comme les autres `register*Ipc`).
 */
export function registerNotchWindowIpc(): void {
  ipcMain.on(
    IpcChannel.ShellSetHeight,
    (_event, height: number, layer?: string) => {
      if (typeof height === 'number' && Number.isFinite(height)) {
        setNotchWindowHeight(height, typeof layer === 'string' ? layer : 'notch');
      }
    },
  );
}

/** Accesseur lecture seule pour les modules qui ont besoin de la fenêtre. */
export function getNotchWindow(): BrowserWindow | null {
  return notchWindow;
}

/**
 * Ré-affirme l'exclusion de la barre des tâches.
 *
 * Pourquoi en plus de `type: 'toolbar'` ? Les deux mécanismes n'agissent pas
 * au même moment :
 *  - `type: 'toolbar'` pose le style natif `WS_EX_TOOLWINDOW` **à la création**
 *    de la fenêtre : le shell Windows ne lui crée jamais de bouton. C'est la
 *    garantie de fond, insensible au timing.
 *  - `skipTaskbar` passe lui par `ITaskbarList::DeleteTab`, c'est-à-dire un
 *    retrait **a posteriori** : Windows crée le bouton, Electron le supprime
 *    juste après. Si la taskbar n'est pas prête à ce moment-là — typiquement
 *    au démarrage de session, quand WinNotch est lancé par la tâche
 *    planifiée pendant qu'explorer.exe initialise encore sa barre — le retrait
 *    peut se perdre et le bouton subsister. C'est exactement le « parfois au
 *    lancement » observé.
 *
 * On garde donc les deux, et on redemande le retrait sur les transitions où
 * le shell est susceptible de (re)construire ses boutons : premier affichage,
 * prise de focus, restauration. L'appel est idempotent et gratuit quand il n'y
 * a rien à retirer. (Un redémarrage d'explorer.exe, lui, est couvert par le
 * seul style natif : Windows ne recrée aucun bouton pour une tool window.)
 */
function enforceSkipTaskbar(): void {
  if (!notchWindow || notchWindow.isDestroyed()) return;
  notchWindow.setSkipTaskbar(true);
}

/**
 * Crée la BrowserWindow unique du Notch.
 *
 * Choix de configuration importants :
 *  - `transparent: true` + `backgroundColor: '#00000000'` → fond strictement
 *    transparent, seul le `<div class="notch">` peint des pixels visibles
 *  - `hasShadow: false` → évite un halo DWM autour de la fenêtre
 *  - `type: 'toolbar'` + `skipTaskbar: true` → jamais d'icône dans la barre
 *    des tâches (cf. `enforceSkipTaskbar` pour le détail du pourquoi des deux)
 *  - `resizable/movable: false` → l'utilisateur ne doit jamais pouvoir
 *    déplacer la fenêtre (le Notch est fixe par essence)
 *  - `setAlwaysOnTop('pop-up-menu')` → niveau moins agressif que
 *    `'screen-saver'` ; ne bloque pas les prompts UAC ni les notifications
 *  - `setIgnoreMouseEvents(true, { forward: true })` → click-through par
 *    défaut, mais les `mousemove` sont quand même livrés au renderer pour
 *    permettre le hit-test (voir useHitTest)
 */
export function createNotchWindow(): BrowserWindow {
  currentHeight = INITIAL_HEIGHT;
  lastAppliedBounds = null;
  if (growTimer) {
    clearTimeout(growTimer);
    growTimer = null;
  }
  layerHeights.clear();
  layerHeights.set('notch', INITIAL_HEIGHT);
  const bounds = computeBounds(INITIAL_HEIGHT);

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
    // Tool window Windows (WS_EX_TOOLWINDOW) : le notch n'est structurellement
    // pas éligible à la barre des tâches ni à Alt+Tab. Cf. enforceSkipTaskbar.
    type: 'toolbar',
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

  // Filet anti-course avec le shell : cf. enforceSkipTaskbar.
  notchWindow.on('show', enforceSkipTaskbar);
  notchWindow.on('focus', enforceSkipTaskbar);
  notchWindow.on('restore', enforceSkipTaskbar);

  // Quand la fenêtre perd le focus (clic outside, alt-tab, etc.), on
  // demande au renderer de rétracter. Le renderer décide selon son
  // état actuel : si mode='collapsed', no-op ; si mode='expanded', il
  // bascule à 'collapsed'. Le main n'a pas accès à ce state.
  //
  // Exception : si le curseur survole le notch au moment du blur, c'est que
  // l'utilisateur interagit avec lui — un clic sur un bouton/champ (ex. les
  // formulaires de connexion multi-étapes) peut provoquer un blur transitoire
  // de la fenêtre. On ne rétracte alors PAS : seul un vrai clic en dehors
  // (curseur hors du notch) doit fermer.
  notchWindow.on('blur', () => {
    if (!notchWindow || notchWindow.isDestroyed()) return;
    if (isMouseOverNotch()) return;
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
 * branchement, débranchement, modif DPI/résolution). Préserve la hauteur
 * courante (pilotée par le contenu) en la re-clampant au nouveau workArea
 * — un écran plus petit peut imposer de réduire le notch étendu.
 */
export function repositionToPrimaryScreen(): void {
  if (!notchWindow) return;
  applyHeight(currentHeight);
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
