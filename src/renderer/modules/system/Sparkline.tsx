/**
 * Mini sparkline SVG inline réutilisable.
 *
 * Le composant ne gère AUCUN état : il rend une `<polyline>` à partir des
 * points fournis. Le re-render est piloté par le state amont (le tick de
 * polling change `history` → propage la nouvelle référence d'array).
 *
 * Pas de transition CSS : la mise à jour à 1 Hz n'a pas besoin d'easing,
 * et un easing rendrait la lecture du sparkline imprécise.
 */
import { useMemo, type CSSProperties } from 'react';

interface Props {
  /** Série temporelle. Le dernier élément est la valeur la plus récente. */
  points: number[];
  /** Borne supérieure de la série pour la normalisation (typiquement 100 pour %, ou max(série) pour net). */
  max: number;
  /** Couleur du tracé (CSS color, ex. "var(--accent-green)" ou "#34d399"). */
  color: string;
  /** Largeur du SVG en pixels. */
  width?: number;
  /** Hauteur du SVG en pixels. */
  height?: number;
  /**
   * Si `true`, le SVG est rendu avec `preserveAspectRatio="none"` : il
   * peut être étiré horizontalement via CSS sans conserver le ratio
   * largeur/hauteur. Utile pour les sparklines élastiques qui doivent
   * remplir un conteneur en flex. Par défaut `false` (ratio préservé,
   * comportement historique du module Système live).
   */
  stretch?: boolean;
}

export function Sparkline({
  points,
  max,
  color,
  width = 38,
  height = 12,
  stretch = false,
}: Props) {
  // Calcul des coordonnées : pas d'allocation hors render et calcul léger
  // (60 points = 60 itérations).
  const path = useMemo(() => {
    if (!points || points.length === 0) return '';
    const n = points.length;
    const denom = Math.max(1, max);
    const coords: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = (i / Math.max(1, n - 1)) * width;
      const norm = Math.max(0, Math.min(1, points[i] / denom));
      // Inverse Y : SVG a (0,0) en haut-gauche, on veut que la valeur
      // haute pointe vers le haut. Réserve 1 px en bas pour ne pas coller
      // la baseline et 1 px en haut pour le stroke.
      const y = height - 1 - norm * (height - 2);
      coords.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return coords.join(' ');
  }, [points, max, width, height]);

  const style: CSSProperties = stretch
    ? { overflow: 'hidden' }
    : { overflow: 'visible', flexShrink: 0 };

  return (
    <svg
      className="system-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={stretch ? 'none' : 'xMidYMid meet'}
      style={style}
      aria-hidden="true"
    >
      <polyline
        points={path}
        fill="none"
        stroke={color}
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
