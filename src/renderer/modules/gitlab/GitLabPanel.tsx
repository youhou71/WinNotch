/**
 * Vue plein dashboard du module GitLab.
 *
 * Ouverte par clic sur la `<GitLabCard>` compacte. Reprend la place du
 * dashboard (comme `<SettingsView>`) et expose le détail complet :
 *  - Header avec back, label, compte connecté, bouton refresh
 *  - Section "Issues à prendre" (issues non assignées matchant un
 *    `watchedLabels`)
 *  - Section "Mes issues" (work items ouverts qui lui sont assignés :
 *    issues, incidents, tâches, cas de test)
 *  - Section "À reviewer" (MR où l'utilisateur courant est reviewer)
 *  - Section "Mes MR" (MR créées par l'utilisateur courant)
 *
 * Les tickets d'abord, les MR ensuite — même ordre que les compteurs de
 * la card et que les interrupteurs des réglages.
 *
 * Chaque en-tête de section est pliable (clic sur le bandeau) et son état
 * est persisté dans `moduleConfig.gitlab.panelOpen` : il survit à la
 * fermeture du panel comme au redémarrage. Plier ne change **rien** au
 * polling — le compteur de l'en-tête reste à jour, contrairement à une
 * section décochée dans les réglages qui n'est plus interrogée du tout.
 *
 * À droite de chaque en-tête, une icône ouvre la page GitLab équivalente
 * (cf. `links.ts`), filtrée comme la section.
 *
 * Cas particuliers : `state.configured === false`, `state.lastError`,
 * listes vides — chacun a un placeholder dédié.
 *
 * Clic sur une ligne → `shell.openExternal(webUrl)` ouvre dans le
 * navigateur par défaut.
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import type {
  GitLabIssue,
  GitLabMr,
  GitLabMrDetail,
  GitLabWorkItem,
} from '../../../shared/types';
import { useGitLabContext } from './GitLabContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { useMouseBackButton } from '../../hooks/useMouseBackButton';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { NotchTooltip } from '../../components/Tooltip/NotchTooltip';
import { pipelineMeta, fetchMrDetailCached } from './pipeline';
import { sectionUrl, type GitLabSectionKey } from './links';

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

/**
 * Icône + couleur par type de work item. `issue` est le défaut : les
 * instances antérieures à GitLab 13 ne renvoient pas `issue_type`, et le
 * client normalise alors vers cette valeur.
 */
const WORK_ITEM_TYPES: Record<string, { icon: string; color: string; label: string }> = {
  issue: { icon: 'fa-regular fa-circle-dot', color: '#94a3b8', label: 'issue' },
  incident: { icon: 'fa-solid fa-fire', color: '#ef4444', label: 'incident' },
  task: { icon: 'fa-solid fa-list-check', color: '#60a5fa', label: 'tâche' },
  test_case: { icon: 'fa-solid fa-vial', color: '#a78bfa', label: 'cas de test' },
};

const DUE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
});

/**
 * Formate une échéance `yyyy-mm-dd` et dit si elle est dépassée.
 *
 * La comparaison se fait à la journée (minuit local) : une échéance
 * fixée à aujourd'hui n'est pas « en retard ».
 */
function dueMeta(dueDate: string): { text: string; late: boolean } | null {
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { text: DUE_FORMAT.format(due), late: due.getTime() < today.getTime() };
}

