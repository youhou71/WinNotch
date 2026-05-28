/**
 * Helpers cosmétiques pour le module Teams Presence.
 *
 * Mapping (availability → label humain + couleur). La couleur est
 * exposée comme custom CSS property `--teams-color` côté chip / card,
 * ce qui évite de hardcoder des classes par variant et permet de réutiliser
 * la même palette dans plusieurs composants.
 */
import type { TeamsAvailability, TeamsError } from '../../../shared/types';

/** Code couleur signature par availability — palette Teams officielle. */
export function colorFor(availability: TeamsAvailability): string {
  switch (availability) {
    case 'Available':
      return '#22c55e';
    case 'Busy':
      return '#ef4444';
    case 'DoNotDisturb':
      return '#991b1b';
    case 'BeRightBack':
      return '#eab308';
    case 'Away':
      return '#facc15';
    case 'Offline':
      return '#6b7280';
    case 'Unknown':
    default:
      return '#6b7280';
  }
}

/** Label humain (français, minuscule pour cohérence avec les autres modules). */
export function labelFor(availability: TeamsAvailability): string {
  switch (availability) {
    case 'Available':
      return 'disponible';
    case 'Busy':
      return 'occupé';
    case 'DoNotDisturb':
      return 'ne pas déranger';
    case 'BeRightBack':
      return 'de retour bientôt';
    case 'Away':
      return 'absent';
    case 'Offline':
      return 'hors ligne';
    case 'Unknown':
    default:
      return 'inconnu';
  }
}

/**
 * Label humain pour les `activity` les plus courantes. Pour les valeurs
 * inconnues, on retourne la chaîne brute capitalisée — Microsoft ajoute
 * occasionnellement de nouvelles activités et on ne veut pas qu'elles
 * s'affichent en `Unknown`.
 */
export function activityLabel(activity: string): string {
  switch (activity) {
    case 'Available':
      return 'disponible';
    case 'Busy':
      return 'occupé';
    case 'InACall':
      return 'en appel';
    case 'InAConferenceCall':
      return 'en conférence';
    case 'InAMeeting':
      return 'en réunion';
    case 'Presenting':
      return 'en présentation';
    case 'BeRightBack':
      return 'de retour bientôt';
    case 'Away':
      return 'absent';
    case 'DoNotDisturb':
      return 'ne pas déranger';
    case 'OffWork':
      return 'hors travail';
    case 'Offline':
      return 'hors ligne';
    default:
      return activity || '';
  }
}

/** Message humain pour les erreurs typées du module Teams. */
export function errorLabel(err: TeamsError): string {
  switch (err) {
    case 'no-account':
      return "Connecte un compte Outlook dans Settings → Meetings.";
    case 'no-scope':
      return 'Reconnecte ton compte Outlook pour autoriser Teams Presence.';
    case 'no-license':
      return "Ton compte n'a pas de licence Teams.";
    case 'network':
      return 'Erreur de communication avec Microsoft Graph.';
  }
}

/** Formate un timestamp `lastSyncAt` en `il y a Xs` / `Xmin`. */
export function formatLastSync(lastSyncAt: number, now: number): string {
  if (lastSyncAt === 0) return 'jamais';
  const elapsed = Math.max(0, Math.floor((now - lastSyncAt) / 1000));
  if (elapsed < 60) return `il y a ${elapsed}s`;
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 60) return `il y a ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  return `il y a ${hours}h`;
}
