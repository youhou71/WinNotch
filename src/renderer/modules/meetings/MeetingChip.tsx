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
import { useMeetingsContext } from './MeetingsContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { fmtChipLabel, fmtTime, urgency } from './helpers';

export function MeetingChip() {
  const { next } = useMeetingsContext();
  const { settings } = useSettingsContext();
  if (!next) return null;

  const u = urgency(next, settings.moduleConfig.meetings.imminentMin);
  const classes = ['chip', 'chip-meeting'];
  if (u === 'soon') classes.push('is-soon');
  if (u === 'imminent') classes.push('is-imminent');
  if (u === 'ongoing') classes.push('is-ongoing');

  return (
    <div className={classes.join(' ')} title={`${next.title} · ${fmtTime(next.start)}`}>
      <i className="fa-regular fa-calendar" />
      <span className="meeting-label">{fmtChipLabel(next)}</span>
    </div>
  );
}
