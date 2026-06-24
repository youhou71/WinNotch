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
 * Tooltip rich détaillant chaque pile (issues / MR à reviewer / MR
 * personnelles) — coup d'œil rapide sur le contexte sans cliquer.
 */
import type { CSSProperties } from 'react';
import { useGitLabContext } from './GitLabContext';
import { NotchTooltip } from '../../components/Tooltip/NotchTooltip';

const GITLAB_ACCENT: CSSProperties = {
  '--tt-accent': '#fc6d26',
  '--tt-accent-fade': 'rgba(252, 109, 38, 0.18)',
} as CSSProperties;

export function GitLabChip() {
  const { state } = useGitLabContext();
  if (!state.configured) return null;

  const issues = state.watchedIssues;
  const toReview = state.toReview;
  const mine = state.mine;
  // MR « mine » dont le pipeline a échoué — signal distinct des issues.
  const mineFailed = mine.filter((m) => m.pipelineStatus === 'failed');

  return (
    <NotchTooltip
      accentStyle={GITLAB_ACCENT}
      content={
        <div className="tt-body">
          <div className="tt-head">
            <i className="fa-brands fa-gitlab" />
            <span>gitlab</span>
          </div>

          {issues.length > 0 && (
            <>
              <div className="tt-sub" style={{ color: '#f87171', fontWeight: 600 }}>
                <i className="fa-solid fa-circle-exclamation" /> {issues.length} à prendre
              </div>
              <ul className="tt-list">
                {issues.slice(0, 3).map((i) => (
                  <li key={i.id} className="tt-row">
                    <span className="tt-title">{i.title}</span>
                    <span className="tt-sub">
                      {i.reference} · {i.matchedLabel}
                    </span>
                  </li>
                ))}
                {issues.length > 3 && (
                  <li className="tt-sub">+ {issues.length - 3} autres</li>
                )}
              </ul>
              {(toReview.length > 0 || mine.length > 0) && <div className="tt-divider" />}
            </>
          )}

          {toReview.length > 0 && (
            <>
              <div className="tt-sub" style={{ color: '#fc6d26', fontWeight: 600 }}>
                <i className="fa-solid fa-code-pull-request" /> {toReview.length} à reviewer
              </div>
              <ul className="tt-list">
                {toReview.slice(0, 3).map((m) => (
                  <li key={m.id} className="tt-row">
                    <span className="tt-title">{m.title}</span>
                    <span className="tt-sub">
                      {m.reference} · {m.authorName}
                    </span>
                  </li>
                ))}
                {toReview.length > 3 && (
                  <li className="tt-sub">+ {toReview.length - 3} autres</li>
                )}
              </ul>
              {mine.length > 0 && <div className="tt-divider" />}
            </>
          )}

          {mineFailed.length > 0 && (
            <>
              <div className="tt-sub" style={{ color: '#f87171', fontWeight: 600 }}>
                <i className="fa-solid fa-circle-xmark" /> {mineFailed.length} pipeline
                {mineFailed.length > 1 ? 's' : ''} cassé{mineFailed.length > 1 ? 's' : ''}
              </div>
              <ul className="tt-list">
                {mineFailed.slice(0, 3).map((m) => (
                  <li key={m.id} className="tt-row">
                    <span className="tt-title">{m.title}</span>
                    <span className="tt-sub">{m.reference}</span>
                  </li>
                ))}
              </ul>
              {mine.length > 0 && <div className="tt-divider" />}
            </>
          )}

          {mine.length > 0 && (
            <>
              <div className="tt-sub" style={{ fontWeight: 600 }}>
                <i className="fa-solid fa-user" /> {mine.length} MR à moi
              </div>
              <div className="tt-meta">
                {mine.slice(0, 3).map((m) => (
                  <span key={m.id} className="tt-meta-pill tt-meta-pill-dim">
                    {m.reference}
                  </span>
                ))}
                {mine.length > 3 && (
                  <span className="tt-meta-pill tt-meta-pill-dim">
                    +{mine.length - 3}
                  </span>
                )}
              </div>
            </>
          )}

          {issues.length === 0 && toReview.length === 0 && mine.length === 0 && (
            <div className="tt-empty">Aucun élément à traiter.</div>
          )}
        </div>
      }
    >
      <div className="chip chip-gitlab">
        <div className="logo-stack">
          <i className="fa-brands fa-gitlab gitlab-glyph" />
          {mineFailed.length > 0 && (
            <span
              className="gitlab-badge-pipeline"
              aria-label={`${mineFailed.length} pipeline(s) cassé(s) sur mes MR`}
              title={`${mineFailed.length} pipeline(s) cassé(s)`}
            />
          )}
          {issues.length > 0 ? (
            <span
              className="count-badge gitlab-badge gitlab-badge-issues"
              aria-label={`${issues.length} issue(s) à prendre`}
            >
              {issues.length}
            </span>
          ) : toReview.length > 0 ? (
            <span
              className="count-badge gitlab-badge"
              aria-label={`${toReview.length} MR à reviewer`}
            >
              {toReview.length}
            </span>
          ) : null}
        </div>
      </div>
    </NotchTooltip>
  );
}
