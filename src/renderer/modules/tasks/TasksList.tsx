/**
 * Vue tâches plein-dashboard rendue quand la search bar est en mode `-`.
 *
 * Reproduit le pattern `TasksView` du prototype (notch-tasks.jsx 6-69) :
 *  - Header : stats "N actives · M terminées" + bouton "Effacer terminées"
 *  - Hint bar verte avec flèche : rappel d'usage (taper puis Entrée)
 *  - Liste des actives, séparateur "TERMINÉES" avec compteur, puis done
 *  - Chaque row : checkbox cerclée (vide → pleine verte avec ✓) + texte
 *    (barré si done, cliquable pour éditer) + boutons copier / ✕ révélés
 *    au hover
 *  - Animation flash sur la tâche fraîchement ajoutée (state.lastAddedId)
 *  - Poignée de glisser-déposer sur les actives (ordre manuel uniquement)
 *  - Pastille d'analyse Claude (en attente / en cours / conclusion / erreur)
 *    + résumé d'une ligne sous le libellé ; clic → ouvre le Markdown
 *
 * État vide : icône + message + petit code stylé du préfixe `-`.
 */
import { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useTasksContext } from './TasksContext';
import { useToast } from '../toast/ToastContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { needsAnalysis } from '../../../shared/tasks';
import type { Task } from '../../../shared/types';

