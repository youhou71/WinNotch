/**
 * Hook React qui expose l'état audio système et ses mutations.
 *
 * Flux :
 *  - Au mount : `getState()` synchrone via IPC pour avoir une valeur dès
 *    le premier render.
 *  - Pendant la vie du composant : abonnement `onChange` qui reçoit le
 *    push toutes les 2 s (polling main) et sur action explicite.
 *  - Au démontage : désabonnement pour éviter une fuite sur le main.
 *
 * Les mutations (`setVolume`, `toggleMute`, `selectDevice`) mettent à jour
 * l'état localement de manière **optimiste** pour que l'UI réagisse
 * instantanément, puis remplacent par la réponse du main process qui fait
 * autorité.
 */
import { useCallback, useEffect, useState } from 'react';
import type { AudioState } from './types';

/** Valeur initiale neutre avant le premier `getState` IPC. */
const EMPTY: AudioState = {
  level: 0,
  muted: false,
  devices: [],
  currentDeviceId: null,
};

export function useAudio() {
  const [state, setState] = useState<AudioState>(EMPTY);

  useEffect(() => {
    // `alive` protège contre les setState après démontage (cas rare où
    // une promesse IPC arrive après que le composant a été retiré).
    let alive = true;
    window.notch.audio.getState().then((s) => {
      if (alive) setState(s);
    });
    const off = window.notch.audio.onChange((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const setVolume = useCallback(async (level: number) => {
    // Update optimiste : on règle l'UI tout de suite, puis on réconcilie
    // avec la réponse réelle du main.
    setState((s) => ({ ...s, level: Math.max(0, Math.min(100, Math.round(level))) }));
    const next = await window.notch.audio.setVolume(level);
    setState(next);
  }, []);

  const toggleMute = useCallback(async () => {
    const target = !state.muted;
    setState((s) => ({ ...s, muted: target }));
    const next = await window.notch.audio.setMuted(target);
    setState(next);
  }, [state.muted]);

  const selectDevice = useCallback(async (id: string) => {
    setState((s) => ({ ...s, currentDeviceId: id }));
    const next = await window.notch.audio.setDevice(id);
    setState(next);
  }, []);

  return { state, setVolume, toggleMute, selectDevice };
}
