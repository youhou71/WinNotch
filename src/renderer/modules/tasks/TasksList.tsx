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
 *
 * État vide : icône + message + petit code stylé du préfixe `-`.
 */
import { useEffect, useRef, useState } from 'react';
import { useTasksContext } from './TasksContext';
import { useToast } from '../toast/ToastContext';
import type { Task } from '../../../shared/types';

interface RowProps {
  task: Task;
  highlight: boolean;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  onCopy: (text: string) => void;
}

function TaskRow({
  task,
  highlight,
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

  return (
    <div
      className={
        'task-row' +
        (task.done ? ' is-done' : '') +
        (highlight ? ' is-new' : '') +
        (editing ? ' is-editing' : '')
      }
    >
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
        <button
          type="button"
          className="task-text"
          onClick={startEdit}
          title="Cliquer pour modifier"
        >
          {task.text}
        </button>
      )}

      {!editing && (
        <>
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

export function TasksList() {
  const { tasks, lastAddedId, update, toggle, remove, clearDone } =
    useTasksContext();
  const { push } = useToast();

  const active = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

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
          {active.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              highlight={t.id === lastAddedId}
              onToggle={toggle}
              onRemove={remove}
              onUpdate={update}
              onCopy={copyToClipboard}
            />
          ))}
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
