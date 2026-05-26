/**
 * Chip Git local dans la collapsed row.
 *
 * Visible uniquement si au moins un repo est "dirty" (uncommitted > 0
 * OU ahead > 0). Le filtre `gitlocalEnabled` côté `CollapsedRow` garantit
 * déjà la condition, mais on garde une garde défensive ici aussi.
 *
 * Badge orange "dirty count" : nombre de repos ayant au moins un signal
 * "à pousser". Tooltip donne le détail.
 */
import { useGitLocalContext } from './GitLocalContext';

export function GitLocalChip() {
  const { state } = useGitLocalContext();
  if (!state.configured) return null;
  const dirty = state.repos.filter((r) => r.isDirty);
  if (dirty.length === 0) return null;

  const totalUncommitted = dirty.reduce((sum, r) => sum + r.uncommitted, 0);
  const totalAhead = dirty.reduce((sum, r) => sum + r.ahead, 0);
  const tooltip = `${dirty.length} repo(s) à pousser · ${totalUncommitted} fichier(s) modifiés · ${totalAhead} commit(s) ahead`;

  return (
    <div className="chip chip-gitlocal" title={tooltip}>
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
  );
}
