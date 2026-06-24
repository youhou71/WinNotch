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
  type Quicklink,
  type SetAutoStartResult,
  type Settings,
  type Snippet,
} from '../../../shared/types';

interface SettingsContextValue {
  settings: Settings;
  toggleDnd: () => Promise<Settings>;
  setModule: (id: ModuleId, enabled: boolean) => Promise<Settings>;
  setDensity: (density: Density) => Promise<Settings>;
  patchModuleConfig: <K extends ModuleId>(
    id: K,
    patch: Partial<ModuleConfig[K]>,
  ) => Promise<Settings>;
  setAutoStart: (enabled: boolean) => Promise<SetAutoStartResult>;
  setDashboardLayout: (layout: DashTile[]) => Promise<Settings>;
  setQuicklinks: (links: Quicklink[]) => Promise<Settings>;
  setSnippets: (snippets: Snippet[]) => Promise<Settings>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

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

  // Le module Tasks a son propre Context + canal IPC depuis v1, mais
  // `Settings.tasks` reste le champ persisté. On garde le champ
  // synchrone côté UI en abonnant un listener `tasks:change` qui patche
  // localement — ainsi un consommateur qui lit `settings.tasks` voit
  // toujours la version à jour sans devoir migrer vers `useTasksContext()`.
  useEffect(() => {
    const off = window.notch.tasks.onChange((tasks) => {
      setSettings((s) => ({ ...s, tasks }));
    });
    return off;
  }, []);

  const toggleDnd = useCallback(async () => {
    setSettings((s) => ({ ...s, dnd: !s.dnd }));
    const next = await window.notch.settings.toggleDnd();
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
    const res = await window.notch.settings.setAutoStart(enabled);
    // `res.settings` reflète l'état réel : si l'opération système a échoué,
    // `autoStart` n'a pas été persisté côté main → l'update optimiste est
    // annulé (le toggle revient à sa position précédente).
    setSettings(res.settings);
    return res;
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

  const setQuicklinks = useCallback(async (links: Quicklink[]) => {
    setSettings((s) => ({ ...s, quicklinks: links }));
    const next = await window.notch.settings.setQuicklinks(links);
    setSettings(next);
    return next;
  }, []);

  const setSnippets = useCallback(async (snippets: Snippet[]) => {
    setSettings((s) => ({ ...s, snippets }));
    const next = await window.notch.settings.setSnippets(snippets);
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
        setModule,
        setDensity,
        patchModuleConfig,
        setAutoStart,
        setDashboardLayout,
        setQuicklinks,
        setSnippets,
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
