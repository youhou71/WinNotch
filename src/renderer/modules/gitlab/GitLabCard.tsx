/**
 * Card GitLab compacte du dashboard étendu.
 *
 * Jusqu'à quatre compteurs cliquables : Issues à prendre / À reviewer /
 * Mes MR / work items qui me sont assignés. Chacun n'apparaît que si sa
 * section est suivie (`moduleConfig.gitlab.sections`), et la grille
 * s'ajuste au nombre restant.
 * Le clic sur la card ouvre la `<GitLabPanel>` plein dashboard via
 * `onOpen` géré par `ExpandedDashboard`.
 *
 * Cas particuliers :
 *  - `configured === false` : affiche un placeholder d'invite à connecter,
 *    mais le clic reste actif pour permettre d'ouvrir le panel (qui
 *    affichera l'invite avec plus de détails).
 *  - `lastError` non null : pastille rouge dans le coin haut droite pour
 *    signaler discrètement le problème ; le détail est dans le panel.
 *
 * `key={count}` sur chaque chiffre déclenche l'animation pop CSS à chaque
 * changement (même technique que `<TasksCounterCard>`).
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useGitLabContext } from './GitLabContext';
import { useSettingsContext } from '../settings/SettingsContext';

interface Props {
  /** Appelé au clic — `ExpandedDashboard` ouvre alors `<GitLabPanel>`. */
  onOpen: () => void;
}

interface StatProps {
  icon: string;
  iconColor: string;
  count: number;
  label: string;
  /** Quand true, le compteur s'affiche en rouge pour attirer l'œil. */
  alert?: boolean;
}

function Stat({ icon, iconColor, count, label, alert }: StatProps) {
  return (
    <div className={'gl-stat' + (alert && count > 0 ? ' alert' : '')}>
      <div className="gl-stat-icon" style={{ color: iconColor }}>
        <i className={icon} />
      </div>
      <div className="gl-stat-number" key={count}>
        {count}
      </div>
      <div className="gl-stat-label">{label}</div>
    </div>
  );
}

export function GitLabCard({ onOpen }: Props) {
  const { state, refresh } = useGitLabContext();
  const { settings } = useSettingsContext();
  const sections = settings.moduleConfig.gitlab.sections;
  // Le nombre de compteurs affichés pilote la grille : `data-count` sert
  // aux paliers responsive, la variable CSS au nombre de colonnes.
  const statCount = [
    sections.watchedIssues,
    sections.toReview,
    sections.mine,
    sections.myWorkItems,
  ].filter(Boolean).length;
  const [refreshing, setRefreshing] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      // Min 400 ms pour le retour visuel du spinner. Capture le handle pour
      // pouvoir le clear si le composant se démonte avant l'expiration
      // (sinon warning React + setState sur un node mort).
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setRefreshing(false);
        timeoutRef.current = null;
      }, 400);
    }
  };

  // La card est un `<div role="button">` plutôt qu'un `<button>` pour
  // pouvoir y imbriquer un vrai bouton refresh (nested buttons = HTML
  // invalide). Clavier : Enter/Space ouvre le panel comme un bouton.
  return (
    <div
      role="button"
      tabIndex={0}
      className="card card-gitlab card-gitlab-compact"
      data-notch-hit="true"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="card-header">
        <div className="card-header-left">
          <i
            className="fa-brands fa-gitlab gitlab-glyph"
            style={{ fontSize: 16 }}
          />
          GitLab
        </div>
        <div className="card-header-right">
          {state.lastError && (
            <span
              className="gl-error-dot"
              title={state.lastError}
              aria-label={`Erreur : ${state.lastError}`}
            />
          )}
          {state.configured && state.user ? (
            <span className="card-count">@{state.user.username}</span>
          ) : (
            <span className="card-count">non configuré</span>
          )}
          {state.configured && (
            <button
              type="button"
              className="gl-refresh-btn"
              onClick={(e) => {
                // stopPropagation : sinon le clic remonte au div parent
                // et ouvrirait le panel en plus du refresh.
                e.stopPropagation();
                void handleRefresh();
              }}
              disabled={refreshing}
              title="Rafraîchir maintenant"
              aria-label="Rafraîchir"
            >
              <i
                className={
                  'fa-solid fa-arrows-rotate' + (refreshing ? ' fa-spin' : '')
                }
              />
            </button>
          )}
        </div>
      </div>

      {statCount === 0 ? (
        <div className="gl-stats-empty">
          Aucune section suivie — voir Réglages → GitLab.
        </div>
      ) : (
        <div
          className="gl-stats"
          data-count={statCount}
          style={{ '--gl-stat-count': statCount } as CSSProperties}
        >
          {sections.watchedIssues && (
            <Stat
              icon="fa-solid fa-circle-exclamation"
              iconColor="#ef4444"
              count={state.watchedIssues.length}
              label="à prendre"
              alert
            />
          )}
          {sections.toReview && (
            <Stat
              icon="fa-solid fa-code-merge"
              iconColor="#fc6d26"
              count={state.toReview.length}
              label="à reviewer"
            />
          )}
          {sections.mine && (
            <Stat
              icon="fa-solid fa-code-pull-request"
              iconColor="#94a3b8"
              count={state.mine.length}
              label="mes MR"
            />
          )}
          {sections.myWorkItems && (
            <Stat
              icon="fa-regular fa-circle-dot"
              iconColor="#60a5fa"
              count={state.myWorkItems.length}
              label="assignés"
            />
          )}
        </div>
      )}
    </div>
  );
}
