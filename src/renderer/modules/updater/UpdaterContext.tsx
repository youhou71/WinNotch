/**
 * Context partagé pour le module Updater (mises à jour automatiques).
 *
 * Une seule subscription IPC pour tous les consommateurs (hook toasts
 * + section Settings "À propos"). Le main push un nouveau UpdateState
 * à chaque event d'electron-updater (checking → available → downloading
 * → downloaded).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { UpdateState } from '../../../shared/types';

interface UpdaterContextValue {
  state: UpdateState;
  /** Force un check immédiat. La progression arrive via onChange. */
  checkNow: () => Promise<void>;
  /** Démarre le téléchargement d'une update détectée. */
  download: () => Promise<{ ok: boolean; error?: string }>;
  /** Quitte WinNotch et installe l'update téléchargée. */
  quitAndInstall: () => Promise<{ ok: boolean; error?: string }>;
}

const EMPTY_STATE: UpdateState = {
  status: 'idle',
  currentVersion: '',
  latestVersion: null,
  downloadPercent: null,
  error: null,
};

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

export function UpdaterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UpdateState>(EMPTY_STATE);

  useEffect(() => {
    let alive = true;
    void window.notch.updater.getState().then((s) => {
      if (alive) setState(s);
    });
    const off = window.notch.updater.onChange((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const checkNow = useCallback(async () => {
    const s = await window.notch.updater.checkNow();
    setState(s);
  }, []);

  const download = useCallback(() => window.notch.updater.download(), []);
  const quitAndInstall = useCallback(
    () => window.notch.updater.quitAndInstall(),
    [],
  );

  return (
    <UpdaterContext.Provider value={{ state, checkNow, download, quitAndInstall }}>
      {children}
    </UpdaterContext.Provider>
  );
}

export function useUpdaterContext(): UpdaterContextValue {
  const ctx = useContext(UpdaterContext);
  if (!ctx) {
    throw new Error(
      "useUpdaterContext doit être appelé à l'intérieur de <UpdaterProvider>",
    );
  }
  return ctx;
}
