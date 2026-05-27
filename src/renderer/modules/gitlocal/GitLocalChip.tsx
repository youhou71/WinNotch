/**
 * Chip Git local dans la collapsed row.
 *
 * Visible uniquement si au moins un repo est "dirty" (uncommitted > 0
 * OU ahead > 0). Le filtre `gitlocalEnabled` côté `CollapsedRow` garantit
 * déjà la condition, mais on garde une garde défensive ici aussi.
 *
 * Badge "dirty count" : nombre de repos ayant au moins un signal
 * "à pousser". Tooltip rich donne le détail repo par repo.
 */
import type { CSSProperties } from 'react';
import { useGitLocalContext } from './GitLocalContext';
import { NotchTooltip } from '../../components/Tooltip/NotchTooltip';

const GITLOCAL_ACCENT: CSSProperties = {
  '--tt-accent': '#f97316',
  '--tt-accent-fade': 'rgba(249, 115, 22, 0.18)',
} as CSSProperties;

export function GitLocalChip() {
  const { state } = useGitLocalContext();
  if (!state.configured) return null;
  const dirty = state.repos.filter((r) => r.isDirty);
  if (dirty.length === 0) return null;

  return (
    <NotchTooltip
      accentStyle={GITLOCAL_ACCENT}
      content={
        <div className="tt-body">
          <div className="tt-head">
            <i className="fa-solid fa-code-branch" />
            <span>git local — à pousser</span>
            <span className="tt-head-count">{dirty.length}</span>
          </div>
          <ul className="tt-list">
            {dirty.slice(0, 6).map((r) => (
              <li key={r.path} className="tt-row">
                <span className="tt-title">{r.name}</span>
                {r.branch && <span className="tt-sub">{r.branch}</span>}
                <div className="tt-meta">
                  {r.uncommitted > 0 && (
                    <span className="tt-meta-pill">
                      <i className="fa-solid fa-pen" />
                      {r.uncommitted} modif{r.uncommitted > 1 ? 's' : ''}
                    </span>
                  )}
                  {r.ahead > 0 && (
                    <span className="tt-meta-pill">
                      <i className="fa-solid fa-arrow-up" />
                      {r.ahead} ahead
                    </span>
                  )}
                  {r.behind > 0 && (
                    <span className="tt-meta-pill tt-meta-pill-warn">
                      <i className="fa-solid fa-arrow-down" />
                      {r.behind} behind
                    </span>
                  )}
                  {r.noUpstream && (
                    <span className="tt-meta-pill tt-meta-pill-dim">
                      sans upstream
                    </span>
                  )}
                </div>
              </li>
            ))}
            {dirty.length > 6 && (
              <li className="tt-sub">+ {dirty.length - 6} autres</li>
            )}
          </ul>
        </div>
      }
    >
      <div className="chip chip-gitlocal">
        <div className="logo-stack">
          <i className="fa-solid fa-code-branch gitlocal-glyph" />
          <span
            className="count-badge gitlocal-badge"
            aria-label={`${dirty.length} repo(s) à pousser`}
          >
            {dirty.length}
          </span>
        </div>
      </div>
    </NotchTooltip>
  );
}
