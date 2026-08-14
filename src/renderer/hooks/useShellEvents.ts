/**
 * S'abonne aux événements shell envoyés par le main process :
 *  - `shell:toggleNotch`     → bascule collapsed/expanded (raccourci global)
 *  - `shell:requestCollapse` → force collapsed (clic outside via blur)
 *
 * Ces deux events ne sont pas redondants :
 *  - toggle est un signal symétrique (l'utilisateur veut basculer)
 *  - requestCollapse est unidirectionnel et toujours sûr (no-op si déjà
 *    collapsed)
 *
 * Notch épinglé : `requestCollapse` est ignoré — perdre le focus (clic dans
 * une autre fenêtre pour aller copier une valeur) ne doit plus refermer le
 * notch. `toggleNotch` reste actif : c'est une demande explicite de
 * l'utilisateur, et `App` dépingle au passage en collapsed.
 */
import { useEffect } from 'react';
import type { NotchMode } from '../../shared/types';

interface Options {
  setMode: (updater: (m: NotchMode) => NotchMode) => void;
  /** Notch épinglé → les fermetures implicites (blur) sont neutralisées. */
  pinned?: boolean;
}

export function useShellEvents({ setMode, pinned = false }: Options): void {
  useEffect(() => {
    const offToggle = window.notch.shell.onToggle(() => {
      setMode((m) => (m === 'expanded' ? 'collapsed' : 'expanded'));
    });
    const offCollapse = window.notch.shell.onRequestCollapse(() => {
      if (pinned) return;
      setMode(() => 'collapsed');
    });
    return () => {
      offToggle();
      offCollapse();
    };
    // `pinned` en dépendance : un simple re-abonnement IPC à chaque bascule
    // du pin (rare, piloté par un clic), bien plus lisible qu'une ref.
  }, [setMode, pinned]);
}
