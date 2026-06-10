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
 *  - le re-test périodique s'éteint après 1,5 s sans mouvement souris et
 *    redémarre au premier mousemove (audit perf P11 — avant, il forçait
 *    un `elementFromPoint` ~8,3×/s en permanence, souris immobile depuis
 *    des heures comprise)
 */
import { useEffect, useRef } from 'react';

const POLL_MS = 120;
/** Sans mousemove depuis ce délai, le re-test périodique s'arrête. */
const POLL_IDLE_STOP_MS = 1500;

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
      lastMoveAt = Date.now();
      startPoll();
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

    // Re-test périodique à la DERNIÈRE position connue du curseur.
    //
    // `mousemove` ne suffit pas : le contenu peut se décaler SOUS un curseur
    // immobile (formulaire qui grandit, champ/toast qui apparaît, changement
    // de page) → l'élément réellement sous le curseur change sans qu'aucun
    // `mousemove` ne soit émis, donc la capture reste périmée et le clic
    // « traverse » la fenêtre (cas aléatoire des formulaires de réglages).
    // Un re-test léger (elementFromPoint ~µs) referme cette fenêtre de course.
    //
    // Auto-extinction : ces décalages de contenu suivent une interaction
    // (clic, survol) — passé POLL_IDLE_STOP_MS sans mousemove, le poll
    // s'arrête et redémarre au prochain mouvement.
    let poll: number | null = null;
    let lastMoveAt = 0;

    const startPoll = () => {
      if (poll !== null) return;
      poll = window.setInterval(() => {
        if (lastX >= 0) test();
        if (Date.now() - lastMoveAt > POLL_IDLE_STOP_MS && poll !== null) {
          window.clearInterval(poll);
          poll = null;
        }
      }, POLL_MS);
    };

    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);

    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      if (poll !== null) window.clearInterval(poll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}
