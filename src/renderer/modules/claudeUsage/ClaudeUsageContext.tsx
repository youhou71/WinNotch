/**
 * Context du module `claude.usage` (limites Claude Pro / Max).
 *
 * Subscription IPC unique partagée par la card, le hook de toasts, et la
 * page Settings. Le main process pousse un `ClaudeUsageState` complet à
 * chaque tick (défaut 30 s).
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { ClaudeUsageState } from '../../../shared/types';

interface ClaudeUsageContextValue {
  state: ClaudeUsageState;
  /** Force un refresh immédiat côté main. */
  refresh: () => Promise<void>;
  /** Installe (ou désinstalle) le wrapper statusline dans ~/.claude/settings.json. */
  installStatusline: (
    enable: boolean,
  ) => Promise<{ ok: boolean; installed: boolean; path?: string; error?: string }>;
}

const SPARKLINE_SIZE = 288;
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function emptyState(): ClaudeUsageState {
  const now = Date.now();
  return {
    fiveH: { percent: 0, resetsAt: now + FIVE_HOURS_MS, source: 'estimated' },
    weekly: { percent: 0, resetsAt: now + SEVEN_DAYS_MS, source: 'estimated' },
    sparkline: new Array(SPARKLINE_SIZE).fill(0),
    plan: 'unknown',
    statuslineInstalled: false,
    claudeInstalled: false,
    lastSyncAt: 0,
    lastError: null,
  };
}

const ClaudeUsageContext = createContext<ClaudeUsageContextValue | null>(null);

export function ClaudeUsageProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ClaudeUsageState>(emptyState);

  useEffect(() => {
    let alive = true;
    void window.notch.claudeUsage.getState().then((s) => {
      if (alive) setState(s);
    });
    const off = window.notch.claudeUsage.onChange((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const refresh = async () => {
    const next = await window.notch.claudeUsage.refresh();
    setState(next);
  };

  return (
    <ClaudeUsageContext.Provider
      value={{
        state,
        refresh,
        installStatusline: window.notch.claudeUsage.installStatusline,
      }}
    >
      {children}
    </ClaudeUsageContext.Provider>
  );
}

export function useClaudeUsageContext(): ClaudeUsageContextValue {
  const ctx = useContext(ClaudeUsageContext);
  if (!ctx) {
    throw new Error(
      "useClaudeUsageContext doit être appelé à l'intérieur de <ClaudeUsageProvider>",
    );
  }
  return ctx;
}
