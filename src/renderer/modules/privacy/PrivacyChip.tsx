/**
 * Chip « confidentialité » dans la collapsed row.
 *
 * Pastille rouge quand une app utilise actuellement la **webcam** et/ou le
 * **micro** (icônes caméra / micro). Visible même en DND : c'est un état de
 * sécurité que l'utilisateur veut voir en permanence (surtout en
 * présentation). Tooltip rich listant les apps concernées.
 *
 * La chip n'est rendue (via `CollapsedRow`) que lorsque cam OU micro est
 * actif — au repos, rien ne s'affiche (pas de bruit visuel).
 */
import type { CSSProperties } from 'react';
import { usePrivacyContext } from './PrivacyContext';
import { NotchTooltip } from '../../components/Tooltip/NotchTooltip';

const PRIVACY_ACCENT: CSSProperties = {
  '--tt-accent': '#ef4444',
  '--tt-accent-fade': 'rgba(239, 68, 68, 0.18)',
} as CSSProperties;

export function PrivacyChip() {
  const { state } = usePrivacyContext();
  if (!state.camActive && !state.micActive) return null;

  return (
    <NotchTooltip
      accentStyle={PRIVACY_ACCENT}
      content={
        <div className="tt-body">
          <div className="tt-head" style={{ color: '#f87171' }}>
            <i className="fa-solid fa-circle-dot" />
            <span>caméra / micro actif</span>
          </div>
          {state.camActive && (
            <div className="tt-sub">
              <i className="fa-solid fa-video" />{' '}
              {state.camApps.length > 0 ? state.camApps.join(', ') : 'webcam en cours'}
            </div>
          )}
          {state.micActive && (
            <div className="tt-sub">
              <i className="fa-solid fa-microphone" />{' '}
              {state.micApps.length > 0 ? state.micApps.join(', ') : 'micro en cours'}
            </div>
          )}
        </div>
      }
    >
      <div className="chip chip-privacy">
        {state.camActive && (
          <i className="fa-solid fa-video privacy-glyph" aria-label="Caméra active" />
        )}
        {state.micActive && (
          <i className="fa-solid fa-microphone privacy-glyph" aria-label="Micro actif" />
        )}
        <span className="privacy-dot" aria-hidden="true" />
      </div>
    </NotchTooltip>
  );
}
