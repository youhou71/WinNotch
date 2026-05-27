/**
 * Context partagé pour le module VPN.
 *
 * Une seule subscription IPC (`vpn:change`) pour tous les consommateurs
 * (chip + card + hook toasts). Le main process pousse un `VpnState`
 * complet à chaque tick et à chaque changement (transition, résolution
 * de pays, etc.).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { VpnState } from '../../../shared/types';

interface VpnContextValue {
  state: VpnState;
  /** Force un check côté main. Le résultat arrive aussi via onChange. */
  refresh: () => Promise<void>;
}

const EMPTY_STATE: VpnState = {
  connected: false,
  connections: [],
  lastCheckAt: 0,
  lastError: null,
};

const VpnContext = createContext<VpnContextValue | null>(null);

export function VpnProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VpnState>(EMPTY_STATE);

  useEffect(() => {
    let alive = true;
    void window.notch.vpn.getState().then((s) => {
      if (alive) setState(s);
    });
    const off = window.notch.vpn.onChange((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const refresh = useCallback(async () => {
    const s = await window.notch.vpn.refresh();
    setState(s);
  }, []);

  return (
    <VpnContext.Provider value={{ state, refresh }}>
      {children}
    </VpnContext.Provider>
  );
}

export function useVpnContext(): VpnContextValue {
  const ctx = useContext(VpnContext);
  if (!ctx) {
    throw new Error(
      "useVpnContext doit être appelé à l'intérieur de <VpnProvider>",
    );
  }
  return ctx;
}
