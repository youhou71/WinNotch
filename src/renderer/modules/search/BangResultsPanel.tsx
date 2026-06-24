/**
 * Panneau de résultats du mode `!` (quicklinks / web bangs).
 *
 * Affiché sous la search bar, même pattern que `SearchResultsPanel` (liste
 * navigable ↑↓ + Entrée / clic). Chaque ligne = un quicklink résolu avec la
 * requête courante, ou le fallback DuckDuckGo. La résolution d'URL est faite
 * en amont par NotchSearch (`shared/quicklinks.ts`).
 */
export interface BangItem {
  /** Alias du quicklink (ou alias tapé pour le fallback DDG). */
  alias: string;
  /** Libellé affiché. */
  label: string;
  /** Host cible (pour l'aperçu). */
  host: string;
  /** Requête courante (vide si l'utilisateur n'a tapé que l'alias). */
  query: string;
  /** URL résolue ouverte sur Entrée / clic. */
  url: string;
  /** `true` si c'est la ligne de repli DuckDuckGo. */
  ddg?: boolean;
}

interface Props {
  items: BangItem[];
  selIdx: number;
  onSelect: (idx: number) => void;
  onPick: (idx: number) => void;
}

export function BangResultsPanel({ items, selIdx, onSelect, onPick }: Props) {
  if (items.length === 0) {
    return (
      <div className="search-empty" data-notch-hit="true">
        <i className="fa-solid fa-bolt" />
        Aucun quicklink — ajoute-en dans Réglages → Recherche
      </div>
    );
  }

  return (
    <div className="search-results bang-results" data-notch-hit="true" role="listbox">
      {items.map((item, i) => (
        <div
          key={(item.ddg ? 'ddg:' : 'ql:') + item.alias}
          className={'search-row bang-row' + (i === selIdx ? ' sel' : '')}
          role="option"
          aria-selected={i === selIdx}
          onMouseEnter={() => onSelect(i)}
          onClick={() => onPick(i)}
        >
          <span className="bang-alias">{item.ddg ? '!' + item.alias : item.alias}</span>
          <div className="sr-body">
            <div className="sr-name">{item.label}</div>
            <div className="sr-path">
              {item.query ? `« ${item.query} » · ` : ''}
              {item.host}
            </div>
          </div>
          <i
            className={
              'bang-row-icon fa-solid ' +
              (item.ddg ? 'fa-magnifying-glass' : 'fa-arrow-up-right-from-square')
            }
          />
        </div>
      ))}
    </div>
  );
}
