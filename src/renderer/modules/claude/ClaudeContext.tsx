/**
 * Context partagé des sessions Claude Code.
 *
 * Un seul abonnement IPC pour tous les consommateurs (chip + card +
 * éventuels toasts de complétion). Le main process pousse la liste à
 * chaque changement détecté par chokidar (création/modification/
 * suppression d'un .jsonl) ou par le tick 15 s de recalcul des statuts.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { ClaudeSession } from '../../../shared/types';

interface ClaudeContextValue {
  sessions: ClaudeSession[];
  /** Sessions encore actives (working ou waiting). */
  active: ClaudeSession[];
}

const ClaudeContext = createContext<ClaudeContextValue | null>(null);

export function ClaudeProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);

  useEffect(() => {
    let alive = true;
    window.notch.claude.list().then((s) => {
      if (alive) setSessions(s);
    });
    const off = window.notch.claude.onChange((s) => {
      if (alive) setSessions(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Une session est "active" tant qu'elle n'est pas idle/done.
  // Sert au compteur de chip + comme critère d'affichage du module.
  const active = sessions.filter(
    (s) => s.status === 'working' || s.status === 'waiting',
  );

  return (
    <ClaudeContext.Provider value={{ sessions, active }}>
      {children}
    </ClaudeContext.Provider>
  );
}

export function useClaudeContext(): ClaudeContextValue {
  const ctx = useContext(ClaudeContext);
  if (!ctx) {
    throw new Error(
      "useClaudeContext doit être appelé à l'intérieur de <ClaudeProvider>",
    );
  }
  return ctx;
}
