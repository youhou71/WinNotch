/**
 * Hook React qui expose l'état musical système (SMTC) et ses contrôles.
 *
 * Flux identique au pattern useAudio :
 *  - mount → getState() pour avoir un état dès le premier render
 *  - abonnement onChange pour recevoir les push (events SMTC + tick 1 s)
 *  - mutations optimistes pour réactivité immédiate (le toggle play/pause
 *    bascule l'icône sans attendre l'event SMTC qui arrive ~200 ms plus tard)
 */
import { useCallback, useEffect, useState } from 'react';
import type { MusicState } from './types';

/** État initial neutre — surchargé dès que `getState` répond. */
const EMPTY: MusicState = {
  playing: false,
  title: '',
  artist: '',
  album: '',
  source: '',
  thumbnail: null,
  position: 0,
  duration: 0,
  updatedAt: 0,
};

export function useMusic() {
  const [state, setState] = useState<MusicState>(EMPTY);

  useEffect(() => {
    let alive = true;
    window.notch.music.getState().then((s) => {
      if (alive) setState(s);
    });
    const off = window.notch.music.onChange((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const playPause = useCallback(async () => {
    // Update optimiste : bascule de l'état playing avant que SMTC ne
    // propage le changement réel.
    setState((s) => ({ ...s, playing: !s.playing }));
    const next = await window.notch.music.playPause();
    setState(next);
  }, []);

  const next = useCallback(async () => {
    const r = await window.notch.music.next();
    setState(r);
  }, []);

  const previous = useCallback(async () => {
    const r = await window.notch.music.previous();
    setState(r);
  }, []);

  return { state, playPause, next, previous };
}
