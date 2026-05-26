/**
 * Context React pour partager les Settings (DND + Tasks + futures préfs).
 *
 * Comme MusicContext, ce provider évite que chaque composant ne crée son
 * propre abonnement IPC. Le state est rafraîchi automatiquement quand le
 * main process émet `settings:change` (ex. toggle DND via raccourci global).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_SETTINGS,
  type DashTile,
  type Density,
  type ModuleConfig,
  type ModuleId,
  type Settings,
} from '../../../shared/types';

interface SettingsContextValue {
  settings: Settings;
  toggleDnd: () => Promise<Settings>;
  addTask: (text: string) => Promise<Settings>;
  toggleTask: (id: string) => Promise<Settings>;
  removeTask: (id: string) => Promise<Settings>;
  clearDoneTasks: () => Promise<Settings>;
  setModule: (id: ModuleId, enabled: boolean) => Promise<Settings>;
  setDensity: (density: Density) => Promise<Settings>;
  patchModuleConfig: <K extends ModuleId>(
    id: K,
    patch: Partial<ModuleConfig[K]>,
  ) => Promise<Settings>;
  setAutoStart: (enabled: boolean) => Promise<Settings>;
  setDashboardLayout: (layout: DashTile[]) => Promise<Settings>;
  /** ID de la tâche la plus récemment ajoutée (pour animation flash). */
  lastAddedId: string | null;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  // Mémorise l'ID de la dernière tâche ajoutée pour permettre à TaskRow
  // de jouer une animation flash verte. Comparaison "premier élément" car
  // settingsService unshift la nouvelle tâche en tête de liste.
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    window.notch.settings.getAll().then((s) => {
      if (alive) setSettings(s);
    });
    const off = window.notch.settings.onChange((s) => {
      if (alive) setSettings(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Update optimiste : pour DND on bascule le booléen tout de suite ; pour
  // les tâches on attend la réponse (l'id généré par le main n'est pas
  // connu côté renderer, donc pas de bascule optimiste possible).
  const toggleDnd = useCallback(async () => {
    setSettings((s) => ({ ...s, dnd: !s.dnd }));
    const next = await window.notch.settings.toggleDnd();
    setSettings(next);
    return next;
  }, []);

  const addTask = useCallback(async (text: string) => {
    const next = await window.notch.settings.addTask(text);
    setSettings(next);
    // La tâche fraîchement ajoutée est toujours en tête (settingsService
    // fait un unshift). On capture son ID pour le flash visuel.
    const added = next.tasks[0];
    if (added) setLastAddedId(added.id);
    return next;
  }, []);

  const toggleTask = useCallback(async (id: string) => {
    setSettings((s) => ({
      ...s,
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    }));
    const next = await window.notch.settings.toggleTask(id);
    setSettings(next);
    return next;
  }, []);

  const removeTask = useCallback(async (id: string) => {
    setSettings((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
    const next = await window.notch.settings.removeTask(id);
    setSettings(next);
    return next;
  }, []);

  const clearDoneTasks = useCallback(async () => {
    setSettings((s) => ({ ...s, tasks: s.tasks.filter((t) => !t.done) }));
    const next = await window.notch.settings.clearDoneTasks();
    setSettings(next);
    return next;
  }, []);

  const setModule = useCallback(async (id: ModuleId, enabled: boolean) => {
    // Bascule optimiste pour réactivité immédiate du toggle dans l'UI.
    setSettings((s) => ({ ...s, modules: { ...s.modules, [id]: enabled } }));
    const next = await window.notch.settings.setModule(id, enabled);
    setSettings(next);
    return next;
  }, []);

  const setDensity = useCallback(async (density: Density) => {
    setSettings((s) => ({ ...s, density }));
    const next = await window.notch.settings.setDensity(density);
    setSettings(next);
    return next;
  }, []);

  const setAutoStart = useCallback(async (enabled: boolean) => {
    setSettings((s) => ({ ...s, autoStart: enabled }));
    const next = await window.notch.settings.setAutoStart(enabled);
    setSettings(next);
    return next;
  }, []);

  const setDashboardLayout = useCallback(async (layout: DashTile[]) => {
    // Update optimiste : la grille s'anime tout de suite vers le nouvel
    // ordre / largeur, le main process re-broadcast l'état normalisé
    // (validation runtime) qui écrase si nécessaire.
    setSettings((s) => ({ ...s, dashboardLayout: layout }));
    const next = await window.notch.settings.setDashboardLayout(layout);
    setSettings(next);
    return next;
  }, []);

  const patchModuleConfig = useCallback(
    async <K extends ModuleId>(id: K, patch: Partial<ModuleConfig[K]>) => {
      // Update optimiste : merge dans l'état local avant la réponse IPC.
      setSettings((s) => ({
        ...s,
        moduleConfig: {
          ...s.moduleConfig,
          [id]: { ...s.moduleConfig[id], ...patch },
        },
      }));
      const next = await window.notch.settings.patchModuleConfig(id, patch);
      setSettings(next);
      return next;
    },
    [],
  );

  return (
    <SettingsContext.Provider
      value={{
        settings,
        toggleDnd,
        addTask,
        toggleTask,
        removeTask,
        clearDoneTasks,
        setModule,
        setDensity,
        patchModuleConfig,
        setAutoStart,
        setDashboardLayout,
        lastAddedId,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettingsContext(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettingsContext doit être appelé à l\'intérieur de <SettingsProvider>');
  }
  return ctx;
}
