/**
 * Page Settings → Disposition du dashboard — éditeur WYSIWYG.
 *
 * L'utilisateur édite la disposition directement sur les VRAIES tuiles, sous
 * leur forme finale :
 *  - déplacer une tuile en glisser/déposer (poignée en haut à gauche, support
 *    clavier via @dnd-kit)
 *  - redimensionner sa largeur (1..12 colonnes) en tirant le bord droit, ou
 *    au clavier (flèches ←/→ sur la poignée de resize)
 *  - réinitialiser au layout par défaut en un clic
 *
 * Seules les tuiles RÉELLEMENT visibles dans le dashboard sont éditables
 * (mêmes filtres que `ExpandedDashboard`, via `isTileVisible`). Les tuiles
 * masquées (module désactivé, card masquée, musique sans piste, Claude sans
 * session) conservent leur slot dans `dashboardLayout` mais ne sont pas
 * manipulables ici — le réordonnancement préserve leur position relative.
 *
 * La grille réutilise les classes `.dash-grid` / `.dash-tile` du dashboard
 * réel (héritage de `data-density` ⇒ bon `--d-gap`) pour un rendu fidèle.
 */
import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import {
  DEFAULT_SETTINGS,
  type DashTile,
  type DashTileId,
} from '../../../shared/types';
import { useSettingsContext } from './SettingsContext';
import { useMusicContext } from '../music/MusicContext';
import { useClaudeContext } from '../claude/ClaudeContext';
import { MODULE_META_BY_ID } from './modulesMeta';
import { renderTileCard, isTileVisible } from '../../components/Notch/dashTiles';
import { useMouseBackButton } from '../../hooks/useMouseBackButton';
import { useEscapeKey } from '../../hooks/useEscapeKey';

interface Props {
  onBack: () => void;
}

/**
 * Réordonne le sous-ensemble des tuiles VISIBLES tout en préservant la
 * position relative des tuiles cachées dans le tableau complet.
 *
 * On déplace `fromId` à la place de `toId` parmi les ids visibles, puis on
 * réinjecte cet ordre dans les seuls slots visibles du tableau complet ; les
 * tuiles cachées gardent leur index. Le `cols` suit la TUILE déplacée (lookup
 * par id), pas le slot.
 */
function reorderPreservingHidden(
  full: DashTile[],
  visibleIds: DashTileId[],
  fromId: DashTileId,
  toId: DashTileId,
): DashTile[] {
  const oldIdx = visibleIds.indexOf(fromId);
  const newIdx = visibleIds.indexOf(toId);
  if (oldIdx < 0 || newIdx < 0) return full;
  const reordered = arrayMove(visibleIds, oldIdx, newIdx);
  const visibleSet = new Set<DashTileId>(visibleIds);
  let k = 0;
  return full.map((tile) => {
    if (!visibleSet.has(tile.id)) return tile; // cachée → index inchangé
    const id = reordered[k++];
    const cols = full.find((t) => t.id === id)!.cols; // cols suit la tuile
    return { id, cols };
  });
}

