/**
 * Context React pour le système de toasts éphémères.
 *
 * Un seul toast à la fois (slot unique). Si un nouveau push arrive avant
 * que l'ancien soit dismissé, il le remplace immédiatement (avec une
 * nouvelle clé pour rejouer l'animation).
 *
 * Le toast est filtré par le mode DND : si `settings.dnd === true`, les
 * toasts normaux sont rejetés. Seuls les toasts marqués
 * `systemException: true` (ex. confirmation du toggle DND lui-même)
 * passent. C'est l'exception explicite documentée dans le handoff.
 */
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import type { Toast } from '../../../shared/types';
import { useSettingsContext } from '../settings/SettingsContext';

interface ToastContextValue {
  /** Toast actuellement affiché ou null. */
  current: Toast | null;
  /**
   * Affiche un toast. Si DND est actif et `systemException` n'est pas mis,
   * l'appel est un no-op (retourne false).
   */
  push: (toast: Toast) => boolean;
  /** Force la disparition immédiate. */
  dismiss: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Toast | null>(null);
  const { settings } = useSettingsContext();

  const push = useCallback(
    (toast: Toast) => {
      if (settings.dnd && !toast.systemException) return false;
      // Nouvelle clé à chaque push pour rejouer l'animation, même quand
      // le toast précédent était identique.
      setCurrent({ ...toast, id: Date.now() });
      return true;
    },
    [settings.dnd],
  );

  const dismiss = useCallback(() => setCurrent(null), []);

  return (
    <ToastContext.Provider value={{ current, push, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast doit être appelé à l\'intérieur de <ToastProvider>');
  }
  return ctx;
}
