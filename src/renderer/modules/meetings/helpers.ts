/**
 * Helpers d'affichage pour les meetings — formatage temps + métadonnées
 * visuelles par kind (icône + couleur).
 */
import type {
  CalendarProviderId,
  Meeting,
  MeetingAttendee,
  MeetingKind,
} from '../../../shared/types';

/**
 * Convertit le nom (ou à défaut l'email) en initiales 2 chars pour
 * affichage en bulle d'avatar.
 */
export function initialsFromAttendee(a: MeetingAttendee): string {
  const source = (a.name || a.email || '').replace(/[<>"'`]/g, '').trim();
  if (!source) return '?';
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Hash stable d'une string → teinte HSL [0, 360). Sert à colorer chaque
 * avatar de façon reproductible par participant.
 */
export function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

/** Formate une date ISO en `14:30` (heure locale). */
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Différence en jours calendaires entre `startIso` et maintenant. 0 =
 * aujourd'hui, 1 = demain, 2 = après-demain, etc. Travaille en jours
 * locaux (pas en heures) pour éviter qu'un RDV à 23h ne paraisse être
 * "demain" parce que dans plus de 24h.
 */
function daysFromTodayLocal(startIso: string): number {
  const start = new Date(startIso);
  const now = new Date();
  const startDay = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round(
    (startDay.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  );
}

/**
 * Countdown lisible. Granularité variable :
 *  - en cours (négatif) : "en cours · 8 min" / "en cours · 2 h"
 *  - aujourd'hui : "dans 12 min" / "dans 2 h" / "dans 5 h 30"
 *  - demain : "demain 09:00"
 *  - cette semaine : "vendredi 14:00"
 *  - plus loin : "29 mai 14:00"
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
  // Sous 24h ET même jour calendaire → countdown horaire.
  if (h < 24 && daysFromTodayLocal(startIso) === 0) {
    return r ? `dans ${h} h ${r}` : `dans ${h} h`;
  }
  const d = daysFromTodayLocal(startIso);
  if (d === 1) return `demain ${fmtTime(startIso)}`;
  const start = new Date(startIso);
  if (d < 7) {
    const dayName = start.toLocaleDateString('fr-FR', { weekday: 'long' });
    return `${dayName} ${fmtTime(startIso)}`;
  }
  const date = start.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  });
  return `${date} ${fmtTime(startIso)}`;
}

/**
 * Préfixe court pour identifier le jour d'un RDV dans une liste compacte
 * (rows secondaires). Renvoie chaîne vide si c'est aujourd'hui.
 *  - demain : "demain"
 *  - cette semaine : "lun" / "mar" / ... / "dim"
 *  - plus loin : "29 mai"
 */
export function fmtDayPrefix(startIso: string): string {
  const d = daysFromTodayLocal(startIso);
  if (d === 0) return '';
  if (d === 1) return 'demain';
  const start = new Date(startIso);
  if (d < 7) {
    return start
      .toLocaleDateString('fr-FR', { weekday: 'short' })
      .replace('.', '');
  }
  return start.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  });
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

/** Métadonnées visuelles par provider (icône Font Awesome + couleur). */
export const PROVIDER_META: Record<
  CalendarProviderId,
  { icon: string; color: string; label: string }
> = {
  outlook: {
    icon: 'fa-brands fa-microsoft',
    color: '#0078d4',
    label: 'Outlook',
  },
  google: {
    icon: 'fa-brands fa-google',
    color: '#ea4335',
    label: 'Google',
  },
};

/**
 * URL pour rejoindre la visio si `location` est un lien http(s) — null
 * sinon (RDV en salle, sans visio, etc.).
 */
export function meetingJoinUrl(meeting: Meeting): string | null {
  const loc = meeting.location?.trim() ?? '';
  if (loc.startsWith('http://') || loc.startsWith('https://')) {
    return loc;
  }
  return null;
}

/**
 * URL pour ouvrir le RDV dans le calendrier web du provider. Toujours
 * disponible si le provider a renvoyé un `webLink` (Outlook web, Google
 * Calendar), indépendamment de la présence d'une visio.
 */
export function meetingOpenUrl(meeting: Meeting): string | null {
  return meeting.webLink ?? null;
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
