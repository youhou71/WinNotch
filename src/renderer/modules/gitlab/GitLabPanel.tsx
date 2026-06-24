/**
 * Vue plein dashboard du module GitLab.
 *
 * Ouverte par clic sur la `<GitLabCard>` compacte. Reprend la place du
 * dashboard (comme `<SettingsView>`) et expose le détail complet :
 *  - Header avec back, label, compte connecté, bouton refresh
 *  - Section "Issues à prendre" (issues non assignées matchant un
 *    `watchedLabels`)
 *  - Section "À reviewer" (MR où l'utilisateur courant est reviewer)
 *  - Section "Mes MR" (MR créées par l'utilisateur courant)
 *
 * Cas particuliers : `state.configured === false`, `state.lastError`,
 * listes vides — chacun a un placeholder dédié.
 *
 * Clic sur une ligne → `shell.openExternal(webUrl)` ouvre dans le
 * navigateur par défaut.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GitLabIssue, GitLabMr, GitLabMrDetail } from '../../../shared/types';
import { useGitLabContext } from './GitLabContext';
import { useMouseBackButton } from '../../hooks/useMouseBackButton';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { NotchTooltip } from '../../components/Tooltip/NotchTooltip';
import { pipelineMeta, fetchMrDetailCached } from './pipeline';

const GITLAB_TT_ACCENT: CSSProperties = {
  '--tt-accent': '#fc6d26',
  '--tt-accent-fade': 'rgba(252, 109, 38, 0.18)',
} as CSSProperties;

function relativeAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.round(diff / 1000));
  if (sec < 60) return `${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} j`;
}

function statusBadge(mr: GitLabMr) {
  if (mr.draft) return <span className="gl-badge gl-badge-draft">draft</span>;
  if (mr.hasConflicts)
    return <span className="gl-badge gl-badge-conflict">conflits</span>;
  return null;
}

function IssueRow({ issue }: { issue: GitLabIssue }) {
  return (
    <button
      type="button"
      className="gl-mr gl-issue"
      onClick={() => void window.notch.shell.openExternal(issue.webUrl)}
      title={issue.reference}
    >
      <div className="gl-mr-main">
        <span className="gl-mr-ref">{issue.reference}</span>
        <span className="gl-mr-title">{issue.title}</span>
      </div>
      <div className="gl-mr-meta">
        <span className="gl-mr-author">{issue.authorName}</span>
        <span className="dot">·</span>
        <span className="gl-mr-age">{relativeAge(issue.createdAt)}</span>
        <span className="gl-badge gl-badge-issue">{issue.matchedLabel}</span>
      </div>
    </button>
  );
}

/** Contenu du tooltip détail d'une MR (pipeline, jobs, threads, approbations). */
function MrTooltipContent({
  mr,
  loading,
  detail,
}: {
  mr: GitLabMr;
  loading: boolean;
  detail: GitLabMrDetail | null;
}) {
  const pm = pipelineMeta(detail?.pipelineStatus ?? mr.pipelineStatus);
  const threads = detail?.unresolvedThreads ?? 0;
  return (
    <div className="tt-body">
      <div className="tt-head">
        <i className="fa-brands fa-gitlab" />
        <span>{mr.reference}</span>
      </div>
      <div className="gl-tt-title">{mr.title}</div>
      {pm && (
        <div className="tt-sub" style={{ color: pm.color, fontWeight: 600 }}>
          <i className={'fa-solid ' + pm.icon} /> {pm.label}
        </div>
      )}
      {detail && !detail.error && (
        <div className="tt-meta">
          <span className="tt-meta-pill tt-meta-pill-dim">
            {threads} thread{threads > 1 ? 's' : ''} non résolu{threads > 1 ? 's' : ''}
          </span>
          {detail.approvalsRequired !== null && (
            <span className="tt-meta-pill tt-meta-pill-dim">
              {detail.approvalsLeft && detail.approvalsLeft > 0
                ? `${detail.approvalsLeft} approbation${detail.approvalsLeft > 1 ? 's' : ''} manquante${detail.approvalsLeft > 1 ? 's' : ''}`
                : 'approuvée'}
            </span>
          )}
        </div>
      )}
      {detail && detail.failedJobs.length > 0 && (
        <div className="tt-sub" style={{ color: '#f87171' }}>
          jobs : {detail.failedJobs.join(', ')}
        </div>
      )}
      {loading && !detail && (
        <div className="tt-sub">
          <i className="fa-solid fa-circle-notch fa-spin" /> chargement…
        </div>
      )}
      {detail?.error && (
        <div className="tt-sub" style={{ color: '#f87171' }}>
          détail indisponible
        </div>
      )}
    </div>
  );
}

