/**
 * Chip Claude Code dans la collapsed row.
 *
 * Reproduit `ClaudeChip` du prototype : `claude-spark` (conic gradient
 * animé) + badge count des sessions actives. Le badge utilise le
 * gradient violet/rose pour rester cohérent avec la signature du module.
 */
import { useClaudeContext } from './ClaudeContext';

export function ClaudeChip() {
  const { active, sessions } = useClaudeContext();
  if (active.length === 0) return null;

  // Une session est "en attente" tant que Claude a écrit un AskUserQuestion
  // sans tool_result derrière. On surcharge alors le badge avec un "?"
  // jaune visible immédiatement dans le notch collapsed.
  const waitingCount = sessions.filter((s) => s.waitingForInput).length;
  const tooltip =
    waitingCount > 0
      ? `${waitingCount} session(s) Claude en attente de réponse`
      : `${active.length} session(s) Claude active(s)`;

  return (
    <div className="chip chip-claude" title={tooltip}>
      <div className="logo-stack">
        <div className="claude-spark" />
        {waitingCount > 0 ? (
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
  );
}
