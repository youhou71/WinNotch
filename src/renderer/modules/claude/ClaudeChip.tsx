/**
 * Chip Claude Code dans la collapsed row.
 *
 * Reproduit `ClaudeChip` du prototype : `claude-spark` (conic gradient
 * animé) + badge count des sessions actives. Le badge utilise le
 * gradient violet/rose pour rester cohérent avec la signature du module.
 */
import type { CSSProperties } from 'react';
import { useClaudeContext } from './ClaudeContext';
import { NotchTooltip } from '../../components/Tooltip/NotchTooltip';

const CLAUDE_ACCENT: CSSProperties = {
  '--tt-accent': '#a78bfa',
  '--tt-accent-fade': 'rgba(167, 139, 250, 0.18)',
} as CSSProperties;

export function ClaudeChip() {
  const { active, sessions } = useClaudeContext();
  if (active.length === 0) return null;

  // Une session est "en attente" tant que Claude a écrit un AskUserQuestion
  // sans tool_result derrière. On surcharge alors le badge avec un "?"
  // jaune visible immédiatement dans le notch collapsed.
  const waiting = sessions.filter((s) => s.waitingForInput);
  const working = active.filter((s) => !s.waitingForInput);

  return (
    <NotchTooltip
      accentStyle={CLAUDE_ACCENT}
      content={
        <div className="tt-body">
          <div className="tt-head">
            <i className="fa-solid fa-sparkles" />
            <span>claude code</span>
            <span className="tt-head-count">{active.length}</span>
          </div>
          <ul className="tt-list">
            {[...waiting, ...working].map((s) => (
              <li key={s.id} className="tt-row">
                <div className="tt-row-head">
                  <span className="tt-title">{s.project || 'Session'}</span>
                  {s.waitingForInput ? (
                    <span className="tt-meta-pill tt-meta-pill-warn">
                      <i className="fa-solid fa-circle-question" />
                      attend
                    </span>
                  ) : s.status === 'working' ? (
                    <span className="tt-meta-pill">
                      <i className="fa-solid fa-spinner" />
                      working
                    </span>
                  ) : null}
                </div>
                {s.branch && <span className="tt-sub">branche {s.branch}</span>}
                {s.currentText && <span className="tt-sub">{s.currentText}</span>}
              </li>
            ))}
          </ul>
        </div>
      }
    >
      <div className="chip chip-claude">
        <div className="logo-stack">
          <div className="claude-spark" />
          {waiting.length > 0 ? (
            <span
              className="count-badge claude-badge claude-badge-wfi"
              aria-label="En attente"
            >
              ?
            </span>
          ) : (
            <span className="count-badge claude-badge">{active.length}</span>
          )}
        </div>
      </div>
    </NotchTooltip>
  );
}
