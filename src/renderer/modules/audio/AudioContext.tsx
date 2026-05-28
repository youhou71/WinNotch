/**
 * Context partagé pour le module Audio.
 *
 * Une seule subscription IPC (`audio:change`) pour tous les consommateurs
 * (footer audio principalement, mais pré-câblé pour d'éventuels indicateurs
 * de volume ailleurs dans l'UI). Évite que chaque sous-composant s'abonne
 * indépendamment et déclenche un round-trip IPC.
 *
 * Les mutations (`setVolume`, `toggleMute`, `selectDevice`) restent
 * optimistes côté local pour que l'UI réagisse instantanément, puis
 * réconcilient avec la réponse du main process qui fait autorité.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { AudioState } from './types';

interface AudioContextValue {
  state: AudioState;
  setVolume: (level: number) => Promise<void>;
  toggleMute: () => Promise<void>;
  selectDevice: (id: string) => Promise<void>;
}

const EMPTY: AudioState = {
  level: 0,
  muted: false,
  devices: [],
  currentDeviceId: null,
};

const AudioContext = createContext<AudioContextValue | null>(null);

export function AudioProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AudioState>(EMPTY);

  useEffect(() => {
    let alive = true;
    void window.notch.audio.getState().then((s) => {
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
    setState((s) => ({
      ...s,
      level: Math.max(0, Math.min(100, Math.round(level))),
    }));
    const next = await window.notch.audio.setVolume(level);
    setState(next);
  }, []);

  const toggleMute = useCallback(async () => {
    let target: boolean | null = null;
    setState((s) => {
      target = !s.muted;
      return { ...s, muted: target };
    });
    if (target === null) return;
    const next = await window.notch.audio.setMuted(target);
    setState(next);
  }, []);

  const selectDevice = useCallback(async (id: string) => {
    setState((s) => ({ ...s, currentDeviceId: id }));
    const next = await window.notch.audio.setDevice(id);
    setState(next);
  }, []);

  return (
    <AudioContext.Provider value={{ state, setVolume, toggleMute, selectDevice }}>
      {children}
    </AudioContext.Provider>
  );
}

export function useAudioContext(): AudioContextValue {
  const ctx = useContext(AudioContext);
  if (!ctx) {
    throw new Error(
      "useAudioContext doit être appelé à l'intérieur de <AudioProvider>",
    );
  }
  return ctx;
}
