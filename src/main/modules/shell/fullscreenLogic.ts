/**
 * Décision « la fenêtre au premier plan est-elle en plein écran ? ».
 *
 * Module **pur** : aucune I/O, aucune dépendance à Electron ni à la source des
 * données. Extrait de `fullscreenDetector.ts` pour être partagé à l'identique
 * par les deux implémentations du détecteur — native (koffi) et PowerShell.
 * C'est ce partage qui garantit qu'elles décident pareil : si la logique était
 * dupliquée, les deux chemins divergeraient au premier ajustement.
 */

/** Rectangle de fenêtre, en coordonnées écran (comme `user32`). */
export interface WindowRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Bounds d'un écran, au format `Display.bounds` d'Electron. */
export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Marge tolérée sur chaque bord : les arrondis DPI et les ombres portées font
 * qu'une fenêtre « plein écran » ne coïncide pas au pixel près avec l'écran.
 */
export const EDGE_TOLERANCE_PX = 2;

/**
 * Compare un rectangle aux bounds d'un écran, à `EDGE_TOLERANCE_PX` près sur
 * les 4 bords.
 */
export function rectsMatch(rect: WindowRect, display: DisplayBounds): boolean {
  const x = rect.left;
  const y = rect.top;
  const w = rect.right - rect.left;
  const h = rect.bottom - rect.top;
  return (
    Math.abs(x - display.x) <= EDGE_TOLERANCE_PX &&
    Math.abs(y - display.y) <= EDGE_TOLERANCE_PX &&
    Math.abs(x + w - (display.x + display.width)) <= EDGE_TOLERANCE_PX &&
    Math.abs(y + h - (display.y + display.height)) <= EDGE_TOLERANCE_PX
  );
}

/**
 * Verdict final pour un échantillon de fenêtre au premier plan.
 *
 * `selfPid` est exclu : sans cela, ouvrir le notch en `expanded` par-dessus
 * l'écran principal le ferait se masquer lui-même.
 *
 * Note : la version précédente conditionnait cette exclusion à l'existence de
 * la fenêtre notch (`if (win && pid === process.pid)`). Ce garde n'exprimait
 * rien d'intentionnel — le commentaire d'origine visait bien « on ignore notre
 * propre process » — et rendait la décision dépendante d'un état sans rapport.
 * Il est retiré ici : l'exclusion est inconditionnelle.
 */
export function isFullscreenWindow(
  rect: WindowRect,
  pid: number,
  selfPid: number,
  display: DisplayBounds,
): boolean {
  if (pid === selfPid) return false;
  return rectsMatch(rect, display);
}

/**
 * Parse une ligne du protocole de `fullscreen-detector.ps1`
 * (`"left,top,right,bottom,pid"`). Renvoie `null` si la ligne est inexploitable.
 *
 * Conservé ici pour que le chemin PowerShell — maintenu en repli — partage la
 * même définition du protocole que sa logique de décision.
 */
export function parseDetectorLine(
  line: string,
): { rect: WindowRect; pid: number } | null {
  const parts = line.split(',');
  if (parts.length < 5) return null;
  const [left, top, right, bottom, pid] = parts.map((s) => Number(s));
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  return { rect: { left, top, right, bottom }, pid };
}
