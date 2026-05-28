/**
 * Chip Teams Presence dans la collapsed row.
 *
 * Pastille colorée selon l'availability (palette Teams officielle).
 * Tooltip au survol détaille : statut + activity + email du compte +
 * dernière sync. En cas d'erreur typée (no-scope, no-license, network),
 * affiche un message d'aide dans le tooltip à la place.
 *
 * Caché si :
 *  - `error === 'no-account'` (rien à montrer tant qu'aucun compte Outlook)
 *  - `availability === 'Unknown'` (avant le premier polling réussi)
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useTeamsContext } from './TeamsContext';
import { NotchTooltip } from '../../components/Tooltip/NotchTooltip';
import {
  activityLabel,
  colorFor,
  errorLabel,
  formatLastSync,
  labelFor,
} from './teamsLabels';

export function TeamsChip() {
  const { state } = useTeamsContext();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(handle);
  }, []);

  // Pas de compte connecté : on ne montre rien. La card (P2) affichera
  // l'invitation à connecter un compte Outlook.
  if (state.error === 'no-account') return null;

  // Statut pas encore lu et pas d'erreur explicite : pas de chip non plus
  // (évite la pastille grise au boot, qui peut être confondue avec Offline).
  if (state.availability === 'Unknown' && !state.error) return null;

  const color = colorFor(state.availability);
  const accent: CSSProperties = {
    '--tt-accent': color,
    '--tt-accent-fade': `${color}2e`,
    '--teams-color': color,
  } as CSSProperties;

  const tooltipContent = state.error ? (
    <div className="tt-body">
      <div className="tt-head">
        <i className="fa-solid fa-circle-exclamation" />
        <span>teams</span>
      </div>
      <div className="tt-teams-error">{errorLabel(state.error)}</div>
      {state.accountEmail && (
        <div className="tt-teams-meta">
          <span>{state.accountEmail}</span>
        </div>
      )}
    </div>
  ) : (
    <div className="tt-body">
      <div className="tt-head">
        <i className="fa-solid fa-circle" style={{ color }} />
        <span>teams — {labelFor(state.availability)}</span>
      </div>
      <div className="tt-teams-meta">
        {state.activity && state.activity !== state.availability && (
          <span>
            <strong>activité</strong> {activityLabel(state.activity)}
          </span>
        )}
        {state.accountEmail && <span>{state.accountEmail}</span>}
        <span>{formatLastSync(state.lastSyncAt, now)}</span>
      </div>
    </div>
  );

  return (
    <NotchTooltip accentStyle={accent} content={tooltipContent}>
      <div className="chip chip-teams" style={accent}>
        <div className="teams-dot" />
      </div>
    </NotchTooltip>
  );
}