/** Libellé « analysée le … » des infobulles. */
function formatAnalyzedAt(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface AnalysisBadgeProps {
  task: Task;
  /** Analyse activée dans les réglages (sinon : pas d'état « en attente »). */
  enabled: boolean;
  onOpen: (id: string) => void;
}

/**
 * Pastille d'état d'analyse. Cliquable dès qu'une conclusion existe — y
 * compris périmée (libellé modifié) ou après un échec de ré-analyse : la
 * précédente reste consultable en attendant la nouvelle.
 */
function AnalysisBadge({ task, enabled, onOpen }: AnalysisBadgeProps) {
  const a = task.analysis;
  const pending = enabled && needsAnalysis(task);
  const hasConclusion = !!a?.conclusionPath;
  const when = formatAnalyzedAt(a?.analyzedAt);

  let icon: string;
  let cls: string;
  let title: string;
  if (a?.status === 'running') {
    icon = 'fa-solid fa-spinner fa-spin';
    cls = 'is-running';
    title = 'Analyse Claude en cours…';
  } else if (a?.status === 'error' && !pending) {
    icon = 'fa-solid fa-triangle-exclamation';
    cls = 'is-error';
    title = `Échec de l'analyse (${when}) : ${a.error ?? 'erreur inconnue'}`;
    if (hasConclusion) title += ' — clic : conclusion précédente';
  } else if (pending) {
    // Actives uniquement (`needsAnalysis` exclut les terminées).
    icon = hasConclusion ? 'fa-regular fa-file-lines' : 'fa-regular fa-hourglass';
    cls = 'is-pending';
    title = hasConclusion
      ? 'Libellé modifié : ré-analyse en attente — clic : conclusion précédente'
      : "En attente d'analyse Claude";
  } else if (a?.status === 'done' && hasConclusion) {
    icon = 'fa-regular fa-file-lines';
    cls = 'is-done';
    title = `Ouvrir la conclusion (analysée le ${when})`;
  } else {
    return null;
  }

  return hasConclusion ? (
    <button
      type="button"
      className={'task-ai ' + cls}
      onClick={() => onOpen(task.id)}
      title={title}
      aria-label={title}
    >
      <i className={icon} />
    </button>
  ) : (
    <span className={'task-ai ' + cls} title={title} aria-label={title}>
      <i className={icon} />
    </span>
  );
}

interface RowProps {
  task: Task;
  highlight: boolean;
  /** Ligne réordonnable (active + ordre manuel). */
  sortable: boolean;
  analysisEnabled: boolean;
  onOpenConclusion: (id: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  onCopy: (text: string) => void;
}

function TaskRow({
  task,
  highlight,
  sortable,
  analysisEnabled,
  onOpenConclusion,
  onToggle,
  onRemove,
  onUpdate,
  onCopy,
}: RowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.text);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /**
   * Marque une sortie d'édition **sans** écriture (Échap). Le `blur` qui
   * suit immédiatement le démontage du champ ne doit alors pas valider.
   */
  const cancelled = useRef(false);

  // Drag « discret », comme la mise en page du dashboard : AUCUN transform
  // pendant le geste (traînées fantômes des fenêtres Electron transparentes,
  // electron#26147). On surligne la ligne saisie et on dessine une barre
  // d'insertion sur la cible ; le déplacement a lieu au lâcher.
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    over,
    activeIndex,
    overIndex,
  } = useSortable({ id: task.id, disabled: !sortable || editing });
  const isDropTarget = sortable && !isDragging && over?.id === task.id;
  // Même règle que `arrayMove` : venant d'au-dessus → insérée APRÈS la cible.
  const dropPos = activeIndex < overIndex ? 'after' : 'before';

  const startEdit = () => {
    setDraft(task.text);
    cancelled.current = false;
    setEditing(true);
  };

  const commit = () => {
    if (cancelled.current) return;
    setEditing(false);
    // `updateTask` ignore déjà un texte vide côté main ; on évite quand même
    // l'aller-retour IPC quand rien n'a changé.
    const next = draft.trim();
    if (next && next !== task.text) onUpdate(task.id, next);
  };

  const cancel = () => {
    cancelled.current = true;
    setDraft(task.text);
    setEditing(false);
  };

  // Sélectionne le libellé à l'ouverture : corriger une tâche commence le
  // plus souvent par la réécrire entièrement.
  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  /**
   * Échap doit annuler l'édition **sans** refermer la vue tâches.
   *
   * `useEscapeKey` (branché par la vue parente) écoute au niveau `document`
   * en phase de **capture** : il consomme l'événement avant qu'il n'atteigne
   * le champ, un `onKeyDown` React ne verrait donc jamais l'Échap. On écoute
   * donc sur `window`, qui précède `document` dans l'ordre de capture, et
   * uniquement le temps de l'édition.
   */
  useEffect(() => {
    if (!editing) return;
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };
    window.addEventListener('keydown', onKeyDownCapture, true);
    return () => {
      window.removeEventListener('keydown', onKeyDownCapture, true);
    };
    // Pas d'autre dépendance : `cancel` ne referme que des refs et des
    // setters d'état, tous stables d'un rendu à l'autre.
  }, [editing]);

  const summary =
    task.analysis?.summary && !needsAnalysis(task) ? task.analysis.summary : null;

  return (
    <div
      ref={setNodeRef}
      className={
        'task-row' +
        (task.done ? ' is-done' : '') +
        (highlight ? ' is-new' : '') +
        (editing ? ' is-editing' : '') +
        (isDragging ? ' is-dragging' : '') +
        (isDropTarget ? ` is-drop-${dropPos}` : '')
      }
    >
      {sortable && (
        <button
          type="button"
          className="task-grip"
          title="Glisser pour réordonner"
          aria-label="Réordonner la tâche"
          {...attributes}
          {...listeners}
        >
          <i className="fa-solid fa-grip-vertical" />
        </button>
      )}
      <button
        type="button"
        className="task-check"
        onClick={() => onToggle(task.id)}
        aria-pressed={task.done}
        title={task.done ? 'Marquer comme à faire' : 'Marquer comme terminée'}
      >
        {task.done && <i className="fa-solid fa-check" />}
      </button>

      {editing ? (
        <input
          ref={inputRef}
          className="task-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
          spellCheck={false}
          autoComplete="off"
          aria-label="Modifier la tâche"
        />
      ) : (
        <div className="task-body">
          <button
            type="button"
            className="task-text"
            onClick={startEdit}
            title="Cliquer pour modifier"
          >
            {task.text}
          </button>
          {summary && (
            <button
              type="button"
              className="task-summary"
              onClick={() => onOpenConclusion(task.id)}
              title="Ouvrir la conclusion"
            >
              {summary}
            </button>
          )}
        </div>
      )}

      {!editing && (
        <>
          <AnalysisBadge
            task={task}
            enabled={analysisEnabled}
            onOpen={onOpenConclusion}
          />
          <button
            type="button"
            className="task-copy"
            onClick={() => onCopy(task.text)}
            title="Copier le texte"
            aria-label="Copier le texte"
          >
            <i className="fa-regular fa-copy" />
          </button>
          <button
            type="button"
            className="task-remove"
            onClick={() => onRemove(task.id)}
            title="Supprimer"
            aria-label="Supprimer"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </>
      )}
    </div>
  );
}

const byAlpha = (a: Task, b: Task) =>
  a.text.localeCompare(b.text, 'fr', { sensitivity: 'base' });

