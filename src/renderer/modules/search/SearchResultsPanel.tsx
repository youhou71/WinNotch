/**
 * Panel de résultats affiché sous la search bar quand le mode actif est
 * `/` (VS Code workspaces) ou `vs` (Visual Studio solutions).
 *
 * Pattern volontairement neutre : un seul composant accepte une liste de
 * `SearchResult` et un index sélectionné, plus deux callbacks (hover et
 * pick). Toute la logique de filtre/load reste dans NotchSearch.
 *
 * Iconographie par kind :
 *  - vscode-folder    → fa-folder (couleur VS Code bleu)
 *  - vscode-workspace → fa-code (workspace multi-root)
 *  - vs-solution      → fa-cube (icône proche du logo VS)
 */
import type { SearchResult } from '../../../shared/types';

interface Props {
  items: SearchResult[];
  selIdx: number;
  loading?: boolean;
  onSelect: (idx: number) => void;
  onPick: (idx: number) => void;
}

const KIND_META: Record<
  SearchResult['kind'],
  { icon: string; color: string }
> = {
  'vscode-folder': { icon: 'fa-solid fa-folder', color: '#3b9eff' },
  'vscode-workspace': { icon: 'fa-solid fa-code', color: '#3b9eff' },
  'vs-solution': { icon: 'fa-solid fa-cube', color: '#a16ce8' },
};

export function SearchResultsPanel({
  items,
  selIdx,
  loading,
  onSelect,
  onPick,
}: Props) {
  if (loading && items.length === 0) {
    return (
      <div className="search-empty" data-notch-hit="true">
        <i className="fa-solid fa-circle-notch fa-spin" />
        Recherche en cours…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="search-empty" data-notch-hit="true">
        <i className="fa-regular fa-folder-open" />
        Aucun résultat
      </div>
    );
  }

  return (
    <div className="search-results" data-notch-hit="true" role="listbox">
      {items.map((item, i) => {
        const meta = KIND_META[item.kind];
        return (
          <div
            key={item.path}
            className={'search-row' + (i === selIdx ? ' sel' : '')}
            role="option"
            aria-selected={i === selIdx}
            onMouseEnter={() => onSelect(i)}
            onClick={() => onPick(i)}
          >
            <i className={meta.icon} style={{ color: meta.color }} />
            <div className="sr-body">
              <div className="sr-name">{item.name}</div>
              <div className="sr-path">{item.path}</div>
            </div>
            <div className="sr-when">{item.meta}</div>
          </div>
        );
      })}
    </div>
  );
}