function WorkItemRow({ item }: { item: GitLabWorkItem }) {
  const type = WORK_ITEM_TYPES[item.issueType] ?? WORK_ITEM_TYPES.issue;
  const due = item.dueDate ? dueMeta(item.dueDate) : null;
  return (
    <button
      type="button"
      className="gl-mr gl-work-item"
      onClick={() => void window.notch.shell.openExternal(item.webUrl)}
      title={`${item.reference} · ${type.label}`}
    >
      <div className="gl-mr-main">
        {/* `.gl-mr-main` empile ref puis titre : l'icône de type doit donc
            partager une ligne avec la référence, pas s'insérer au-dessus. */}
        <div className="gl-wi-head">
          <i
            className={type.icon + ' gl-wi-type'}
            style={{ color: type.color }}
            aria-hidden="true"
          />
          <span className="gl-mr-ref">{item.reference}</span>
        </div>
        <span className="gl-mr-title">{item.title}</span>
      </div>
      <div className="gl-mr-meta">
        <span className="gl-mr-age">{relativeAge(item.updatedAt)}</span>
        {item.milestoneTitle && (
          <span className="gl-badge gl-badge-milestone">
            {item.milestoneTitle}
          </span>
        )}
        {due && (
          <span
            className={'gl-badge gl-badge-due' + (due.late ? ' is-late' : '')}
            title={due.late ? 'Échéance dépassée' : 'Échéance'}
          >
            <i className="fa-regular fa-calendar" /> {due.text}
          </span>
        )}
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

/**
 * En-tête pliable d'une section, avec son compteur et son lien GitLab.
 *
 * Tout le bandeau est le bouton de pliage ; le lien est un second bouton,
 * **frère** dans le DOM et non imbriqué (un `<button>` dans un `<button>`
 * est invalide, Chromium le sort du parent au parsing). D'où le conteneur
 * `<div class="gl-section-title">` qui porte les styles de texte communs.
 */
function SectionHeader({
  label,
  count,
  open,
  onToggle,
  url,
  linkTitle,
  tooltip,
  icon,
  danger,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  /** `null` = instance non configurée ou compte inconnu → pas de lien. */
  url: string | null;
  linkTitle: string;
  tooltip?: string;
  icon?: string;
  /** Palette rouge de la section « issues à prendre ». */
  danger?: boolean;
}) {
  // `stopPropagation` : les deux boutons sont frères, le clic ne remonte
  // donc pas au pliage — garde-fou si l'un venait à englober l'autre.
  const openInGitLab = (e: MouseEvent) => {
    e.stopPropagation();
    if (url) void window.notch.shell.openExternal(url);
  };
  return (
    <div className={'gl-section-title' + (danger ? ' gl-section-issues' : '')}>
      <button
        type="button"
        className="gl-section-toggle"
        onClick={onToggle}
        aria-expanded={open}
        // Le libellé de l'action de pliage est toujours présent, même quand
        // la section a une description : sans lui, rien n'indique que le
        // bandeau est cliquable.
        title={[tooltip, open ? 'Clic : replier' : 'Clic : déplier']
          .filter(Boolean)
          .join(' · ')}
      >
        <i
          className={
            'fa-solid fa-chevron-down gl-section-chev' + (open ? '' : ' is-closed')
          }
          aria-hidden="true"
        />
        {icon && <i className={icon + ' gl-section-icon'} aria-hidden="true" />}
        <span className="gl-section-label">{label}</span>
        <span className={'gl-count' + (danger ? ' gl-count-issues' : '')}>
          {count}
        </span>
      </button>
      {url && (
        <button
          type="button"
          className="gl-section-link"
          onClick={openInGitLab}
          title={linkTitle}
          aria-label={linkTitle}
        >
          <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

interface Props {
  onClose: () => void;
}

export function GitLabPanel({ onClose }: Props) {
  const { state, refresh } = useGitLabContext();
  const { settings, patchModuleConfig } = useSettingsContext();
  const cfg = settings.moduleConfig.gitlab;
  const sections = cfg.sections;
  const anySection =
    sections.watchedIssues ||
    sections.toReview ||
    sections.mine ||
    sections.myWorkItems;
  const [refreshing, setRefreshing] = useState(false);

  // Résolution défensive : une config écrite par une version antérieure à
  // `panelOpen` n'a pas la clé (le normalize du main la complète au
  // démarrage, mais un patch partiel entre-temps resterait incomplet).
  // Absent ⇒ déplié.
  const open: Record<GitLabSectionKey, boolean> = {
    watchedIssues: cfg.panelOpen?.watchedIssues !== false,
    myWorkItems: cfg.panelOpen?.myWorkItems !== false,
    toReview: cfg.panelOpen?.toReview !== false,
    mine: cfg.panelOpen?.mine !== false,
  };

  // `patchModuleConfig` applique un update optimiste : le pli est immédiat,
  // l'écriture disque suit.
  const toggle = (key: GitLabSectionKey) => {
    void patchModuleConfig('gitlab', {
      panelOpen: { ...open, [key]: !open[key] },
    });
  };

  const linkFor = (key: GitLabSectionKey) =>
    sectionUrl(key, {
      instanceUrl: cfg.url,
      username: state.user?.username ?? null,
      linkGroup: cfg.linkGroup ?? '',
      watchedLabels: cfg.watchedLabels,
    });

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

        {state.configured && !anySection && (
          <div className="gl-empty">
            Aucune section suivie — choisis ce que tu veux voir dans Réglages
            → GitLab → « Ce qui est suivi ».
          </div>
        )}

        {state.configured &&
          sections.watchedIssues &&
          state.watchedIssues.length > 0 && (
          <>
            <SectionHeader
              label="Issues à prendre"
              icon="fa-solid fa-circle-exclamation"
              danger
              count={state.watchedIssues.length}
              open={open.watchedIssues}
              onToggle={() => toggle('watchedIssues')}
              url={linkFor('watchedIssues')}
              linkTitle="Ouvrir les issues sans assigné dans GitLab"
              tooltip="Issues ouvertes correspondant à un label surveillé et non assignées."
            />
            {open.watchedIssues && (
              <div className="gl-list">
                {state.watchedIssues.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} />
                ))}
              </div>
            )}
          </>
        )}

        {state.configured && sections.myWorkItems && (
          <>
            <SectionHeader
              label="Mes issues"
              count={state.myWorkItems.length}
              open={open.myWorkItems}
              onToggle={() => toggle('myWorkItems')}
              url={linkFor('myWorkItems')}
              linkTitle="Ouvrir mes issues assignées dans GitLab"
              tooltip="Issues, incidents, tâches et cas de test ouverts qui te sont assignés."
            />
            {open.myWorkItems &&
              (state.myWorkItems.length === 0 ? (
                <div className="gl-empty">Rien ne t'est assigné.</div>
              ) : (
                <div className="gl-list">
                  {state.myWorkItems.map((item) => (
                    <WorkItemRow key={item.id} item={item} />
                  ))}
                </div>
              ))}
          </>
        )}

        {state.configured && sections.toReview && (
          <>
            <SectionHeader
              label="À reviewer"
              count={state.toReview.length}
              open={open.toReview}
              onToggle={() => toggle('toReview')}
              url={linkFor('toReview')}
              linkTitle="Ouvrir les MR où je suis reviewer dans GitLab"
            />
            {open.toReview &&
              (state.toReview.length === 0 ? (
                <div className="gl-empty">Rien en attente côté review.</div>
              ) : (
                <div className="gl-list">
                  {state.toReview.map((mr) => (
                    <MrRow key={mr.id} mr={mr} showAuthor />
                  ))}
                </div>
              ))}
          </>
        )}

        {state.configured && sections.mine && (
          <>
            <SectionHeader
              label="Mes MR"
              count={state.mine.length}
              open={open.mine}
              onToggle={() => toggle('mine')}
              url={linkFor('mine')}
              linkTitle="Ouvrir mes MR dans GitLab"
            />
            {open.mine &&
              (state.mine.length === 0 ? (
                <div className="gl-empty">Aucune MR ouverte de ton côté.</div>
              ) : (
                <div className="gl-list">
                  {state.mine.map((mr) => (
                    <MrRow key={mr.id} mr={mr} showAuthor={false} />
                  ))}
                </div>
              ))}
          </>
        )}
      </div>
    </div>
  );
}