export function TasksList() {
  const {
    tasks,
    lastAddedId,
    update,
    toggle,
    remove,
    clearDone,
    reorder,
    analyze,
    openConclusion,
  } = useTasksContext();
  const { settings } = useSettingsContext();
  const { push } = useToast();

  const manual = settings.moduleConfig.tasks.sortBy !== 'alpha';
  const active = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  if (!manual) {
    active.sort(byAlpha);
    done.sort(byAlpha);
  }

  const analysisEnabled = settings.moduleConfig.tasks.analysisEnabled;
  const analyzing = tasks.some((t) => t.analysis?.status === 'running');
  const toAnalyze = analysisEnabled
    ? active.filter((t) => needsAnalysis(t, true)).length
    : 0;

  const sensors = useSensors(
    // Seuil : un simple clic sur la poignée ne doit pas démarrer un drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Seules les actives se réordonnent ; les terminées gardent leur ordre
  // relatif et sont recollées derrière (le main tolère l'ordre complet).
  const handleDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    if (!over || dragged.id === over.id) return;
    const ids = active.map((t) => t.id);
    const from = ids.indexOf(String(dragged.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    void reorder([...arrayMove(ids, from, to), ...done.map((t) => t.id)]);
  };

  const toastError = (message: string) =>
    push({
      icon: 'fa-solid fa-triangle-exclamation',
      iconColor: '#ef4444',
      name: 'Tâches',
      message,
    });

  const runAnalysis = () =>
    void analyze().then((res) => {
      if (!res.ok) toastError(res.error ?? "Impossible de lancer l'analyse");
    });

  const openTaskConclusion = (id: string) =>
    void openConclusion(id).then((res) => {
      if (!res.ok) toastError(res.error ?? "Impossible d'ouvrir la conclusion");
    });

  // Même patron que CalcView / GenView : copie best-effort + toast de
  // confirmation (ou d'échec, l'API clipboard pouvant refuser sans focus).
  const copyToClipboard = (text: string) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => false)
      .then((ok) =>
        push({
          icon: ok ? 'fa-solid fa-check' : 'fa-solid fa-triangle-exclamation',
          iconColor: ok ? '#34d399' : '#ef4444',
          name: 'Tâches',
          message: ok ? 'Tâche copiée' : 'Échec de la copie',
        }),
      );

  return (
    <div className="tasks-view" data-notch-hit="true">
      <div className="tasks-header">
        <div className="tasks-stats">
          <span className="ts-num">{active.length}</span>
          <span className="ts-label">
            {active.length === 1 ? 'active' : 'actives'}
          </span>
          {done.length > 0 && (
            <>
              <span className="ts-sep">·</span>
              <span className="ts-done">
                {done.length} terminée{done.length > 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>
        <div className="tasks-actions">
          {analysisEnabled && (analyzing || toAnalyze > 0) && (
            <button
              type="button"
              className="tasks-analyze"
              onClick={runAnalysis}
              disabled={analyzing}
              title={
                analyzing
                  ? 'Claude analyse les tâches…'
                  : `Faire analyser ${toAnalyze} tâche${toAnalyze > 1 ? 's' : ''} par Claude Code`
              }
            >
              <i
                className={
                  analyzing
                    ? 'fa-solid fa-spinner fa-spin'
                    : 'fa-solid fa-wand-magic-sparkles'
                }
              />
              {analyzing ? 'Analyse…' : `Analyser (${toAnalyze})`}
            </button>
          )}
          {done.length > 0 && (
            <button
              type="button"
              className="tasks-clear"
              onClick={() => void clearDone()}
            >
              <i className="fa-regular fa-trash-can" />
              Effacer terminées
            </button>
          )}
        </div>
      </div>

      <div className="tasks-hint">
        <i className="fa-solid fa-arrow-up" />
        Tapez une tâche dans la barre puis{' '}
        <span className="tk">Entrée</span> pour l'ajouter
      </div>

      {tasks.length === 0 ? (
        <div className="tasks-empty">
          <i className="fa-regular fa-square-check" />
          <div>Aucune tâche</div>
          <div className="te-sub">
            Commencez par taper après le « <code>-</code> »
          </div>
        </div>
      ) : (
        <div className="tasks-list">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={active.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {active.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  highlight={t.id === lastAddedId}
                  sortable={manual && active.length > 1}
                  analysisEnabled={analysisEnabled}
                  onOpenConclusion={openTaskConclusion}
                  onToggle={toggle}
                  onRemove={remove}
                  onUpdate={update}
                  onCopy={copyToClipboard}
                />
              ))}
            </SortableContext>
          </DndContext>
          {done.length > 0 && (
            <div className="tasks-divider">
              <span>Terminées</span>
              <span className="td-count">{done.length}</span>
            </div>
          )}
          {done.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              highlight={false}
              sortable={false}
              analysisEnabled={analysisEnabled}
              onOpenConclusion={openTaskConclusion}
              onToggle={toggle}
              onRemove={remove}
              onUpdate={update}
              onCopy={copyToClipboard}
            />
          ))}
        </div>
      )}
    </div>
  );
}
