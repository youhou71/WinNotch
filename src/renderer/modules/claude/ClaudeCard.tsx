/**
 * Card Claude Code du dashboard étendu.
 *
 * Reproduit `ClaudeCard` du prototype :
 *  - Header avec spark mini + label + count actifs/total
 *  - Tabs horizontaux scrollables : 1 par session (orb status + project + tokens)
 *  - Zone détaillée pour la session sélectionnée : meta (branch + elapsed),
 *    icône de statut (spin si working, hourglass si waiting, pause si idle),
 *    texte courant
 *
 * Cas vide : message "aucune session" + invite à lancer une.
 */
import { useEffect, useState } from 'react';
import type { ClaudeSession, ClaudeSessionStatus } from '../../../shared/types';
import { useClaudeContext } from './ClaudeContext';

function relativeAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.round(diff / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) {
    const r = sec % 60;
    return r > 0 ? `${min}m ${r}s` : `${min}m`;
  }
  const h = Math.floor(min / 60);
  return `${h}h`;
}

/**
 * Palette de couleurs cyclant pour distinguer visuellement chaque
 * session dans la liste. Calque les accents Notch (violet, rose,
 * jaune, bleu, vert). Index → couleur stable, pas de hash.
 */
const SESSION_PALETTE = [
  'var(--accent-violet)',
  'var(--accent-pink)',
  'var(--accent-warm)',
  'var(--accent)',
  'var(--accent-green)',
];

function sessionColor(index: number): string {
  return SESSION_PALETTE[index % SESSION_PALETTE.length];
}

function statusIcon(s: ClaudeSessionStatus) {
  switch (s) {
    case 'working':
      return (
        <i className="fa-solid fa-circle-notch fa-spin" />
      );
    case 'waiting':
      return (
        <i
          className="fa-solid fa-hourglass-half"
          style={{ color: 'var(--accent-warm)' }}
        />
      );
    case 'idle':
    case 'done':
    default:
      return <i className="fa-regular fa-circle-pause" />;
  }
}

interface SessionRowProps {
  session: ClaudeSession;
  color: string;
  selected: boolean;
  onClick: () => void;
}

/**
 * Une ligne de session dans la liste verticale. L'orb prend la couleur
 * propre à la session via `--sess-color` ; ses styles d'animation
 * (`status-working` pulse, `status-waiting` jaune, `status-idle` gris)
 * sont gérés en CSS.
 */
function SessionRow({ session, color, selected, onClick }: SessionRowProps) {
  return (
    <button
      type="button"
      className={'claude-sess' + (selected ? ' sel' : '')}
      onClick={onClick}
      style={{ ['--sess-color' as string]: color } as React.CSSProperties}
    >
      <span className={'sess-orb status-' + session.status} />
      <span className="sess-name">{session.project}</span>
      {session.waitingForInput && (
        <i
          className="fa-solid fa-circle-question sess-wfi"
          title="Claude attend une réponse"
          aria-label="En attente de réponse"
        />
      )}
      <span className="sess-tok">{(session.tokens / 1000).toFixed(1)}k</span>
    </button>
  );
}

export function ClaudeCard() {
  // Seules les sessions actives (working / waiting) intéressent l'utilisateur.
  // Les sessions idle/done n'apparaissent ni dans la liste ni dans le compteur.
  const { active } = useClaudeContext();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Sélection auto : 1ère session active si rien n'est sélectionné ou si la
  // sélection courante n'est plus active.
  useEffect(() => {
    if (active.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !active.find((s) => s.id === selectedId)) {
      setSelectedId(active[0].id);
    }
  }, [active, selectedId]);

  if (active.length === 0) {
    return (
      <div className="card card-claude" data-notch-hit="true">
        <div className="card-header">
          <div className="card-header-left">
            <div className="claude-spark" style={{ width: 14, height: 14, opacity: 0.4 }} />
            Claude Code
          </div>
          <div className="card-header-right">
            <span className="card-count">0 active</span>
          </div>
        </div>
        <div className="card-empty">
          <i className="fa-regular fa-circle-pause" />
          <div className="ce-text">
            <span className="ce-title">Aucune session active</span>
            <span className="ce-desc">
              Lance Claude Code dans un terminal — les sessions
              apparaîtront ici automatiquement.
            </span>
          </div>
        </div>
      </div>
    );
  }

  const session = active.find((s) => s.id === selectedId) ?? active[0];

  return (
    <div className="card card-claude" data-notch-hit="true">
      <div className="card-header">
        <div className="card-header-left">
          <div className="claude-spark" style={{ width: 14, height: 14 }} />
          Claude Code
        </div>
        <div className="card-header-right">
          <span className="card-count">
            {active.length} active{active.length > 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div className="claude-sessions">
        {active.map((s, i) => (
          <SessionRow
            key={s.id}
            session={s}
            color={sessionColor(i)}
            selected={s.id === session.id}
            onClick={() => setSelectedId(s.id)}
          />
        ))}
      </div>

      <div className="claude-detail">
        <div className="claude-detail-meta">
          {session.branch && (
            <>
              <span className="branch">
                <i className="fa-solid fa-code-branch" />
                {session.branch}
              </span>
              <span className="dot">·</span>
            </>
          )}
          <span className="elapsed">{relativeAge(session.lastActivity)}</span>
        </div>
        <div
          className={
            'claude-current-text' +
            (session.status === 'working' && !session.waitingForInput
              ? ' shimmer'
              : '') +
            (session.waitingForInput ? ' wfi' : '')
          }
        >
          {session.waitingForInput ? (
            <i
              className="fa-solid fa-circle-question"
              style={{ color: '#fbbf24' }}
            />
          ) : (
            statusIcon(session.status)
          )}
          <span>
            {session.waitingForInput
              ? 'Claude attend une réponse'
              : session.currentText ||
                (session.status === 'waiting'
                  ? 'En attente de votre saisie…'
                  : 'Pas de message récent.')}
          </span>
        </div>
      </div>
    </div>
  );
}
