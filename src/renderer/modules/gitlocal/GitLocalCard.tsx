/**
 * Card Git local du dashboard étendu.
 *
 * Même format visuel que `<TasksCounterCard>` : carré tinté, gros chiffre
 * 48 px centré, header avec icône + label, sub-line "X dirty / Y total".
 * Couleur signature orange (#f97316).
 *
 * Le clic ouvre la `<GitLocalPanel>` plein dashboard via `onOpen`. Le
 * rafraîchissement manuel est disponible dans le header du panel — on
 * garde la card visuellement épurée comme Tasks.
 */
import { useGitLocalContext } from './GitLocalContext';

interface Props {
  /** Appelé au clic — `ExpandedDashboard` ouvre alors `<GitLocalPanel>`. */
  onOpen: () => void;
}

export function GitLocalCard({ onOpen }: Props) {
  const { state } = useGitLocalContext();

  const dirtyCount = state.repos.filter((r) => r.isDirty).length;
  const totalCount = state.repos.length;

  return (
    <button
      type="button"
      className="gitlocal-counter-card"
      onClick={onOpen}
      data-notch-hit="true"
    >
      <div className="glc-head">
        <i className="fa-solid fa-code-branch" />
        <span className="glc-label">git local</span>
        {state.lastError && (
          <span
            className="glc-error-dot"
            title={state.lastError}
            aria-label={`Erreur : ${state.lastError}`}
          />
        )}
      </div>
      {/* key={dirtyCount} re-mount → rejoue l'animation pop CSS. */}
      <div className="glc-number" key={dirtyCount}>
        {dirtyCount}
      </div>
      <div className="glc-sub">
        {state.configured ? (
          <>
            {dirtyCount} dirty
            {totalCount > 0 && (
              <>
                {' '}
                <span className="glc-total">
                  / {totalCount} repo{totalCount > 1 ? 's' : ''}
                </span>
              </>
            )}
          </>
        ) : (
          'non configuré'
        )}
      </div>
    </button>
  );
}
