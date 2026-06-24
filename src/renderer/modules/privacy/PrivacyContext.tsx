/**
 * Context partagé du module Confidentialité (témoin caméra / micro).
 *
 * Une seule subscription IPC (`privacy:change`) pour la chip. Le main pousse
 * un `PrivacyState` complet à chaque tick.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { PrivacyState } from '../../../shared/types';

interface PrivacyContextValue {
  state: PrivacyState;
}

const EMPTY_STATE: PrivacyState = {
  camActive: false,
  micActive: false,
  camApps: [],
  micApps: [],
  lastCheckAt: 0,
  lastError: null,
};

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PrivacyState>(EMPTY_STATE);

  useEffect(() => {
    let alive = true;
    void window.notch.privacy.getState().then((s) => {
      if (alive) setState(s);
    });
    const off = window.notch.privacy.onChange((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  return (
    <PrivacyContext.Provider value={{ state }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacyContext(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  if (!ctx) {
    throw new Error(
      "usePrivacyContext doit être appelé à l'intérieur de <PrivacyProvider>",
    );
  }
  return ctx;
}
