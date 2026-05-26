/**
 * Helpers d'affichage pour les meetings — formatage temps + métadonnées
 * visuelles par kind (icône + couleur).
 */
import type { Meeting, MeetingKind } from '../../../shared/types';

/** Formate une date ISO en `14:30` (heure locale). */
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Countdown lisible : "dans 12 min" / "en cours · 8 min" / "demain 09:00".
 * Les valeurs négatives = ongoing ou passé (filtré côté Context).
 */
export function fmtCountdown(min: number, startIso: string): string {
  if (min < 0) {
    const m = -min;
    if (m < 60) return `en cours · ${m} min`;
    return `en cours · ${Math.floor(m / 60)} h`;
  }
  if (min === 0) return 'maintenant';
  if (min < 60) return `dans ${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  if (h < 24) return r ? `dans ${h} h ${r}` : `dans ${h} h`;
  return `demain ${fmtTime(startIso)}`;
}

/**
 * Libellé court pour la chip collapsed : "12 min" / "en cours" / "14:30".
 * Choisit la forme la plus compacte selon le timing.
 */
export function fmtChipLabel(meeting: Meeting): string {
  if (meeting.ongoing) return 'en cours';
  if (meeting.minutesUntil === 0) return 'now';
  if (meeting.minutesUntil < 60) return `${meeting.minutesUntil} min`;
  return fmtTime(meeting.start);
}

/** Métadonnées visuelles par type de visio/lieu. */
export const KIND_META: Record<
  MeetingKind,
  { icon: string; color: string; label: string }
> = {
  meet: { icon: 'fa-brands fa-google', color: '#34d399', label: 'Meet' },
  teams: { icon: 'fa-solid fa-users', color: '#7b83eb', label: 'Teams' },
  zoom: { icon: 'fa-solid fa-video', color: '#3b9eff', label: 'Zoom' },
  room: { icon: 'fa-solid fa-door-open', color: '#fbbf24', label: 'Salle' },
  other: {
    icon: 'fa-solid fa-location-dot',
    color: 'rgba(244,244,245,0.55)',
    label: 'Lieu',
  },
};

/**
 * État d'urgence dérivé du `minutesUntil` — pilote l'apparence (couleur
 * de fond, pulse) de la chip et de la card.
 *  - ongoing : meeting en cours (start ≤ now < end)
 *  - imminent : start dans <= imminentMin
 *  - soon : start dans (imminentMin, 15]
 *  - normal : start dans > 15
 */
export function urgency(
  meeting: Meeting,
  imminentMin: number,
): 'ongoing' | 'imminent' | 'soon' | 'normal' {
  if (meeting.ongoing) return 'ongoing';
  if (meeting.minutesUntil >= 0 && meeting.minutesUntil <= imminentMin) {
    return 'imminent';
  }
  if (meeting.minutesUntil > imminentMin && meeting.minutesUntil <= 15) {
    return 'soon';
  }
  return 'normal';
}
