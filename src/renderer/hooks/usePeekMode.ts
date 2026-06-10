/**
 * Hook qui reflète l'état du mode Peek (Alt maintenu).
 *
 * Le main process détecte Alt via le polling `GetAsyncKeyState` du poller
 * PowerShell résident (cf. altPeek.ts + fullscreenDetector.ts) et émet
 * l'événement `peek:change` sur IPC. Ce hook s'y abonne pour
 * fournir un booléen exploitable côté React (ex. appliquer la classe CSS
 * `.is-peeking` qui passe le notch à opacité 0.15 + pointer-events:none).
 */
import { useEffect, useState } from 'react';

export function usePeekMode(): boolean {
  const [peeking, setPeeking] = useState(false);

  useEffect(() => {
    // `onPeek` retourne directement la fonction de désabonnement, qu'on
    // peut donc passer telle quelle en cleanup d'useEffect.
    const off = window.notch.shell.onPeek((on) => setPeeking(on));
    return off;
  }, []);

  return peeking;
}
