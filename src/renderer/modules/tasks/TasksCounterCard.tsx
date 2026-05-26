/**
 * Card "Tasks counter" du dashboard étendu.
 *
 * Reproduit le pattern `task-counter-card` du prototype (Notch.html
 * 523-577) : carré tinté vert, gros chiffre 48 px avec animation pop
 * sur changement, sous-label "X actives · / Y total".
 *
 * Cliquer sur la card pré-remplit la search bar avec `-` pour basculer
 * en mode ajout de tâche.
 */
import { useSettingsContext } from '../settings/SettingsContext';

interface Props {
  /** Pré-remplit la search bar avec un préfixe (ex. "-" pour activer le mode tâche). */
  onOpen?: () => void;
}

export function TasksCounterCard({ onOpen }: Props) {
  const { settings } = useSettingsContext();
  const active = settings.tasks.filter((t) => !t.done).length;
  const total = settings.tasks.length;

  return (
    <button
      type="button"
      className="task-counter-card"
      onClick={onOpen}
      data-notch-hit="true"
    >
      <div className="tcc-head">
        <i className="fa-solid fa-list-check" />
        <span className="tcc-label">tâches</span>
      </div>
      {/* key={active} fait re-monter le numéro à chaque changement →
          déclenche l'animation pop CSS sans logique supplémentaire. */}
      <div className="tcc-number" key={active}>
        {active}
      </div>
      <div className="tcc-sub">
        {active} active{active > 1 ? 's' : ''}
        {total > 0 && (
          <>
            {' '}
            <span className="tcc-total">/ {total} total</span>
          </>
        )}
      </div>
    </button>
  );
}
