/**
 * Pont IPC souris : pilote `setIgnoreMouseEvents` selon le hit-test renderer.
 *
 * Principe :
 *  - Au repos, la fenêtre laisse passer la souris vers le bureau (forward:true).
 *  - Quand le renderer détecte que le curseur survole le notch (via
 *    `elementFromPoint` sur un `data-notch-hit="true"`), il envoie `true`
 *    sur le canal `mouse:capture` → on capture les events.
 *  - Quand le curseur sort, il envoie `false` → on relâche la capture.
 *
 * Le mode Peek (Alt maintenu) force la capture désactivée **et** désactive
 * le forward des events souris : la fenêtre devient totalement passe-plats.
 * Ce mode prend le pas sur les requêtes du renderer (`setPeekState` est la
 * source de vérité tant qu'on est en peeking).
 */
import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/types';
import { getNotchWindow } from '../window/notchWindow';

let peeking = false;

/**
 * Dernier état de survol du notch rapporté par le hit-test du renderer.
 * Utilisé par le handler `blur` de la fenêtre (cf. notchWindow.ts) pour ne
 * PAS rétracter quand l'utilisateur interagit avec le notch (un clic sur un
 * bouton/champ peut provoquer un blur transitoire) — on ne rétracte que sur
 * un vrai clic en dehors (curseur hors du notch au moment du blur).
 */
let mouseOverNotch = false;

export function isMouseOverNotch(): boolean {
  return mouseOverNotch;
}

/**
 * Bascule l'état Peek. Quand `on=true`, la fenêtre devient totalement
 * passe-plats jusqu'au prochain `setPeekState(false)`.
 */
export function setPeekState(on: boolean): void {
  peeking = on;
  const win = getNotchWindow();
  if (!win) return;
  if (on) {
    // Pas de forward : on ne veut plus recevoir aucun event.
    win.setIgnoreMouseEvents(true, { forward: false });
  } else {
    // Retour à l'état "par défaut" du Notch : on laisse passer mais on
    // reçoit les mousemove pour le hit-test.
    win.setIgnoreMouseEvents(true, { forward: true });
  }
}

/**
 * Enregistre le handler IPC pour `mouse:capture`.
 *
 * Lecture/écriture rapide : utilisé sur chaque entrée/sortie du curseur
 * sur le notch (et donc potentiellement à chaque mousemove qui change de
 * zone). Volontairement basé sur `ipcMain.on` (one-way) plutôt que `handle`
 * (request/response) pour ne pas attendre de retour côté renderer.
 */
export function registerMouseIpc(): void {
  ipcMain.on(IpcChannel.MouseCapture, (_event, capture: boolean) => {
    // Toujours mémoriser le survol (même en Peek) pour le handler `blur`.
    mouseOverNotch = capture;
    const win = getNotchWindow();
    // En mode Peek, on ignore toutes les demandes du renderer pour ne pas
    // ré-activer la capture par mégarde.
    if (!win || peeking) return;
    if (capture) {
      win.setIgnoreMouseEvents(false);
    } else {
      win.setIgnoreMouseEvents(true, { forward: true });
    }
  });
}
