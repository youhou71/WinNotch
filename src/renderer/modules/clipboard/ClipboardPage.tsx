/**
 * Page Presse-papier plein-dashboard.
 *
 * Même pattern visuel que `TasksList` (vue mode `-`) ou `SettingsView` :
 * header avec stats + actions, hint bar, recherche, liste paginée. Pas
 * de bordure « card » — c'est une vraie page qui occupe tout le dashboard.
 *
 * Ouverte via :
 *  - Bouton 📋 dans la search bar (cf. NotchSearch + ExpandedDashboard)
 *  - Raccourci global `Ctrl + Alt + V` (cf. globalShortcuts)
 *
 * À l'ouverture, `markSeen` efface le badge "non vu" de la chip
 * Clipboard du notch rétracté. Le focus initial sur la search interne
 * est piloté par `pendingFocusAt` du Context (incrémenté à chaque
 * Ctrl+Alt+V).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEntry } from '../../../shared/types';
import { useClipboardContext } from './ClipboardContext';
import { ClipboardItemPreview } from './ClipboardItemPreview';
import { useMouseBackButton } from '../../hooks/useMouseBackButton';
import { useEscapeKey } from '../../hooks/useEscapeKey';

const ITEM_TYPE_LABEL: Record<ClipboardEntry['type'], string> = {
  image: 'Image',
  jwt: 'JWT',
  url: 'URL',
  json: 'JSON',
  color: 'Couleur',
  path: 'Chemin',
  uuid: 'UUID',
  hash: 'Hash',
  epoch: 'Epoch',
  text: 'Texte',
};

function timeAgo(ts: number): string {
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 60) return `il y a ${diffSec} s`;
  const min = Math.round(diffSec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(diffSec / 3600);
  if (h < 48) return `il y a ${h} h`;
  const d = Math.round(diffSec / 86400);
  return `il y a ${d} j`;
}

interface RowProps {
  entry: ClipboardEntry;
  onCopy: (id: string) => void;
  onPin: (id: string) => void;
  onUnpin: (id: string) => void;
  onRemove: (id: string) => void;
  onSaveImage: (id: string) => void;
  onOpenPath: (id: string) => void;
  onUnfurl: (id: string) => Promise<import('../../../shared/types').UrlUnfurl | null>;
}

function ClipboardRow({
  entry,
  onCopy,
  onPin,
  onUnpin,
  onRemove,
  onSaveImage,
  onOpenPath,
  onUnfurl,
}: RowProps) {
  const [revealed, setRevealed] = useState(false);
  const showSensitive = entry.sensitive && !revealed;

  return (
    <div className={'cb-row' + (entry.pinned ? ' is-pinned' : '')}>
      <div className="cb-row-header">
        <span className="cb-row-type">{ITEM_TYPE_LABEL[entry.type]}</span>
        <span className="cb-row-time">{timeAgo(entry.copiedAt)}</span>
        <div className="cb-row-actions">
          {entry.type === 'image' && (
            <button
              type="button"
              className="cb-row-btn"
              title="Enregistrer l'image"
              onClick={() => onSaveImage(entry.id)}
            >
              <i className="fa-solid fa-floppy-disk" />
            </button>
          )}
          {entry.type === 'path' && (
            <button
              type="button"
              className="cb-row-btn"
              title="Ouvrir dans Explorer"
              onClick={() => onOpenPath(entry.id)}
            >
              <i className="fa-regular fa-folder-open" />
            </button>
          )}
          <button
            type="button"
            className="cb-row-btn"
            title="Copier à nouveau"
            onClick={() => onCopy(entry.id)}
          >
            <i className="fa-regular fa-copy" />
          </button>
          <button
            type="button"
            className={'cb-row-btn' + (entry.pinned ? ' is-active' : '')}
            title={entry.pinned ? 'Détacher' : 'Épingler'}
            onClick={() =>
              entry.pinned ? onUnpin(entry.id) : onPin(entry.id)
            }
          >
            <i className="fa-solid fa-thumbtack" />
          </button>
          <button
            type="button"
            className="cb-row-btn"
            title="Supprimer"
            onClick={() => onRemove(entry.id)}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
      </div>

      <div className="cb-row-body">
        {showSensitive ? (
          <div className="cb-row-sensitive">
            <span className="cb-row-mask">••••••••</span>
            <button
              type="button"
              className="cb-row-reveal"
              onClick={() => setRevealed(true)}
            >
              Révéler
            </button>
          </div>
        ) : (
          <>
            <div className="cb-row-preview-text" title={entry.text ?? undefined}>
              {entry.preview}
            </div>
            {(entry.type === 'image' ||
              entry.type === 'color' ||
              entry.type === 'url' ||
              entry.type === 'json' ||
              entry.type === 'jwt' ||
              entry.type === 'path') && (
              <ClipboardItemPreview entry={entry} onUnfurl={onUnfurl} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

const INITIAL_VISIBLE = 3;
const VISIBLE_STEP = 10;

interface Props {
  /** Demande la fermeture de la page (clic Esc, bouton souris back). */
  onClose: () => void;
}

