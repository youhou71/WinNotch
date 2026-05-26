/**
 * Pill éphémère affichée sous le notch (`top: 42px`, centré).
 *
 * Reproduit le pattern `notch-toast` du prototype (Notch.html 2442-2497) :
 *  - animation `toast-in` 460 ms spring → `toast-out` 280 ms à 4.8 s
 *  - hover → met les animations en pause (`animation-play-state: paused`)
 *  - clic → dismiss immédiat
 *
 * La clé React sur le composant parent (égale au `id` du toast) force le
 * démontage/remontage entre deux toasts successifs → rejoue l'animation
 * d'entrée même si on push deux toasts à 100 ms d'intervalle.
 */
import { useEffect } from 'react';
import type { Toast } from '../../../shared/types';

interface Props {
  toast: Toast;
  onDismiss: () => void;
  /** Indique si le notch est en mode collapsed (positionne le toast). */
  collapsed: boolean;
}

/** Durée totale d'affichage (in + visible + out) = ~5.2 s côté prototype. */
const AUTO_DISMISS_MS = 5200;

export function NotchToast({ toast, onDismiss, collapsed }: Props) {
  useEffect(() => {
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className={'notch-toast' + (collapsed ? '' : ' is-expanded')}
      onClick={onDismiss}
      role="status"
      aria-live="polite"
    >
      <i className={toast.icon} style={{ color: toast.iconColor }} />
      <span className="nt-name">{toast.name}</span>
      <span className="nt-sep">·</span>
      <span className="nt-msg">{toast.message}</span>
    </div>
  );
}
