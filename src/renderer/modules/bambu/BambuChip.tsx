/**
 * Chip Bambu dans la collapsed row.
 *
 * Affichée pendant un print (ou en permanence si `showWhenIdle`) : icône
 * imprimante + pourcentage + ETA court. Vire au rouge si une erreur HMS est
 * active. Tooltip détaillé (fichier, layer, ETA, état connexion).
 *
 * La visibilité de base (module activé + print en cours / showWhenIdle) est
 * gérée par `CollapsedRow` ; la chip se cache d'elle-même tant qu'elle n'est
 * pas configurée.
 */
import { type CSSProperties } from 'react';
import { useBambuContext } from './BambuContext';
import { NotchTooltip } from '../../components/Tooltip/NotchTooltip';
import {
  BAMBU_ACCENT,
  connectionLabel,
  formatEta,
  gcodeLabel,
} from './bambuLabels';

export function BambuChip() {
  const { state } = useBambuContext();

  // Rien à montrer tant que non configuré.
  if (!state.configured) return null;

  const hasError = state.hms.length > 0 || state.connection === 'error';
  const color = hasError ? '#ef4444' : BAMBU_ACCENT;
  const accent: CSSProperties = {
    '--tt-accent': color,
    '--tt-accent-fade': `${color}2e`,
    '--bambu-color': color,
  } as CSSProperties;

  const tooltipContent = (
    <div className="tt-body">
      <div className="tt-head">
        <i className="fa-solid fa-print" style={{ color }} />
        <span>{state.printerName || 'imprimante'}</span>
      </div>
      <div className="tt-bambu-meta">
        <span>
          <strong>état</strong> {gcodeLabel(state.gcodeState)}
        </span>
        {state.isPrinting && (
          <>
            {state.fileName && <span>{state.fileName}</span>}
            <span>
              {state.progressPercent}% · {formatEta(state.remainingMin)} restant
            </span>
            {state.layerCur !== null && state.layerTotal !== null && (
              <span>
                couche {state.layerCur}/{state.layerTotal}
              </span>
            )}
          </>
        )}
        {state.connection !== 'connected' && (
          <span>{connectionLabel(state.connection)}</span>
        )}
        {hasError && state.hms[0] && (
          <span className="tt-bambu-error">HMS {state.hms[0].code}</span>
        )}
      </div>
    </div>
  );

  return (
    <NotchTooltip accentStyle={accent} content={tooltipContent}>
      <div className="chip chip-bambu" style={accent}>
        <i className="fa-solid fa-print" />
        {state.isPrinting ? (
          <span className="bambu-chip-pct">{state.progressPercent}%</span>
        ) : (
          <span className="bambu-chip-dot" />
        )}
      </div>
    </NotchTooltip>
  );
}
