/**
 * Hook qui pousse un toast système à chaque changement d'état DND.
 *
 * Le toggle DND peut venir :
 *  - du raccourci global Ctrl+Shift+D (main process)
 *  - d'un clic sur le banner "Désactiver" (renderer)
 *  - de l'IPC `settings:toggleDnd` direct
 *
 * Dans tous les cas, on veut une confirmation visuelle immédiate.
 * Le toast est marqué `systemException: true` pour passer outre le
 * filtre DND (sinon "activation du DND" serait silencieuse, anti-pattern UX).
 */
import { useEffect, useRef } from 'react';
import { useSettingsContext } from '../modules/settings/SettingsContext';
import { useToast } from '../modules/toast/ToastContext';

export function useDndToastSync(): void {
  const { settings } = useSettingsContext();
  const { push } = useToast();
  // Stocke la valeur précédente pour ne pas émettre au premier render
  // (l'utilisateur n'a pas "toggle" en chargeant l'app).
  const prevRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (prevRef.current === null) {
      prevRef.current = settings.dnd;
      return;
    }
    if (prevRef.current === settings.dnd) return;
    prevRef.current = settings.dnd;

    push({
      icon: settings.dnd ? 'fa-solid fa-moon' : 'fa-solid fa-bell',
      iconColor: settings.dnd ? '#a78bfa' : '#fbbf24',
      name: 'Notch',
      message: settings.dnd ? 'Ne pas déranger activé' : 'Notifications réactivées',
      systemException: true,
    });
  }, [settings.dnd, push]);
}
