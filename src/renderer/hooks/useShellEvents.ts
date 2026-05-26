/**
 * S'abonne aux événements shell envoyés par le main process :
 *  - `shell:toggleNotch`     → bascule collapsed/expanded (raccourci global)
 *  - `shell:requestCollapse` → force collapsed (clic outside via blur)
 *
 * Ces deux events ne sont pas redondants :
 *  - toggle est un signal symétrique (l'utilisateur veut basculer)
 *  - requestCollapse est unidirectionnel et toujours sûr (no-op si déjà
 *    collapsed)
 */
import { useEffect } from 'react';
import type { NotchMode } from '../../shared/types';

interface Options {
  setMode: (updater: (m: NotchMode) => NotchMode) => void;
}

export function useShellEvents({ setMode }: Options): void {
  useEffect(() => {
    const offToggle = window.notch.shell.onToggle(() => {
      setMode((m) => (m === 'expanded' ? 'collapsed' : 'expanded'));
    });
    const offCollapse = window.notch.shell.onRequestCollapse(() => {
      setMode(() => 'collapsed');
    });
    return () => {
      offToggle();
      offCollapse();
    };
  }, [setMode]);
}
