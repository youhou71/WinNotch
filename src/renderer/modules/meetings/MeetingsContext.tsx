/**
 * Context partagé pour les meetings : un seul abonnement IPC pour tous
 * les consommateurs (chip, card, page settings).
 *
 * Le main process push la liste agrégée à chaque polling (5 min) ou
 * action explicite (connect/disconnect/refresh).
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
  CalendarAccount,
  CalendarProviderId,
  Meeting,
} from '../../../shared/types';

interface MeetingsContextValue {
  meetings: Meeting[];
  /** Tient compte des `minutesUntil` recalculés côté client (cf. usage UI). */
  next: Meeting | null;
  connect: (
    provider: CalendarProviderId,
  ) => Promise<{ ok: boolean; account?: CalendarAccount; error?: string }>;
  disconnect: (accountId: string) => Promise<{ ok: boolean }>;
  refresh: () => Promise<Meeting[]>;
}

const MeetingsContext = createContext<MeetingsContextValue | null>(null);

/**
 * Recalcule `minutesUntil` et `ongoing` côté client. Le main push toutes
 * les 5 min — entre deux push, le compte à rebours dérive. Cette fonction
 * permet à l'UI d'afficher un temps frais à chaque render.
 */
function freshen(m: Meeting): Meeting {
  const now = Date.now();
  const start = new Date(m.start).getTime();
  const end = new Date(m.end).getTime();
  return {
    ...m,
    minutesUntil: Math.round((start - now) / 60_000),
    ongoing: now >= start && now < end,
  };
}

export function MeetingsProvider({ children }: { children: ReactNode }) {
  const [raw, setRaw] = useState<Meeting[]>([]);

  useEffect(() => {
    let alive = true;
    window.notch.meetings.list().then((m) => {
      if (alive) setRaw(m);
    });
    const off = window.notch.meetings.onChange((m) => {
      if (alive) setRaw(m);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Tick local toutes les 30 s pour rafraîchir les countdowns côté UI
  // sans attendre le polling 5 min. Force un re-render via un state
  // dédié (mtime).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const meetings = raw.map(freshen);
  // Le "next" est le premier meeting non terminé. On garde les ongoing
  // en tête car la card "next meeting" doit les mettre en avant.
  const next =
    meetings.find((m) => m.ongoing) ??
    meetings.find((m) => m.minutesUntil >= 0) ??
    null;

  const connect = useCallback(
    (provider: CalendarProviderId) => window.notch.meetings.connect(provider),
    [],
  );
  const disconnect = useCallback(
    (accountId: string) => window.notch.meetings.disconnect(accountId),
    [],
  );
  const refresh = useCallback(() => window.notch.meetings.refresh(), []);

  return (
    <MeetingsContext.Provider
      value={{ meetings, next, connect, disconnect, refresh }}
    >
      {children}
    </MeetingsContext.Provider>
  );
}

export function useMeetingsContext(): MeetingsContextValue {
  const ctx = useContext(MeetingsContext);
  if (!ctx) {
    throw new Error(
      "useMeetingsContext doit être appelé à l'intérieur de <MeetingsProvider>",
    );
  }
  return ctx;
}
