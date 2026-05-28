/**
 * Context partagé pour le module Système live.
 *
 * Une seule subscription IPC (`system:change`) pour tous les consommateurs
 * (chip + card + settings). Le main process pousse un `SystemState`
 * complet à chaque tick de polling (1 Hz par défaut).
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { SystemState } from '../../../shared/types';

interface SystemContextValue {
  state: SystemState;
}

const HISTORY_LENGTH = 60;

function emptyState(): SystemState {
  const zeros = new Array(HISTORY_LENGTH).fill(0);
  return {
    cpu: { value: 0, history: [...zeros] },
    ram: { value: 0, history: [...zeros], usedBytes: 0, totalBytes: 0 },
    net: { value: 0, history: [...zeros] },
    uptimeSec: 0,
    lastTickAt: 0,
    lastError: null,
  };
}

const SystemContext = createContext<SystemContextValue | null>(null);

export function SystemProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SystemState>(emptyState);

  useEffect(() => {
    let alive = true;
    void window.notch.system.getState().then((s) => {
      if (alive) setState(s);
    });
    const off = window.notch.system.onChange((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  return (
    <SystemContext.Provider value={{ state }}>
      {children}
    </SystemContext.Provider>
  );
}

export function useSystemContext(): SystemContextValue {
  const ctx = useContext(SystemContext);
  if (!ctx) {
    throw new Error(
      "useSystemContext doit être appelé à l'intérieur de <SystemProvider>",
    );
  }
  return ctx;
}
