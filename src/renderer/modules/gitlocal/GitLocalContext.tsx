/**
 * Context partagé pour le module Git local.
 *
 * Une seule subscription IPC pour tous les consommateurs (chip + card +
 * panel). Le main process pousse un `GitLocalState` complet à chaque
 * tick de polling, ou immédiatement après un refresh manuel / changement
 * de config.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { GitLocalState } from '../../../shared/types';

interface GitLocalContextValue {
  state: GitLocalState;
  /** Force un refresh côté main. Le résultat arrive aussi via onChange. */
  refresh: () => Promise<void>;
}

const EMPTY_STATE: GitLocalState = {
  configured: false,
  repos: [],
  lastScanAt: null,
  lastError: null,
};

const GitLocalContext = createContext<GitLocalContextValue | null>(null);

export function GitLocalProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GitLocalState>(EMPTY_STATE);

  useEffect(() => {
    let alive = true;
    void window.notch.gitlocal.getState().then((s) => {
      if (alive) setState(s);
    });
    const off = window.notch.gitlocal.onChange((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const refresh = useCallback(async () => {
    const s = await window.notch.gitlocal.refresh();
    setState(s);
  }, []);

  return (
    <GitLocalContext.Provider value={{ state, refresh }}>
      {children}
    </GitLocalContext.Provider>
  );
}

export function useGitLocalContext(): GitLocalContextValue {
  const ctx = useContext(GitLocalContext);
  if (!ctx) {
    throw new Error(
      "useGitLocalContext doit être appelé à l'intérieur de <GitLocalProvider>",
    );
  }
  return ctx;
}
