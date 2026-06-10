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
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AudioState } from './types';

/**
 * Throttle des commits IPC de volume (leading + trailing). Pendant un drag
 * du slider, les mousemove arrivent à 60-120 Hz : sans throttle, chaque
 * event déclenchait un invoke IPC → spawn d'un process côté main (rafales
 * de 240-480 process/s observées à l'audit perf P3). Avec 100 ms, un drag
 * coûte ~10 commits/s, et le trailing garantit que la valeur finale du
 * mouseup est toujours poussée.
 */
const COMMIT_THROTTLE_MS = 100;

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

  /**
   * Niveau optimiste de la rafale en cours (drag du slider), `null` hors
   * rafale. Tant qu'il est non-null, les réponses IPC et les broadcasts
   * `audio:change` ne doivent PAS écraser `level` : ils reflètent des
   * commits intermédiaires déjà dépassés par la position du curseur.
   */
  const burstLevelRef = useRef<number | null>(null);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommitAtRef = useRef(0);
  const lastCommittedRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    void window.notch.audio.getState().then((s) => {
      if (alive) setState(s);
    });
    const off = window.notch.audio.onChange((s) => {
      if (!alive) return;
      setState((prev) =>
        burstLevelRef.current !== null ? { ...s, level: prev.level } : s,
      );
    });
    return () => {
      alive = false;
      off();
      if (trailingTimerRef.current) clearTimeout(trailingTimerRef.current);
    };
  }, []);

  /** Pousse un niveau au main et réconcilie (sauf rafale en cours). */
  const commit = useCallback(async (level: number) => {
    const next = await window.notch.audio.setVolume(level);
    setState((s) =>
      burstLevelRef.current !== null ? { ...next, level: s.level } : next,
    );
  }, []);

  const setVolume = useCallback(
    async (level: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(level)));
      // Optimiste : le slider suit le curseur sans attendre aucun IPC.
      setState((s) => ({ ...s, level: clamped }));
      burstLevelRef.current = clamped;

      // Leading : premier event après une accalmie → commit immédiat
      // (réactivité perçue, le son change dès le mousedown).
      const now = Date.now();
      if (now - lastCommitAtRef.current >= COMMIT_THROTTLE_MS) {
        lastCommitAtRef.current = now;
        lastCommittedRef.current = clamped;
        void commit(clamped);
      }

      // Trailing : (ré)armé à chaque event. Quand la rafale s'arrête,
      // pousse la valeur finale si besoin et rouvre la réconciliation.
      if (trailingTimerRef.current) clearTimeout(trailingTimerRef.current);
      trailingTimerRef.current = setTimeout(() => {
        trailingTimerRef.current = null;
        const final = burstLevelRef.current;
        burstLevelRef.current = null;
        if (final !== null && final !== lastCommittedRef.current) {
          lastCommitAtRef.current = Date.now();
          lastCommittedRef.current = final;
          void commit(final);
        }
      }, COMMIT_THROTTLE_MS);
    },
    [commit],
  );

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
