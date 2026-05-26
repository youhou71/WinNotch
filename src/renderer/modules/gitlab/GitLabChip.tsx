/**
 * Chip GitLab dans la collapsed row.
 *
 * Priorité du badge (un seul à la fois pour rester lisible dans
 * un notch de 34 px de haut) :
 *
 *  1. **Issues à prendre** (rouge, urgent) — si > 0
 *  2. **MR à reviewer** (orange GitLab) — sinon, si > 0
 *  3. Pas de badge — sinon (mais on garde la chip visible si au moins
 *     une MR personnelle existe, signal passif "j'ai du WIP côté MR")
 *
 * La chip elle-même n'est rendue que si un des compteurs > 0 — gérée par
 * `gitlabEnabled` dans `CollapsedRow`, ne dépend pas de ce composant.
 *
 * Tooltip détaillé pour donner le contexte sans cliquer.
 */
import { useGitLabContext } from './GitLabContext';

export function GitLabChip() {
  const { state } = useGitLabContext();
  if (!state.configured) return null;

  const issuesCount = state.watchedIssues.length;
  const toReviewCount = state.toReview.length;
  const mineCount = state.mine.length;

  const tooltip = `${issuesCount} à prendre · ${toReviewCount} à reviewer · ${mineCount} à moi`;

  return (
    <div className="chip chip-gitlab" title={tooltip}>
      <div className="logo-stack">
        <i className="fa-brands fa-gitlab gitlab-glyph" />
        {issuesCount > 0 ? (
          <span
            className="count-badge gitlab-badge gitlab-badge-issues"
            aria-label={`${issuesCount} issue(s) à prendre`}
          >
            {issuesCount}
          </span>
        ) : toReviewCount > 0 ? (
          <span
            className="count-badge gitlab-badge"
            aria-label={`${toReviewCount} MR à reviewer`}
          >
            {toReviewCount}
          </span>
        ) : null}
      </div>
    </div>
  );
}
