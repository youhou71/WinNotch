/**
 * Context partagé pour le module GitLab.
 *
 * Une seule subscription IPC pour tous les consommateurs (chip + card +
 * hook de toasts). Le main process pousse un `GitLabState` complet à
 * chaque tick de polling, ou immédiatement après save/clear credentials.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { GitLabState } from '../../../shared/types';

interface GitLabContextValue {
  state: GitLabState;
  /** Force un refresh côté main. Le résultat arrive aussi via onChange. */
  refresh: () => Promise<void>;
}

const EMPTY_STATE: GitLabState = {
  configured: false,
  user: null,
  toReview: [],
  mine: [],
  watchedIssues: [],
  myWorkItems: [],
  lastFetchAt: null,
  lastError: null,
};

const GitLabContext = createContext<GitLabContextValue | null>(null);

export function GitLabProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GitLabState>(EMPTY_STATE);

  useEffect(() => {
    let alive = true;
    void window.notch.gitlab.getState().then((s) => {
      if (alive) setState(s);
    });
    const off = window.notch.gitlab.onChange((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const refresh = useCallback(async () => {
    const s = await window.notch.gitlab.refresh();
    setState(s);
  }, []);

  return (
    <GitLabContext.Provider value={{ state, refresh }}>
      {children}
    </GitLabContext.Provider>
  );
}

export function useGitLabContext(): GitLabContextValue {
  const ctx = useContext(GitLabContext);
  if (!ctx) {
    throw new Error(
      "useGitLabContext doit être appelé à l'intérieur de <GitLabProvider>",
    );
  }
  return ctx;
}
