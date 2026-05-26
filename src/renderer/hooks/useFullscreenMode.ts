/**
 * Reflète l'état "une app est en plein écran sur l'écran principal".
 *
 * Émis par le main process via `shell:fullscreenChange` (cf.
 * `fullscreenDetector.ts`). Quand `true`, le notch en mode collapsed
 * doit se masquer pour ne pas perturber le plein écran (vidéo, jeu,
 * présentation…). L'utilisateur garde toujours la possibilité d'ouvrir
 * le notch via `Ctrl+Shift+Space` — le passage en mode `expanded` réaffiche
 * le notch même en fullscreen.
 */
import { useEffect, useState } from 'react';

export function useFullscreenMode(): boolean {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const off = window.notch.shell.onFullscreenChange((on) => {
      setFullscreen(on);
    });
    return off;
  }, []);

  return fullscreen;
}
