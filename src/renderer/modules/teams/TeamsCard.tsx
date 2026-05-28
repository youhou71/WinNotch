/**
 * Card Teams Presence du dashboard étendu.
 *
 * Format compact (4 cols par défaut) :
 *  - header : pastille couleur + label module + état "loading"
 *  - sub : libellé humain du statut + email du compte + dernière sync
 *  - row de 5 boutons (Available / Busy / DoNotDisturb / BeRightBack / Away)
 *  - bouton "Auto" (clearUserPreferredPresence) en pied de card
 *
 * Cas d'erreur (bannière conditionnelle) :
 *  - `no-account` : invitation à connecter un compte Outlook dans Meetings
 *  - `no-scope`   : bouton "Reconnecter" qui relance le flow OAuth en
 *                   `prompt=consent` (handler `teams:reconnect`)
 *  - `no-license` : message statique (rien à faire côté WinNotch)
 *  - `network`    : message + tick suivant essaiera de nouveau
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useTeamsContext } from './TeamsContext';
import type { TeamsAvailability } from '../../../shared/types';
import {
  activityLabel,
  colorFor,
  errorLabel,
  formatLastSync,
  labelFor,
} from './teamsLabels';

/** Boutons proposés à l'utilisateur, dans l'ordre d'affichage. */
const AVAILABILITY_BUTTONS: Array<{
  id: TeamsAvailability;
  short: string;
  title: string;
}> = [
  { id: 'Available', short: 'Dispo', title: 'Disponible' },
  { id: 'Busy', short: 'Occ.', title: 'Occupé' },
  { id: 'DoNotDisturb', short: 'NPD', title: 'Ne pas déranger' },
  { id: 'BeRightBack', short: 'BRB', title: 'De retour bientôt' },
  { id: 'Away', short: 'Abs.', title: 'Absent' },
];

export function TeamsCard() {
  const { state, setPresence, clearPresence, reconnect } = useTeamsContext();
  const [now, setNow] = useState(Date.now());
  const [reconnectMsg, setReconnectMsg] = useState<string | null>(null);

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(handle);
  }, []);

  const color = colorFor(state.availability);
  const accent: CSSProperties = {
    '--teams-color': color,
  } as CSSProperties;

  const handleSet = async (availability: TeamsAvailability) => {
    setReconnectMsg(null);
    await setPresence(availability);
  };

  const handleClear = async () => {
    setReconnectMsg(null);
    await clearPresence();
  };

  const handleReconnect = async () => {
    setReconnectMsg(null);
    const res = await reconnect();
    if (!res.ok) {
      setReconnectMsg(res.error ?? 'Échec de la reconnexion.');
    }
  };

  // Cas no-account : pas de compte du tout, on invite à aller dans Meetings.
  if (state.error === 'no-account') {
    return (
      <div className="teams-card" data-notch-hit="true" style={accent}>
        <div className="teams-head">
          <span className="teams-dot teams-dot-sm" />
          <span className="teams-label">teams</span>
        </div>
        <div className="teams-banner">
          {errorLabel('no-account')}
        </div>
      </div>
    );
  }

  return (
    <div className="teams-card" data-notch-hit="true" style={accent}>
      <div className="teams-head">
        <span className="teams-dot teams-dot-sm" />
        <span className="teams-label">teams</span>
        {state.loading && <span className="teams-spinner" aria-hidden="true" />}
      </div>

      <div className="teams-status">
        <span className="teams-status-availability">
          {labelFor(state.availability)}
        </span>
        {state.activity && state.activity !== state.availability && (
          <span className="teams-status-activity">
            · {activityLabel(state.activity)}
          </span>
        )}
      </div>

      <div className="teams-sub">
        {state.accountEmail && (
          <span className="teams-sub-email">{state.accountEmail}</span>
        )}
        <span className="teams-sub-sync">
          {formatLastSync(state.lastSyncAt, now)}
        </span>
      </div>

      {state.error === 'no-scope' && (
        <div className="teams-error">
          <div className="teams-error-msg">{errorLabel('no-scope')}</div>
          <button
            type="button"
            className="teams-btn teams-btn-reconnect"
            onClick={(e) => {
              e.stopPropagation();
              void handleReconnect();
            }}
            disabled={state.loading}
          >
            Reconnecter
          </button>
          {reconnectMsg && (
            <div className="teams-error-msg teams-error-detail">
              {reconnectMsg}
            </div>
          )}
        </div>
      )}

      {state.error === 'no-license' && (
        <div className="teams-error">
          <div className="teams-error-msg">{errorLabel('no-license')}</div>
        </div>
      )}

      {state.error === 'network' && (
        <div className="teams-error">
          <div className="teams-error-msg">{errorLabel('network')}</div>
        </div>
      )}

      {/* Les boutons sont toujours rendus (sauf no-account déjà filtré
          plus haut) — désactivés sur loading ou erreur verrouillante,
          mais visibles pour rester découvrable. */}
      <div className="teams-actions">
        {AVAILABILITY_BUTTONS.map((b) => {
          const isActive = state.availability === b.id;
          const btnAccent: CSSProperties = {
            '--btn-color': colorFor(b.id),
          } as CSSProperties;
          return (
            <button
              key={b.id}
              type="button"
              className={`teams-btn teams-btn-availability ${isActive ? 'teams-btn-active' : ''}`}
              style={btnAccent}
              title={b.title}
              onClick={(e) => {
                e.stopPropagation();
                void handleSet(b.id);
              }}
              disabled={
                state.loading ||
                state.error === 'no-scope' ||
                state.error === 'no-license'
              }
            >
              <span className="teams-btn-dot" />
              <span className="teams-btn-label">{b.short}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="teams-btn teams-btn-auto"
        onClick={(e) => {
          e.stopPropagation();
          void handleClear();
        }}
        disabled={
          state.loading ||
          state.error === 'no-scope' ||
          state.error === 'no-license'
        }
        title="Repasser au statut automatique de Teams (clearUserPreferredPresence)"
      >
        Auto
      </button>
    </div>
  );
}
