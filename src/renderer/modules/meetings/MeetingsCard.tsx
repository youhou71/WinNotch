/**
 * Card Meetings du dashboard étendu.
 *
 * Reproduit le pattern `MeetingsCard` du prototype : headline "next
 * meeting" avec heure + countdown coloré + lieu/visio + attendees,
 * suivi d'une liste collapsible des suivants (toggle dans le header).
 *
 * Cas vides :
 *  - Aucun compte connecté → CTA "Connecter un calendrier" (envoie vers
 *    Settings module Meetings via callback futur — pour Phase 5, on
 *    montre juste un message).
 *  - Comptes connectés mais 0 meeting → "Aucun rendez-vous · vous êtes libre".
 */
import { useState } from 'react';
import { useMeetingsContext } from './MeetingsContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { fmtCountdown, fmtTime, KIND_META, urgency } from './helpers';

interface RefreshButtonProps {
  onClick: () => Promise<void>;
}

/**
 * Bouton refresh dans le header de la card. État loading local qui fait
 * tourner l'icône pendant l'appel. Pas de toast — le re-render de la
 * liste sert d'indicateur de succès.
 */
function RefreshButton({ onClick }: RefreshButtonProps) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="card-icon-btn"
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
      title="Rafraîchir"
      aria-label="Rafraîchir les rendez-vous"
    >
      <i className={'fa-solid fa-arrows-rotate' + (busy ? ' fa-spin' : '')} />
    </button>
  );
}

export function MeetingsCard() {
  const { meetings, next, refresh } = useMeetingsContext();
  const { settings } = useSettingsContext();
  const [showRest, setShowRest] = useState(false);

  const accounts = settings.moduleConfig.meetings.accounts;
  const maxUpcoming = settings.moduleConfig.meetings.maxUpcoming;

  // Wrap pour passer à RefreshButton qui attend un Promise<void>.
  const handleRefresh = async () => {
    await refresh();
  };

  // Aucun compte connecté → invite explicite plutôt que "0 meeting" trompeur.
  if (accounts.length === 0) {
    return (
      <div className="card card-meetings" data-notch-hit="true">
        <div className="card-header">
          <div className="card-header-left">
            <i className="fa-regular fa-calendar" />
            Prochains rendez-vous
          </div>
        </div>
        <div className="card-empty">
          <i className="fa-regular fa-calendar-plus" />
          <div className="ce-text">
            <span className="ce-title">Aucun calendrier connecté</span>
            <span className="ce-desc">
              Ouvre les réglages → Prochains rendez-vous pour connecter
              Outlook ou Google.
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (!next) {
    return (
      <div className="card card-meetings" data-notch-hit="true">
        <div className="card-header">
          <div className="card-header-left">
            <i className="fa-regular fa-calendar" />
            Prochains rendez-vous
          </div>
          <div className="card-header-right">
            <RefreshButton onClick={handleRefresh} />
            <span className="card-count">0</span>
          </div>
        </div>
        <div className="card-empty">
          <i className="fa-regular fa-calendar-check" />
          <div className="ce-text">
            <span className="ce-title">Aucun rendez-vous</span>
            <span className="ce-desc">Vous êtes libre.</span>
          </div>
        </div>
      </div>
    );
  }

  const visible = meetings.slice(0, maxUpcoming);
  const [headline, ...rest] = visible;
  const kn = KIND_META[headline.kind];
  const u = urgency(headline, settings.moduleConfig.meetings.imminentMin);
  const headlineClasses = ['meeting-next'];
  if (u === 'imminent') headlineClasses.push('is-imminent');
  if (u === 'ongoing') headlineClasses.push('is-ongoing');

  return (
    <div className="card card-meetings" data-notch-hit="true">
      <div className="card-header">
        <div className="card-header-left">
          <i className="fa-regular fa-calendar" />
          Prochains rendez-vous
        </div>
        <div className="card-header-right">
          <RefreshButton onClick={handleRefresh} />
          {rest.length > 0 ? (
            <button
              type="button"
              className={'card-header-toggle' + (showRest ? ' is-open' : '')}
              onClick={() => setShowRest((o) => !o)}
              aria-expanded={showRest}
              title={showRest ? 'Masquer les suivants' : 'Voir les suivants'}
            >
              <span className="card-count">{visible.length} à venir</span>
              <i className="fa-solid fa-chevron-down meeting-list-chev" />
            </button>
          ) : (
            <span className="card-count">{visible.length} à venir</span>
          )}
        </div>
      </div>

      <div className={headlineClasses.join(' ')}>
        <div className="meeting-next-time">
          <div className="mn-hour">{fmtTime(headline.start)}</div>
          <div className="mn-until">
            {fmtCountdown(headline.minutesUntil, headline.start)}
          </div>
        </div>
        <div className="meeting-next-body">
          <div className="mn-title">{headline.title}</div>
          <div className="mn-meta">
            {headline.location && (
              <>
                <span className="mn-loc" style={{ color: kn.color }}>
                  <i className={kn.icon} />
                  {kn.label}
                </span>
                <span className="mn-dot">·</span>
              </>
            )}
            <span className="mn-dur">{headline.durationMin} min</span>
          </div>
        </div>
        {headline.attendees.length > 0 && (
          <div className="meeting-next-people">
            {headline.attendees.slice(0, 4).map((a, i) => (
              <span key={i} className="mn-avatar" style={{ zIndex: 10 - i }}>
                {a}
              </span>
            ))}
          </div>
        )}
      </div>

      {rest.length > 0 && showRest && (
        <div className="meeting-list-rows">
          {rest.map((m) => {
            const km = KIND_META[m.kind];
            return (
              <div key={m.id} className="meeting-row">
                <div className="meeting-row-time">{fmtTime(m.start)}</div>
                <div className="meeting-row-body">
                  <div className="meeting-row-title">{m.title}</div>
                  {m.location && (
                    <div className="meeting-row-loc">
                      <i className={km.icon} style={{ color: km.color }} />
                      {km.label}
                    </div>
                  )}
                </div>
                <div className="meeting-row-until">
                  {fmtCountdown(m.minutesUntil, m.start)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
