/**
 * Chip Meetings affichée dans `.cr-right` du notch rétracté.
 *
 * Reproduit le pattern `MeetingChip` du prototype : icône calendrier +
 * label compact (countdown ou heure), pill arrondi avec fond tinté
 * selon l'urgence.
 *
 * Couleurs (cf. helpers.urgency) :
 *  - normal    : gris (txt-dim)
 *  - soon      : jaune (accent-warm)
 *  - imminent  : rouge pulsant
 *  - ongoing   : vert (accent-green)
 */
import type { CSSProperties } from 'react';
import { useMeetingsContext } from './MeetingsContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { NotchTooltip } from '../../components/Tooltip/NotchTooltip';
import {
  KIND_META,
  fmtChipLabel,
  fmtCountdown,
  fmtTime,
  urgency,
} from './helpers';

const MEETING_ACCENT: CSSProperties = {
  '--tt-accent': '#60a5fa',
  '--tt-accent-fade': 'rgba(96, 165, 250, 0.18)',
} as CSSProperties;

export function MeetingChip() {
  const { next, meetings } = useMeetingsContext();
  const { settings } = useSettingsContext();
  if (!next) return null;

  const u = urgency(next, settings.moduleConfig.meetings.imminentMin);
  const classes = ['chip', 'chip-meeting'];
  if (u === 'soon') classes.push('is-soon');
  if (u === 'imminent') classes.push('is-imminent');
  if (u === 'ongoing') classes.push('is-ongoing');

  const kindMeta = KIND_META[next.kind] ?? KIND_META.other;
  const upcoming = meetings.filter((m) => m.id !== next.id).slice(0, 2);

  const urgencyPill =
    u === 'ongoing' ? (
      <span className="tt-meta-pill tt-meta-pill-ok">en cours</span>
    ) : u === 'imminent' ? (
      <span className="tt-meta-pill tt-meta-pill-err">imminent</span>
    ) : u === 'soon' ? (
      <span className="tt-meta-pill tt-meta-pill-warn">bientôt</span>
    ) : null;

  return (
    <NotchTooltip
      accentStyle={MEETING_ACCENT}
      content={
        <div className="tt-body">
          <div className="tt-head">
            <i className="fa-regular fa-calendar" />
            <span>prochain RDV</span>
          </div>
          <div className="tt-row">
            <span className="tt-title">{next.title || 'Sans titre'}</span>
            <span className="tt-sub">{fmtCountdown(next.minutesUntil, next.start)}</span>
            <div className="tt-meta">
              <span className="tt-meta-pill">
                <i className="fa-regular fa-clock" />
                {fmtTime(next.start)}
              </span>
              <span className="tt-meta-pill">
                <i className={kindMeta.icon} />
                {kindMeta.label}
              </span>
              {urgencyPill}
            </div>
          </div>
          {upcoming.length > 0 && (
            <>
              <div className="tt-divider" />
              <ul className="tt-list">
                {upcoming.map((m) => (
                  <li key={m.id} className="tt-row">
                    <span className="tt-title">{m.title || 'Sans titre'}</span>
                    <span className="tt-sub">
                      {fmtTime(m.start)} · {fmtCountdown(m.minutesUntil, m.start)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      }
    >
      <div className={classes.join(' ')}>
        <i className="fa-regular fa-calendar" />
        <span className="meeting-label">{fmtChipLabel(next)}</span>
      </div>
    </NotchTooltip>
  );
}
