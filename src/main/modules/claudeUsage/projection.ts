/**
 * Projection de tenue des fenêtres d'usage Claude (Lot 1 #3).
 *
 * À partir d'un ring buffer de pourcentages (un point par bucket de 5 min,
 * cf. `claudeUsageService`), on estime une **vélocité de consommation**
 * (moyenne glissante pondérée, récent surpondéré) puis l'instant
 * d'épuisement projeté — borné par le reset de la fenêtre.
 *
 * Fonctions PURES (aucune dépendance Electron / Node) → testables et
 * réutilisables. `now` est injecté pour la testabilité.
 */
import type { ClaudeUsageProjection } from '../../../shared/types';

const HOUR_MS = 3_600_000;

/** Nombre de buckets récents considérés (24 × 5 min = 2 h). */
const VELOCITY_TAIL = 24;

/**
 * En dessous de cette vélocité (points de % / heure) on considère la
 * fenêtre « au repos » : pas de projection d'épuisement (évite d'alerter
 * sur du bruit de mesure).
 */
const MIN_VELOCITY_PCT_PER_HOUR = 0.5;

/**
 * Vélocité de consommation lissée, en points de % par heure (≥ 0).
 *
 * Méthode : sur la queue récente du buffer, moyenne pondérée (poids
 * linéaire croissant vers le présent) des gains de %, en incluant les
 * buckets au repos dans le dénominateur (sinon on surestime).
 *
 * Deux garde-fous :
 *  - un bucket dont la valeur PRÉCÉDENTE est ≤ 0 est ignoré : c'est soit
 *    une pré-donnée (ring buffer pas encore rempli), soit un cold start —
 *    le saut 0 → valeur réelle n'est PAS de la consommation.
 *  - un delta négatif (reset / roll-off de la fenêtre glissante) compte
 *    pour 0 gain (mais le bucket reste au dénominateur).
 */
export function computeVelocityPctPerHour(points: number[], bucketMs: number): number {
  if (!Array.isArray(points) || points.length < 2 || bucketMs <= 0) return 0;
  const tail = points.slice(-VELOCITY_TAIL);
  let weightedGain = 0;
  let weightSpan = 0;
  for (let i = 1; i < tail.length; i++) {
    const prev = tail[i - 1];
    if (prev <= 0) continue; // bucket froid / pré-donnée → ignoré
    const w = i; // surpondération du récent
    weightSpan += w;
    const delta = tail[i] - prev;
    if (delta > 0) weightedGain += delta * w; // reset/roll-off → 0
  }
  if (weightSpan === 0) return 0;
  const avgPerBucket = weightedGain / weightSpan;
  return avgPerBucket * (HOUR_MS / bucketMs);
}

/**
 * Projette la tenue d'une fenêtre. `exhaustAt` n'est renseigné que si
 * l'épuisement projeté tombe AVANT le reset (sinon `null` = tenu).
 */
export function projectWindow(
  percent: number,
  resetsAt: number,
  points: number[],
  now: number,
  bucketMs: number,
): ClaudeUsageProjection {
  const velocity = computeVelocityPctPerHour(points, bucketMs);
  if (percent >= 100) {
    return { velocityPctPerHour: Math.max(0, velocity), exhaustAt: now };
  }
  if (velocity < MIN_VELOCITY_PCT_PER_HOUR) {
    return { velocityPctPerHour: Math.max(0, velocity), exhaustAt: null };
  }
  const remaining = Math.max(0, 100 - percent);
  const exhaustAt = now + (remaining / velocity) * HOUR_MS;
  return {
    velocityPctPerHour: velocity,
    exhaustAt: exhaustAt < resetsAt ? exhaustAt : null,
  };
}
