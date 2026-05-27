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
import type { MeetingAttendee } from '../../../shared/types';
import { useMeetingsContext } from './MeetingsContext';
import { useSettingsContext } from '../settings/SettingsContext';
import {
  fmtCountdown,
  fmtDayPrefix,
  fmtTime,
  hueFromString,
  initialsFromAttendee,
  KIND_META,
  meetingJoinUrl,
  meetingOpenUrl,
  PROVIDER_META,
  urgency,
} from './helpers';

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

/**
 * Bloc d'actions pour un RDV — jusqu'à 2 boutons côte à côte :
 *  - "Rejoindre" (icône caméra) : présent uniquement si une URL de visio
 *    est attachée (location est un http(s)).
 *  - "Ouvrir" (icône external-link) : présent dès que webLink existe.
 *    Ouvre la fiche du RDV dans le calendrier web (Outlook/Google).
 *
 * Variante `text` (headline) : pill avec icône + libellé.
 * Variante `icon` (rows) : juste l'icône.
 *
 * stopPropagation pour ne pas déclencher d'éventuels handlers parents
 * quand on rendra la row entière cliquable plus tard.
 */
function MeetingActions({
  meeting,
  variant = 'text',
}: {
  meeting: import('../../../shared/types').Meeting;
  variant?: 'text' | 'icon';
}) {
  const joinUrl = meetingJoinUrl(meeting);
  const openUrl = meetingOpenUrl(meeting);
  if (!joinUrl && !openUrl) return null;

  const open = (url: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    void window.notch.shell.openExternal(url).then((res) => {
      if (!res.ok) {
        console.warn('[meetings] openExternal failed:', url, res.error);
      }
    });
  };

  const isIcon = variant === 'icon';
  const containerClass = isIcon ? 'meeting-actions is-icon' : 'meeting-actions';

  return (
    <div className={containerClass}>
      {joinUrl && (
        <button
          type="button"
          className={
            isIcon
              ? 'meeting-action meeting-action-icon meeting-action-join'
              : 'meeting-action meeting-action-join'
          }
          onClick={open(joinUrl)}
          title={isIcon ? `Rejoindre — ${meeting.title}` : undefined}
          aria-label="Rejoindre"
        >
          <i className="fa-solid fa-video" />
          {!isIcon && <span>Rejoindre</span>}
        </button>
      )}
      {openUrl && (
        <button
          type="button"
          className={
            isIcon
              ? 'meeting-action meeting-action-icon'
              : 'meeting-action meeting-action-secondary'
          }
          onClick={open(openUrl)}
          title={isIcon ? `Ouvrir — ${meeting.title}` : undefined}
          aria-label="Ouvrir"
        >
          <i className="fa-solid fa-arrow-up-right-from-square" />
          {!isIcon && <span>Ouvrir</span>}
        </button>
      )}
    </div>
  );
}

/**
 * Bloc d'avatars empilés. Variante "headline" : grosses bulles + tooltip
 * listant tous les participants avec nom/email/organisateur. Variante
 * "compact" : bulles plus petites pour les RDV suivants, avec un
 * `title` natif HTML listant les noms (pas de tooltip custom pour
 * éviter les soucis de z-index dans la liste scrollable).
 */
