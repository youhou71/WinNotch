/**
 * Toasts pour les transitions notables du flux de mise à jour.
 *
 * Deux notifications utilisateur :
 *
 *  1. **Update disponible** (`available`) — toast bleu invitant à
 *     déclencher le téléchargement. L'action `download` n'est pas
 *     automatique : `autoDownload = false` côté main.
 *
 *  2. **Update téléchargée** (`downloaded`) — toast vert invitant à
 *     redémarrer pour installer. L'action `quitAndInstall` n'est pas
 *     automatique : `autoInstallOnAppQuit = false` côté main.
 *
 * L'erreur (`status === 'error'`) émet aussi un toast rouge — utile en
 * dev pour comprendre pourquoi le check échoue (provider mal configuré,
 * réseau, etc.).
 *
 * Note : ces toasts ne portent pas d'action cliquable interne, c'est
 * l'utilisateur qui doit ouvrir Settings → À propos pour piloter. Le
 * jour où on veut faire un toast "action" complet, on étendra `Toast`
 * avec un champ `onClick` côté shared/types.ts.
 */
import { useEffect, useRef } from 'react';
import type { UpdateStatus } from '../../../shared/types';
import { useUpdaterContext } from './UpdaterContext';
import { useToast } from '../toast/ToastContext';

export function useUpdateToasts(): void {
  const { state } = useUpdaterContext();
  const { push } = useToast();
  /** Statut précédent — sert à n'émettre qu'aux transitions. */
  const prev = useRef<UpdateStatus | null>(null);

  useEffect(() => {
    // Premier passage : baseline silencieuse pour ne pas spammer si
    // l'app rouvre alors qu'une update était déjà downloadée.
    if (prev.current === null) {
      prev.current = state.status;
      return;
    }

    const before = prev.current;
    const after = state.status;
    prev.current = after;
    if (before === after) return;

    if (after === 'available') {
      push({
        icon: 'fa-solid fa-arrow-up-from-bracket',
        iconColor: 'var(--accent)',
        name: 'WinNotch',
        message: `Mise à jour disponible · v${state.latestVersion ?? '?'}`,
      });
    } else if (after === 'downloaded') {
      push({
        icon: 'fa-solid fa-circle-check',
        iconColor: '#34d399',
        name: 'WinNotch',
        message: 'Mise à jour prête · redémarrer pour installer',
      });
    } else if (after === 'error') {
      push({
        icon: 'fa-solid fa-triangle-exclamation',
        iconColor: '#ef4444',
        name: 'WinNotch',
        message: state.error ?? 'Échec de la mise à jour',
      });
    }
  }, [state.status, state.latestVersion, state.error, push]);
}