export function SettingsLayoutPage({ onBack }: Props) {
  const { settings, setDashboardLayout } = useSettingsContext();
  const { state: music } = useMusicContext();
  const { active: claudeActive } = useClaudeContext();

  useMouseBackButton(onBack);
  useEscapeKey(onBack);

  const gridRef = useRef<HTMLDivElement | null>(null);

  // `null` hors drag ; figé sur la liste visible courante pendant un drag pour
  // éviter un re-layout brutal si une tuile apparaît/disparaît en plein geste
  // (piste musique qui démarre, session Claude, poll…).
  const [frozenIds, setFrozenIds] = useState<DashTileId[] | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Seuil pour ne pas déclencher un drag sur un simple clic, et laisser la
      // poignée de resize (qui stoppe la propagation) tranquille.
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const hasMusic = !!music.title;
  const hasClaude =
    claudeActive.length > 0 && settings.moduleConfig['claude.live'].showCard;
  const visCtx = {
    modules: settings.modules,
    moduleConfig: settings.moduleConfig,
    hasMusic,
    hasClaude,
  };

  const liveVisibleIds = settings.dashboardLayout
    .filter((t) => isTileVisible(t, visCtx))
    .map((t) => t.id);

  // Pendant un drag on rend la liste figée ; sinon la liste live.
  const itemsForSort = frozenIds ?? liveVisibleIds;

  function handleDragStart() {
    setFrozenIds(liveVisibleIds);
  }

  function handleDragEnd(event: DragEndEvent) {
    setFrozenIds(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const next = reorderPreservingHidden(
      settings.dashboardLayout,
      itemsForSort,
      active.id as DashTileId,
      over.id as DashTileId,
    );
    void setDashboardLayout(next);
  }

  function handleDragCancel() {
    setFrozenIds(null);
  }

  function commitCols(id: DashTileId, cols: number) {
    const next = settings.dashboardLayout.map((t) =>
      t.id === id ? { ...t, cols } : t,
    );
    void setDashboardLayout(next);
  }

  function handleReset() {
    void setDashboardLayout(DEFAULT_SETTINGS.dashboardLayout);
  }

  return (
    <>
      <div className="settings-header">
        <button
          type="button"
          className="settings-header-btn"
          onClick={onBack}
          aria-label="Retour"
        >
          <i className="fa-solid fa-chevron-left" />
        </button>
        <div
          className="settings-row-icon"
          style={{ background: '#60a5fa22', color: '#60a5fa' }}
        >
          <i className="fa-solid fa-table-cells-large" />
        </div>
        <div className="settings-header-title">Disposition du dashboard</div>
        <button
          type="button"
          className="settings-header-btn settings-header-btn-text"
          onClick={handleReset}
          title="Réinitialiser au layout par défaut"
        >
          Réinitialiser
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-section-help">
          Glisse une tuile par sa poignée <i className="fa-solid fa-up-down-left-right" /> pour
          la réordonner, tire son bord droit pour changer sa largeur (1 à 12
          colonnes). Seules les tuiles actuellement visibles dans le dashboard
          sont éditables.
        </div>

        {itemsForSort.length === 0 ? (
          <div className="layout-empty">
            Aucune tuile visible à éditer pour le moment. Active des modules ou
            attends qu'ils aient des données (musique en lecture, session
            Claude…) pour les disposer ici.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext items={itemsForSort} strategy={rectSortingStrategy}>
              <div className="dash-grid layout-edit-grid" ref={gridRef}>
                {itemsForSort.map((id) => {
                  const tile = settings.dashboardLayout.find((t) => t.id === id);
                  if (!tile) return null; // disparue pendant un drag figé
                  return (
                    <EditableTile
                      key={id}
                      tile={tile}
                      gridRef={gridRef}
                      onCommitCols={(cols) => commitCols(id, cols)}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </>
  );
}

interface EditableTileProps {
  tile: DashTile;
  gridRef: RefObject<HTMLDivElement | null>;
  onCommitCols: (cols: number) => void;
}

/** État d'un geste de resize en cours (mémorisé au pointerdown). */
interface ResizeState {
  startX: number;
  startCols: number;
  colW: number;
  gap: number;
  current: number;
}

function EditableTile({ tile, gridRef, onCommitCols }: EditableTileProps) {
  const meta = MODULE_META_BY_ID[tile.id];
  const { attributes, listeners, setNodeRef, isDragging, over, activeIndex, overIndex } =
    useSortable({ id: tile.id });

  // Drag « discret » : on n'applique AUCUN `transform`/`transition` aux tuiles.
  // Les fenêtres Electron `transparent: true` laissent des traînées fantômes
  // dès qu'un élément est animé en continu via transform (bug electron#26147,
  // non corrigé par la désactivation du GPU). On se contente donc de mettre en
  // évidence la tuile saisie (opacité) et le slot cible (`over`) ; le
  // réordonnancement a lieu au lâcher. Rien ne bouge ⇒ aucune traînée.
  const isDropTarget = !isDragging && over?.id === tile.id;
  // Sens d'insertion : si la tuile saisie venait d'AVANT la cible
  // (activeIndex < overIndex), `arrayMove` la place APRÈS la cible ; sinon avant.
  const insertAfter = activeIndex < overIndex;
  // Orientation de la barre d'insertion : si la tuile cible occupe toute la
  // largeur (12 colonnes → seule sur sa rangée), une barre latérale n'aurait
  // pas de sens → barre HORIZONTALE (haut = avant, bas = après). Sinon barre
  // VERTICALE dans le gap (gauche = avant, droite = après).
  const barPos =
    tile.cols >= 12
      ? insertAfter
        ? 'bottom'
        : 'top'
      : insertAfter
        ? 'right'
        : 'left';

  // Largeur affichée pendant un resize (feedback local continu). Hors resize,
  // on retombe sur `tile.cols` (valeur persistée). La persistance n'a lieu
  // qu'au relâchement pour éviter de spammer l'IPC + la remesure de la fenêtre.
  const [liveCols, setLiveCols] = useState<number | null>(null);
  const resize = useRef<ResizeState | null>(null);

  const cols = liveCols ?? tile.cols;

  function onResizePointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(grid).columnGap || '0') || 0;
    const colW = (rect.width - 11 * gap) / 12;
    resize.current = {
      startX: e.clientX,
      startCols: tile.cols,
      colW,
      gap,
      current: tile.cols,
    };
    setLiveCols(tile.cols);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onResizePointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const s = resize.current;
    if (!s) return;
    const delta = Math.round((e.clientX - s.startX) / (s.colW + s.gap));
    const next = Math.max(1, Math.min(12, s.startCols + delta));
    s.current = next;
    setLiveCols(next);
  }

  function endResize(e: ReactPointerEvent<HTMLButtonElement>) {
    const s = resize.current;
    resize.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer déjà relâché */
    }
    setLiveCols(null);
    if (s && s.current !== tile.cols) onCommitCols(s.current);
  }

  function onResizeKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const next = Math.max(1, Math.min(12, tile.cols + delta));
    if (next !== tile.cols) onCommitCols(next);
  }

  const style: CSSProperties = {
    '--cols': cols,
    opacity: isDragging ? 0.4 : 1,
  } as CSSProperties;

  const className =
    'dash-tile is-editing' +
    (isDragging ? ' is-dragging-source' : '') +
    (isDropTarget ? ' is-drop-target' : '');

  return (
    <div ref={setNodeRef} className={className} style={style} data-tile={tile.id}>
      {isDropTarget && (
        <span className="tile-drop-bar" data-pos={barPos} aria-hidden="true" />
      )}

      <button
        type="button"
        className="tile-drag-handle"
        aria-label={`Déplacer ${meta.label}`}
        {...attributes}
        {...listeners}
      >
        <i className="fa-solid fa-up-down-left-right" />
      </button>

      <div className="tile-cols-badge" aria-hidden="true">
        {cols}/12
      </div>

      {/* Card réelle rendue inerte : aucun clic/focus ne l'atteint en édition.
          `pointer-events:none` (CSS) bloque le pointeur, `inert` la sort du
          tab order. Les callbacks ne sont pas passés (no-op de toute façon). */}
      <div
        className="tile-card-inert"
        ref={(el) => {
          if (el) el.setAttribute('inert', '');
        }}
      >
        {renderTileCard(tile.id)}
      </div>

      <button
        type="button"
        className="tile-resize-handle"
        role="slider"
        aria-label={`Largeur de ${meta.label}`}
        aria-valuemin={1}
        aria-valuemax={12}
        aria-valuenow={cols}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onLostPointerCapture={endResize}
        onKeyDown={onResizeKeyDown}
      />
    </div>
  );
}
