/**
 * Helpers de formatage pour le module Système live.
 *
 * Les fonctions sont pures et synchrones — appelées à chaque tick du
 * polling (1 Hz), donc on évite toute allocation superflue.
 */

/** Formatage d'un pourcentage (entier). `73.6 → "74%"`. */
export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

/**
 * Formatage d'un volume d'octets en unité binaire (KiB, MiB, GiB). Utilise
 * 1 décimale au-delà de 1 KiB pour rester compact dans la chip. Le suffixe
 * SI (`KB`, `MB`, `GB`) reste utilisé pour la familiarité visuelle, même
 * si la base est 1024 (cohérent avec le gestionnaire des tâches Windows).
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Débit binaire en bytes/s → string compact (`1.5 Mb/s`). Affiche en
 * **bits** par seconde (multiplie par 8) car c'est la convention réseau
 * et l'unité affichée dans la maquette (Mb/s, pas MB/s).
 */
export function formatBitrate(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 0) return '0 b/s';
  const bits = bytesPerSec * 8;
  if (bits < 1000) return `${Math.round(bits)} b/s`;
  if (bits < 1_000_000) return `${(bits / 1000).toFixed(1)} Kb/s`;
  if (bits < 1_000_000_000) return `${(bits / 1_000_000).toFixed(1)} Mb/s`;
  return `${(bits / 1_000_000_000).toFixed(2)} Gb/s`;
}

/**
 * Uptime en secondes → string ultra-compact (`3h 52`, `42m`, `12s`).
 * Pas de zéro padding ; supérieur à 24 h on affiche en jours (`2j 04h`).
 */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0s';
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return `${m}m`;
  }
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${String(m).padStart(2, '0')}`;
  }
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return `${d}j ${String(h).padStart(2, '0')}h`;
}

/**
 * Seuils de couleur pour les barres / chip. Couleurs cohérentes avec les
 * tokens existants (`--accent-green` / `--accent-warm`) plus un rouge
 * partagé avec `tokens.css` (`--accent-red`).
 *
 * - CPU / RAM en % : vert < 50, or < 80, rouge sinon
 * - NET en bytes/s : seuils calés sur la pratique d'un poste de dev (1 MB/s
 *   ≈ 8 Mb/s, 10 MB/s ≈ 80 Mb/s — au-delà l'utilisateur a sûrement un
 *   transfert volumineux en cours).
 */
export type SystemMetricKey = 'cpu' | 'ram' | 'net';

export function thresholdColor(
  metric: SystemMetricKey,
  value: number,
): string {
  if (metric === 'net') {
    if (value < 1_000_000) return 'var(--accent-green)';
    if (value < 10_000_000) return 'var(--accent-warm)';
    return 'var(--accent-red)';
  }
  // cpu / ram en %
  if (value < 50) return 'var(--accent-green)';
  if (value < 80) return 'var(--accent-warm)';
  return 'var(--accent-red)';
}

/** Valeur courte affichée à droite de la chip selon la métrique. */
export function formatChipValue(
  metric: SystemMetricKey,
  value: number,
): string {
  if (metric === 'net') return formatBitrate(value);
  return formatPercent(value);
}

/**
 * Borne supérieure utilisée pour normaliser une série (CPU/RAM = 100,
 * NET = max(série) avec un plancher pour éviter une mise à l'échelle
 * trop sensible quand tout est à 0).
 */
export function seriesMax(metric: SystemMetricKey, history: number[]): number {
  if (metric !== 'net') return 100;
  const max = history.reduce((m, v) => (v > m ? v : m), 0);
  // Plancher à 128 KB/s = 1 Mb/s : sinon une activité de fond très faible
  // produit un sparkline qui sature le rendu et donne une fausse impression
  // de pic critique.
  return Math.max(max, 128_000);
}
