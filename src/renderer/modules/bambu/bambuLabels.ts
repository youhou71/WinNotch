/**
 * Helpers de formatage partagés entre la chip et la card Bambu.
 */
import type {
  BambuConnection,
  BambuGcodeState,
} from '../../../shared/types';

/** Couleur d'accent du module (vert Bambu Lab). */
export const BAMBU_ACCENT = '#00ae42';

/** Formate un temps restant (minutes) en libellé court : `1h12`, `45min`, `—`. */
export function formatEta(min: number | null): string {
  if (min === null || min < 0) return '—';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

/** Libellé FR de l'état gcode. */
export function gcodeLabel(state: BambuGcodeState): string {
  switch (state) {
    case 'IDLE':
      return 'Inactif';
    case 'PREPARE':
      return 'Préparation';
    case 'RUNNING':
      return 'Impression';
    case 'PAUSE':
      return 'En pause';
    case 'FINISH':
      return 'Terminé';
    case 'FAILED':
      return 'Échec';
    default:
      return '—';
  }
}

/** Libellé FR de l'état de connexion. */
export function connectionLabel(conn: BambuConnection): string {
  switch (conn) {
    case 'idle':
      return 'Inactif';
    case 'connecting':
      return 'Connexion…';
    case 'connected':
      return 'Connecté';
    case 'offline':
      return 'Hors-ligne';
    case 'error':
      return 'Erreur';
    default:
      return '—';
  }
}

/** Libellé FR du niveau de vitesse (`spd_lvl`). */
export function speedLabel(lvl: number | null): string | null {
  switch (lvl) {
    case 1:
      return 'Silencieux';
    case 2:
      return 'Standard';
    case 3:
      return 'Sport';
    case 4:
      return 'Ludicrous';
    default:
      return null;
  }
}

/** Température formatée `cur→target °C`, ou `cur °C` si pas de cible. */
export function formatTemp(
  cur: number | null,
  target: number | null,
): string {
  if (cur === null) return '—';
  const c = Math.round(cur);
  if (target && target > 0) return `${c}→${Math.round(target)}°`;
  return `${c}°`;
}
