/**
 * Hit-test global pour piloter la capture souris de la fenêtre Electron.
 *
 * Contexte : la fenêtre du Notch est en `setIgnoreMouseEvents(true, {forward:true})`
 * par défaut → tous les events souris sont *forwardés* au renderer **et**
 * passent à travers vers le bureau Windows. On veut que :
 *  - hors du notch (zone transparente) → on continue à passer à travers
 *  - sur le notch → on capture, sinon impossible de cliquer dessus
 *
 * À chaque `mousemove`, on fait un `document.elementFromPoint` et on
 * remonte la chaîne d'ancêtres à la recherche d'un `data-notch-hit="true"`.
 * Si oui → on demande la capture au main. Si non → on relâche.
 *
 * Optimisations :
 *  - rAF coalesce les mousemove successifs en un seul test par frame
 *  - `isCapturedRef` évite d'envoyer l'IPC en boucle quand l'état ne
 *    change pas (l'utilisateur bouge la souris sur le notch sans sortir)
 */
import { useEffect, useRef } from 'react';

export function useHitTest(): void {
  const isCapturedRef = useRef(false);

  useEffect(() => {
    let raf = 0;
    let lastX = -1;
    let lastY = -1;

    const test = () => {
      raf = 0;
      const el = document.elementFromPoint(lastX, lastY);
      const inside = !!el?.closest('[data-notch-hit="true"]');
      if (inside !== isCapturedRef.current) {
        isCapturedRef.current = inside;
        window.notch.shell.setMouseCapture(inside);
      }
    };

    const onMove = (e: MouseEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      // Coalesce : si une frame est déjà programmée, on garde juste
      // les coordonnées les plus récentes.
      if (raf) return;
      raf = requestAnimationFrame(test);
    };

    const onLeave = () => {
      // Quand la souris quitte complètement la fenêtre Electron, on
      // s'assure de relâcher la capture pour ne pas bloquer le bureau.
      if (isCapturedRef.current) {
        isCapturedRef.current = false;
        window.notch.shell.setMouseCapture(false);
      }
    };

    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);

    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}