function MrRow({ mr, showAuthor }: { mr: GitLabMr; showAuthor: boolean }) {
  const [detail, setDetail] = useState<GitLabMrDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Survol : fetch débouncé (250 ms) du détail, mémoïsé (TTL 60 s) → évite
  // les requêtes sur un simple passage de souris.
  const onEnter = () => {
    if (timer.current) clearTimeout(timer.current);
    if (!detail) setLoading(true);
    timer.current = setTimeout(() => {
      void fetchMrDetailCached(mr.projectId, mr.iid).then((d) => {
        setDetail(d);
        setLoading(false);
      });
    }, 250);
  };
  const onLeave = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const pm = pipelineMeta(mr.pipelineStatus);

  return (
    <NotchTooltip
      accentStyle={GITLAB_TT_ACCENT}
      content={<MrTooltipContent mr={mr} loading={loading} detail={detail} />}
    >
      <button
        type="button"
        className="gl-mr"
        onClick={() => void window.notch.shell.openExternal(mr.webUrl)}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        title={mr.reference}
      >
        <div className="gl-mr-main">
          <span className="gl-mr-ref">{mr.reference}</span>
          <span className="gl-mr-title">{mr.title}</span>
        </div>
        <div className="gl-mr-meta">
          {showAuthor && <span className="gl-mr-author">{mr.authorName}</span>}
          {showAuthor && <span className="dot">·</span>}
          <span className="gl-mr-age">{relativeAge(mr.updatedAt)}</span>
          {pm && (
            <i
              className={'fa-solid ' + pm.icon + ' gl-mr-pipe'}
              style={{ color: pm.color }}
              title={pm.label}
            />
          )}
          {statusBadge(mr)}
        </div>
      </button>
    </NotchTooltip>
  );
}

interface Props {
  onClose: () => void;
}

export function GitLabPanel({ onClose }: Props) {
  const { state, refresh } = useGitLabContext();
  const [refreshing, setRefreshing] = useState(false);

  // Bouton "Précédent" de la souris (XButton1) ET touche Esc → ferme le panel.
  useMouseBackButton(onClose);
  useEscapeKey(onClose);

  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    };
  }, []);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      // Min 400 ms pour le retour visuel du spinner. Capture le handle pour
      // pouvoir le clear si le composant se démonte avant l'expiration.
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = setTimeout(() => {
        setRefreshing(false);
        refreshTimeoutRef.current = null;
      }, 400);
    }
  };

  return (
    <div className="gitlab-panel" data-notch-hit="true">
      <div className="settings-header">
        <button
          type="button"
          className="settings-header-btn"
          onClick={onClose}
          aria-label="Retour"
          title="Retour"
        >
          <i className="fa-solid fa-chevron-left" />
        </button>
        <div
          className="settings-row-icon"
          style={{ background: '#FC6D2622', color: '#fc6d26' }}
        >
          <i className="fa-brands fa-gitlab" />
        </div>
        <div className="settings-header-title">
          GitLab
          {state.configured && state.user ? (
            <span className="settings-header-sub">@{state.user.username}</span>
          ) : (
            <span className="settings-header-sub">non configuré</span>
          )}
        </div>
        {state.configured && (
          <button
            type="button"
            className="gl-refresh-btn"
            onClick={() => void handleRefresh()}
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

      <div className="gitlab-panel-body">
        {!state.configured && (
          <div className="card-empty">
            <i className="fa-brands fa-gitlab" />
            <div className="ce-text">
              <span className="ce-title">Connecte ton compte</span>
              <span className="ce-desc">
                Ouvre les paramètres (icône engrenage) → GitLab → saisis l'URL
                de ton instance + un Personal Access Token (scope{' '}
                <code>read_api</code>).
              </span>
            </div>
          </div>
        )}

        {state.configured && state.lastError && (
          <div className="gl-error">
            <i className="fa-solid fa-triangle-exclamation" />
            <span>{state.lastError}</span>
          </div>
        )}

        {state.configured && state.watchedIssues.length > 0 && (
          <>
            <div
              className="gl-section-title gl-section-issues"
              title="Issues ouvertes correspondant à un label surveillé et non assignées."
            >
              <i className="fa-solid fa-circle-exclamation" />
              Issues à prendre
              <span className="gl-count gl-count-issues">
                {state.watchedIssues.length}
              </span>
            </div>
            <div className="gl-list">
              {state.watchedIssues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} />
              ))}
            </div>
          </>
        )}

        {state.configured && (
          <>
            <div className="gl-section-title">
              À reviewer
              <span className="gl-count">{state.toReview.length}</span>
            </div>
            {state.toReview.length === 0 ? (
              <div className="gl-empty">Rien en attente côté review.</div>
            ) : (
              <div className="gl-list">
                {state.toReview.map((mr) => (
                  <MrRow key={mr.id} mr={mr} showAuthor />
                ))}
              </div>
            )}

            <div className="gl-section-title">
              Mes MR
              <span className="gl-count">{state.mine.length}</span>
            </div>
            {state.mine.length === 0 ? (
              <div className="gl-empty">Aucune MR ouverte de ton côté.</div>
            ) : (
              <div className="gl-list">
                {state.mine.map((mr) => (
                  <MrRow key={mr.id} mr={mr} showAuthor={false} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
