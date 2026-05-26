/**
 * Page Settings → Disposition du dashboard.
 *
 * Permet à l'utilisateur :
 *  - de réordonner les tuiles du dashboard expanded par drag-and-drop
 *    (poignée ⋮⋮ à gauche, support clavier via @dnd-kit)
 *  - de régler la largeur de chaque tuile sur une grille de 12 colonnes
 *    (slider 1..12 + badge `N/12`)
 *  - de réinitialiser au layout par défaut en un clic
 *
 * Le rendu réel côté `ExpandedDashboard` utilise `settings.dashboardLayout`
 * pour ses `<div class="dash-tile" style="--cols: N">`. Les tuiles dont le
 * module est désactivé sont quand même visibles ici (grisées) pour qu'on
 * puisse pré-régler la disposition avant d'activer le module.
 */
import { useMemo, type CSSProperties } from 'react';
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
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DEFAULT_SETTINGS,
  type DashTile,
  type DashTileId,
} from '../../../shared/types';
import { useSettingsContext } from './SettingsContext';
import { MODULE_META_BY_ID } from './modulesMeta';
import { useMouseBackButton } from '../../hooks/useMouseBackButton';
import { useEscapeKey } from '../../hooks/useEscapeKey';

interface Props {
  onBack: () => void;
}

export function SettingsLayoutPage({ onBack }: Props) {
  const { settings, setDashboardLayout } = useSettingsContext();

  useMouseBackButton(onBack);
  useEscapeKey(onBack);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Petit seuil pour ne pas hijacker les clics sur le slider :
      // tant que le pointeur n'a pas bougé de 4 px, on laisse le slider
      // recevoir l'événement.
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const items = useMemo(
    () => settings.dashboardLayout.map((t) => t.id),
    [settings.dashboardLayout],
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.indexOf(active.id as DashTileId);
    const newIndex = items.indexOf(over.id as DashTileId);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(settings.dashboardLayout, oldIndex, newIndex);
    void setDashboardLayout(next);
  }

  function handleColsChange(id: DashTileId, cols: number) {
    const next: DashTile[] = settings.dashboardLayout.map((t) =>
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
          Glisse ⋮⋮ pour réordonner. Chaque tuile occupe N colonnes sur 12 ;
          tant que la somme d'une rangée tient sous 12, les tuiles restent
          côte à côte, sinon elles passent à la rangée suivante. Les tuiles
          grisées correspondent à des modules désactivés.
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={items} strategy={verticalListSortingStrategy}>
            <div className="layout-list">
              {settings.dashboardLayout.map((tile) => (
                <SortableTileRow
                  key={tile.id}
                  tile={tile}
                  enabled={settings.modules[tile.id]}
                  onColsChange={(cols) => handleColsChange(tile.id, cols)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </>
  );
}

interface RowProps {
  tile: DashTile;
  enabled: boolean;
  onColsChange: (cols: number) => void;
}

function SortableTileRow({ tile, enabled, onColsChange }: RowProps) {
  const meta = MODULE_META_BY_ID[tile.id];
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tile.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : enabled ? 1 : 0.55,
  };

  return (
    <div ref={setNodeRef} style={style} className="layout-row">
      <button
        type="button"
        className="layout-row-handle"
        aria-label={`Déplacer ${meta.label}`}
        {...attributes}
        {...listeners}
      >
        <i className="fa-solid fa-grip-vertical" />
      </button>
      <div
        className="settings-row-icon"
        style={{ background: meta.color + '22', color: meta.color }}
      >
        <i className={meta.icon} />
      </div>
      <div className="layout-row-label">
        <div className="settings-row-label">{meta.label}</div>
        {!enabled && (
          <div className="settings-row-desc">Module désactivé</div>
        )}
      </div>
      <div className="layout-row-control">
        <input
          type="range"
          className="settings-slider"
          min={1}
          max={12}
          step={1}
          value={tile.cols}
          onChange={(e) => onColsChange(Number(e.currentTarget.value))}
          // Stoppe la propagation pour ne pas déclencher le drag du
          // PointerSensor (qui a un activationConstraint à 4 px).
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Largeur de ${meta.label}`}
        />
        <span className="layout-row-cols">{tile.cols}/12</span>
      </div>
    </div>
  );
}
