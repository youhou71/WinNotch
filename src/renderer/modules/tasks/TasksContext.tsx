/**
 * Context partagé pour le module Tasks (liste de tâches locales).
 *
 * Avant le cleanup v1, la state des tâches vivait dans `SettingsContext`
 * et chaque mutation passait par un canal `settings:*Task`. La refonte
 * extrait la logique dans son propre service main + son Context renderer
 * pour aligner le module sur le pattern des autres (`vpn`, `teams`,
 * `system`, etc.).
 *
 * Une seule subscription IPC (`tasks:change`). Les mutations
 * (`add`/`toggle`/`remove`/`clearDone`) retournent la liste mise à jour
 * et déclenchent en plus un broadcast pour les autres consommateurs
 * éventuels.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Task } from '../../../shared/types';

interface TasksContextValue {
  tasks: Task[];
  /**
   * ID de la dernière tâche ajoutée via `add()` côté UI courante.
   * Utilisé par `<TasksList>` pour flasher la ligne fraîchement créée
   * (l'animation `task-row-flash` se déclenche via la classe
   * `is-highlight` qui ne reste qu'un instant). `null` au boot.
   */
  lastAddedId: string | null;
  add: (text: string) => Promise<void>;
  toggle: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearDone: () => Promise<void>;
}

const TasksContext = createContext<TasksContextValue | null>(null);

export function TasksProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void window.notch.tasks.getState().then((t) => {
      if (alive) setTasks(t);
    });
    const off = window.notch.tasks.onChange((t) => {
      if (alive) setTasks(t);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const add = useCallback(async (text: string) => {
    const next = await window.notch.tasks.add(text);
    setTasks(next);
    // La tâche fraîchement ajoutée est en tête (unshift côté main). On
    // capture son ID pour le flash visuel — `<TasksList>` re-render la
    // ligne avec `is-highlight` puis la classe s'évapore via l'animation.
    const added = next[0];
    if (added) setLastAddedId(added.id);
  }, []);

  const toggle = useCallback(async (id: string) => {
    const next = await window.notch.tasks.toggle(id);
    setTasks(next);
  }, []);

  const remove = useCallback(async (id: string) => {
    const next = await window.notch.tasks.remove(id);
    setTasks(next);
  }, []);

  const clearDone = useCallback(async () => {
    const next = await window.notch.tasks.clearDone();
    setTasks(next);
  }, []);

  return (
    <TasksContext.Provider
      value={{ tasks, lastAddedId, add, toggle, remove, clearDone }}
    >
      {children}
    </TasksContext.Provider>
  );
}

export function useTasksContext(): TasksContextValue {
  const ctx = useContext(TasksContext);
  if (!ctx) {
    throw new Error(
      "useTasksContext doit être appelé à l'intérieur de <TasksProvider>",
    );
  }
  return ctx;
}
