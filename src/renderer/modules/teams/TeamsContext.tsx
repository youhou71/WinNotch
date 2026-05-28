/**
 * Context partagé pour le module Teams Presence.
 *
 * Une seule subscription IPC (`teams:change`) pour tous les consommateurs
 * (chip + card + futurs hooks). Le main process pousse un `TeamsState`
 * complet à chaque tick de polling et à chaque action (set/clear/reconnect).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type {
  TeamsActivity,
  TeamsAvailability,
  TeamsState,
} from '../../../shared/types';

interface TeamsContextValue {
  state: TeamsState;
  /** Set manuel du statut (PT8H). La promesse résout au nouveau state. */
  setPresence: (
    availability: TeamsAvailability,
    activity?: TeamsActivity,
  ) => Promise<TeamsState>;
  /** Retire le statut manuel → Teams revient en automatique. */
  clearPresence: () => Promise<TeamsState>;
  /** Re-consent OAuth pour ré-élever le scope Presence.ReadWrite. */
  reconnect: () => Promise<{ ok: boolean; error?: string }>;
}

const EMPTY_STATE: TeamsState = {
  availability: 'Unknown',
  activity: '',
  lastSyncAt: 0,
  loading: false,
  error: null,
  accountId: null,
  accountEmail: '',
};

const TeamsContext = createContext<TeamsContextValue | null>(null);

export function TeamsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TeamsState>(EMPTY_STATE);

  useEffect(() => {
    let alive = true;
    void window.notch.teams.getState().then((s) => {
      if (alive) setState(s);
    });
    const off = window.notch.teams.onChange((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const setPresence = useCallback(
    async (availability: TeamsAvailability, activity?: TeamsActivity) => {
      // Le main accepte une activity vide et la dérive lui-même via
      // `pairFor` ; on passe donc une chaîne vide par défaut pour
      // laisser le main faire le mapping.
      const s = await window.notch.teams.setPresence(
        availability,
        activity ?? '',
      );
      setState(s);
      return s;
    },
    [],
  );

  const clearPresence = useCallback(async () => {
    const s = await window.notch.teams.clearPresence();
    setState(s);
    return s;
  }, []);

  const reconnect = useCallback(() => window.notch.teams.reconnect(), []);

  return (
    <TeamsContext.Provider
      value={{ state, setPresence, clearPresence, reconnect }}
    >
      {children}
    </TeamsContext.Provider>
  );
}

export function useTeamsContext(): TeamsContextValue {
  const ctx = useContext(TeamsContext);
  if (!ctx) {
    throw new Error(
      "useTeamsContext doit être appelé à l'intérieur de <TeamsProvider>",
    );
  }
  return ctx;
}