export function ClipboardPage({ onClose }: Props) {
  const {
    state,
    pendingFocusAt,
    pin,
    unpin,
    copyAgain,
    remove,
    clear,
    markSeen,
    unfurl,
    saveImage,
    openPath,
  } = useClipboardContext();

  const [query, setQuery] = useState('');
  // Pagination de la section "Récent" : initialement 3 entrées affichées,
  // bouton "Voir plus" qui ajoute 10 à chaque clic. Les épinglés ne sont
  // pas paginés (peu nombreux par design et explicitement choisis).
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seenOnMount = useRef(false);

  // Back unifié (Esc + souris XButton1). Le parent ne s'attache pas de
  // handler tant que cette page est montée — sinon double-déclenchement
  // (l'enfant capture, le parent re-capture).
  const handleBack = useCallback(() => {
    onClose();
  }, [onClose]);
  useMouseBackButton(handleBack);
  useEscapeKey(handleBack);

  // Reset la pagination dès que la recherche change.
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [query]);

  // À la première ouverture de la page, marque "vu" pour effacer le badge.
  useEffect(() => {
    if (seenOnMount.current) return;
    seenOnMount.current = true;
    void markSeen();
  }, [markSeen]);

  // Focus la search bar quand le raccourci global Ctrl+Alt+V arrive.
  useEffect(() => {
    if (pendingFocusAt === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [pendingFocusAt]);

  const filter = (e: ClipboardEntry) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      e.preview.toLowerCase().includes(q) ||
      (e.text ?? '').toLowerCase().includes(q)
    );
  };

  const { pinned, others } = useMemo(() => {
    const all = state.entries.filter(filter);
    return {
      pinned: all.filter((e) => e.pinned),
      others: all.filter((e) => !e.pinned),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.entries, query]);

  const handleClear = () => {
    if (confirm("Vider tout l'historique non épinglé ?")) {
      void clear(true);
    }
  };

  const rowProps = {
    onCopy: copyAgain,
    onPin: pin,
    onUnpin: unpin,
    onRemove: remove,
    onSaveImage: saveImage,
    onOpenPath: openPath,
    onUnfurl: unfurl,
  };

  const totalPinned = state.entries.filter((e) => e.pinned).length;
  const totalEntries = state.entries.length;
  const filteredEmpty =
    state.entries.length > 0 && pinned.length === 0 && others.length === 0;

  return (
    <div className="clipboard-view" data-notch-hit="true">
      <div className="clipboard-header">
        <div className="clipboard-stats">
          <span className="cs-num">{totalEntries}</span>
          <span className="cs-label">
            entrée{totalEntries > 1 ? 's' : ''}
          </span>
          {totalPinned > 0 && (
            <>
              <span className="cs-sep">·</span>
              <span className="cs-pinned">
                <i className="fa-solid fa-thumbtack" /> {totalPinned} épinglée
                {totalPinned > 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>
        {totalEntries > 0 && (
          <button
            type="button"
            className="clipboard-clear-btn"
            onClick={handleClear}
            title="Vider l'historique (épinglés conservés)"
          >
            <i className="fa-solid fa-broom" />
            Vider
          </button>
        )}
      </div>

      <div className="clipboard-hint">
        <i className="fa-solid fa-keyboard" />
        <span className="ck">Ctrl + Alt + V</span> ouvre cette page rapidement
        depuis n'importe où.
      </div>

      <input
        ref={inputRef}
        type="text"
        className="clipboard-search"
        placeholder="Rechercher dans le presse-papier…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />

      {totalEntries === 0 ? (
        <div className="clipboard-empty">
          <i className="fa-regular fa-clipboard" />
          <div>Le presse-papier est vide</div>
          <div className="ce-sub">
            Tout ce que tu copies apparaîtra ici.
          </div>
        </div>
      ) : filteredEmpty ? (
        <div className="clipboard-empty">
          <i className="fa-solid fa-magnifying-glass" />
          <div>Aucun résultat</div>
          <div className="ce-sub">
            Aucune entrée ne correspond à « {query} ».
          </div>
        </div>
      ) : (
        <div className="clipboard-list">
          {pinned.length > 0 && (
            <div className="cb-section">
              <div className="cb-section-title">
                Épinglés ({pinned.length})
              </div>
              {pinned.map((e) => (
                <ClipboardRow key={e.id} entry={e} {...rowProps} />
              ))}
            </div>
          )}
          {others.length > 0 && (
            <div className="cb-section">
              <div className="cb-section-title">
                Récent ({others.length})
              </div>
              {others.slice(0, visibleCount).map((e) => (
                <ClipboardRow key={e.id} entry={e} {...rowProps} />
              ))}
              {visibleCount < others.length && (
                <button
                  type="button"
                  className="cb-more-btn"
                  onClick={() =>
                    setVisibleCount((c) =>
                      Math.min(c + VISIBLE_STEP, others.length),
                    )
                  }
                >
                  Voir{' '}
                  {Math.min(VISIBLE_STEP, others.length - visibleCount)} de
                  plus
                  <span className="cb-more-btn-rest">
                    {others.length - visibleCount} restant
                    {others.length - visibleCount > 1 ? 's' : ''}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