function AttendeesAvatars({
  attendees,
  variant = 'headline',
}: {
  attendees: MeetingAttendee[];
  variant?: 'headline' | 'compact';
}) {
  const isCompact = variant === 'compact';
  const maxVisible = isCompact ? 3 : 4;
  const visible = attendees.slice(0, maxVisible);
  const overflow = attendees.length - visible.length;

  const wrapperClass = isCompact
    ? 'meeting-row-people'
    : 'meeting-next-people has-tooltip';
  const avatarClass = isCompact ? 'mn-avatar mn-avatar-compact' : 'mn-avatar';
  const moreClass = isCompact
    ? 'mn-avatar mn-avatar-compact mn-avatar-more'
    : 'mn-avatar mn-avatar-more';

  const nativeTitle = isCompact
    ? attendees
        .map((a) => (a.isOrganizer ? '★ ' : '') + (a.name || a.email))
        .join('\n')
    : undefined;

  return (
    <div className={wrapperClass} title={nativeTitle}>
      {visible.map((a, i) => {
        const hue = hueFromString(a.email || a.name || String(i));
        const bg = `linear-gradient(135deg, hsl(${hue}, 65%, 60%), hsl(${(hue + 40) % 360}, 65%, 55%))`;
        return (
          <span
            key={(a.email || a.name) + i}
            className={avatarClass}
            style={{ zIndex: 10 - i, background: bg }}
          >
            {a.photoDataUrl ? (
              <img src={a.photoDataUrl} alt="" className="mn-avatar-img" />
            ) : (
              initialsFromAttendee(a)
            )}
          </span>
        );
      })}
      {overflow > 0 && (
        <span className={moreClass} style={{ zIndex: 10 - maxVisible }}>
          +{overflow}
        </span>
      )}
      {!isCompact && (
        <div className="mn-people-tooltip" role="tooltip">
          <div className="mnpt-header">
            {attendees.length} participant{attendees.length > 1 ? 's' : ''}
          </div>
          <ul className="mnpt-list">
            {attendees.map((a, i) => {
              const hue = hueFromString(a.email || a.name || String(i));
              const bg = `linear-gradient(135deg, hsl(${hue}, 65%, 60%), hsl(${(hue + 40) % 360}, 65%, 55%))`;
              return (
                <li key={(a.email || a.name) + i} className="mnpt-row">
                  <span className="mnpt-thumb" style={{ background: bg }}>
                    {a.photoDataUrl ? (
                      <img src={a.photoDataUrl} alt="" className="mn-avatar-img" />
                    ) : (
                      initialsFromAttendee(a)
                    )}
                  </span>
                  {a.isOrganizer && (
                    <i className="fa-solid fa-crown mnpt-crown" title="Organisateur" />
                  )}
                  <span className="mnpt-name">{a.name || a.email || 'Inconnu'}</span>
                  {a.name && a.email && a.email !== a.name && (
                    <span className="mnpt-email">{a.email}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
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
  // Si une visio est attachée, le bouton "Rejoindre" suffit à signaler
  // le type — on évite de doubler avec la pill (Meet/Teams/Zoom). Pour
  // les salles physiques (room/other), on garde la pill car le libellé
  // de lieu est l'info principale.
  const headlineHasVisio = !!meetingJoinUrl(headline);

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
          <div className="mn-title">
            <i
              className={'mn-provider ' + PROVIDER_META[headline.provider].icon}
              style={{ color: PROVIDER_META[headline.provider].color }}
              title={PROVIDER_META[headline.provider].label}
            />
            {headline.title}
          </div>
          <div className="mn-meta">
            {headline.location && !headlineHasVisio && (
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
          <AttendeesAvatars attendees={headline.attendees} />
        )}
        <MeetingActions meeting={headline} />
      </div>

      {rest.length > 0 && showRest && (
        <div className="meeting-list-rows">
          {rest.map((m) => {
            const km = KIND_META[m.kind];
            const rowHasVisio = !!meetingJoinUrl(m);
            const dayPrefix = fmtDayPrefix(m.start);
            return (
              <div key={m.id} className="meeting-row">
                <div className="meeting-row-time">
                  {dayPrefix && (
                    <span className="meeting-row-day">{dayPrefix}</span>
                  )}
                  <span className="meeting-row-hour">{fmtTime(m.start)}</span>
                </div>
                <div className="meeting-row-body">
                  <div className="meeting-row-title">
                    <i
                      className={'mr-provider ' + PROVIDER_META[m.provider].icon}
                      style={{ color: PROVIDER_META[m.provider].color }}
                      title={PROVIDER_META[m.provider].label}
                    />
                    {m.title}
                  </div>
                  {m.location && !rowHasVisio && (
                    <div className="meeting-row-loc">
                      <i className={km.icon} style={{ color: km.color }} />
                      {km.label}
                    </div>
                  )}
                </div>
                {m.attendees.length > 0 && (
                  <AttendeesAvatars attendees={m.attendees} variant="compact" />
                )}
                <div className="meeting-row-until">
                  {fmtCountdown(m.minutesUntil, m.start)}
                </div>
                <MeetingActions meeting={m} variant="icon" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
