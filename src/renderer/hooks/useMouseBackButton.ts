/**
 * Intercepte le bouton "Précédent" des souris à 5 boutons (XButton1 sous
 * Windows) et appelle un callback à la place du comportement par défaut.
 *
 * Mapping `MouseEvent.button` :
 *  - 0 : gauche
 *  - 1 : milieu
 *  - 2 : droit
 *  - **3 : XButton1 / "Précédent"**  ← ce qu'on intercepte
 *  - 4 : XButton2 / "Suivant"
 *
 * On écoute en phase **capture** sur le document et on `preventDefault`
 * pour empêcher Chromium de déclencher une éventuelle navigation
 * history.back() implicite (sans effet utile dans une SPA, mais
 * potentiellement source d'effets de bord).
 *
 * Usage : passer `null` pour désactiver — utile quand le composant est
 * monté mais que le back ne doit rien faire dans certains états.
 */
import { useEffect } from 'react';

export function useMouseBackButton(callback: (() => void) | null): void {
  useEffect(() => {
    if (!callback) return;
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 3) return;
      e.preventDefault();
      e.stopPropagation();
      callback();
    };
    // `auxclick` couvre les boutons non-primaires si jamais `mousedown`
    // est bloqué quelque part — ceinture + bretelles pour le XButton1.
    const onAuxClick = (e: MouseEvent) => {
      if (e.button !== 3) return;
      e.preventDefault();
    };
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('auxclick', onAuxClick, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('auxclick', onAuxClick, true);
    };
  }, [callback]);
}
