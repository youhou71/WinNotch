/**
 * Vue tâches plein-dashboard rendue quand la search bar est en mode `-`.
 *
 * Reproduit le pattern `TasksView` du prototype (notch-tasks.jsx 6-69) :
 *  - Header : stats "N actives · M terminées" + bouton "Effacer terminées"
 *  - Hint bar verte avec flèche : rappel d'usage (taper puis Entrée)
 *  - Liste des actives, séparateur "TERMINÉES" avec compteur, puis done
 *  - Chaque row : checkbox cerclée (vide → pleine verte avec ✓) + texte
 *    (barré si done) + bouton ✕ révélé au hover
 *  - Animation flash sur la tâche fraîchement ajoutée (state.lastAddedId)
 *
 * État vide : icône + message + petit code stylé du préfixe `-`.
 */
import { useSettingsContext } from '../settings/SettingsContext';
import type { Task } from '../../../shared/types';

interface RowProps {
  task: Task;
  highlight: boolean;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}

function TaskRow({ task, highlight, onToggle, onRemove }: RowProps) {
  return (
    <div
      className={
        'task-row' +
        (task.done ? ' is-done' : '') +
        (highlight ? ' is-new' : '')
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
      <span className="task-text">{task.text}</span>
      <button
        type="button"
        className="task-remove"
        onClick={() => onRemove(task.id)}
        title="Supprimer"
        aria-label="Supprimer"
      >
        <i className="fa-solid fa-xmark" />
      </button>
    </div>
  );
}

export function TasksList() {
  const { settings, toggleTask, removeTask, clearDoneTasks, lastAddedId } =
    useSettingsContext();
  const tasks = settings.tasks;

  const active = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

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
            onClick={() => void clearDoneTasks()}
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
              onToggle={toggleTask}
              onRemove={removeTask}
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
              onToggle={toggleTask}
              onRemove={removeTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}
