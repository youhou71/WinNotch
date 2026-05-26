/**
 * Helpers de normalisation provider → `Meeting` du contrat partagé.
 *
 * Détection du `kind` à partir du libellé location/visio. Choix
 * volontairement simple (substring match) — suffisant pour Phase 5.
 * Si besoin, on enrichira avec une regex plus fine.
 */
import type { MeetingKind } from '../../../shared/types';

export function detectKind(location: string): MeetingKind {
  const l = location.toLowerCase();
  if (l.includes('meet.google') || l.includes('hangouts.google')) return 'meet';
  if (l.includes('teams.microsoft') || l.includes('teams.live')) return 'teams';
  if (l.includes('zoom.us')) return 'zoom';
  if (location.trim().length > 0 && !l.startsWith('http')) return 'room';
  return 'other';
}

/**
 * Convertit "Jean-Pierre Dupont" → "JD". Si une seule chaîne,
 * prend les 2 premières lettres.
 */
export function initials(name: string): string {
  const parts = name
    .replace(/[<>"'`]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Calcule la durée et l'état d'avancement (en cours, à venir, passé)
 * à partir des bornes ISO 8601 du provider.
 */
export function deriveTiming(startIso: string, endIso: string) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const now = Date.now();
  return {
    durationMin: Math.max(0, Math.round((end - start) / 60_000)),
    minutesUntil: Math.round((start - now) / 60_000),
    ongoing: now >= start && now < end,
  };
}
