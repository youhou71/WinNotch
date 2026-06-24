/**
 * Panneau de résultats du mode `:` (snippets).
 *
 * Même pattern que `BangResultsPanel` (liste navigable ↑↓ + Entrée / clic).
 * Chaque ligne montre le NOM + un aperçu BRUT du body (placeholders
 * littéraux, jamais résolus → aucun secret affiché). La résolution +
 * copie se fait à la sélection, dans NotchSearch.
 */
import type { Snippet } from '../../../shared/types';
import { snippetPreview } from '../../../shared/snippets';

interface Props {
  items: Snippet[];
  selIdx: number;
  onSelect: (idx: number) => void;
  onPick: (idx: number) => void;
}

export function SnippetResultsPanel({ items, selIdx, onSelect, onPick }: Props) {
  if (items.length === 0) {
    return (
      <div className="search-empty" data-notch-hit="true">
        <i className="fa-solid fa-paste" />
        Aucun snippet — ajoutes-en dans Réglages → Recherche
      </div>
    );
  }

  return (
    <div className="search-results snippet-results" data-notch-hit="true" role="listbox">
      {items.map((item, i) => (
        <div
          key={item.name}
          className={'search-row snippet-row' + (i === selIdx ? ' sel' : '')}
          role="option"
          aria-selected={i === selIdx}
          onMouseEnter={() => onSelect(i)}
          onClick={() => onPick(i)}
        >
          <span className="snippet-name">{item.name}</span>
          <div className="sr-body">
            <div className="sr-path snippet-preview">{snippetPreview(item.body)}</div>
          </div>
          <i className="snippet-row-icon fa-regular fa-copy" />
        </div>
      ))}
    </div>
  );
}
