/**
 * Vue plein dashboard du module Git local.
 *
 * Ouverte par clic sur `<GitLocalCard>` compacte. Reprend la place du
 * dashboard (comme `<SettingsView>` et `<GitLabPanel>`) et expose le
 * détail complet : un row par repo avec branche, badges
 * uncommitted/ahead/behind, et erreur le cas échéant.
 *
 * Clic sur une ligne → `window.notch.gitlocal.openRepo(path)` → détection
 * `.sln`/`.slnx` côté main → Visual Studio ou VS Code.
 *
 * Cas particuliers :
 *  - `!state.configured` : placeholder "configure les dossiers racines"
 *  - `state.lastError` : bandeau rouge
 *  - aucun repo trouvé : message vide
 */
import { useState } from 'react';
import type { GitLocalAction, GitLocalRepo } from '../../../shared/types';
import { useGitLocalContext } from './GitLocalContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { useMouseBackButton } from '../../hooks/useMouseBackButton';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useToast } from '../toast/ToastContext';

/**
 * Barre d'actions Git sûres (opt-in) sous une ligne de repo. Fetch est
 * immédiat (non destructif) ; Stash et « nouvelle branche » passent par une
 * mini-confirmation / saisie inline avant exécution.
 */
function RepoActions({ repo }: { repo: GitLocalRepo }) {
  const { push } = useToast();
  const [pending, setPending] = useState<GitLocalAction | null>(null);
  const [branchName, setBranchName] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (action: GitLocalAction, arg?: string) => {
    if (busy) return;
    setBusy(true);
    const res = await window.notch.gitlocal.action(repo.path, action, arg);
    setBusy(false);
    setPending(null);
    setBranchName('');
    push({
      icon: res.ok ? 'fa-solid fa-check' : 'fa-solid fa-triangle-exclamation',
      iconColor: res.ok ? '#34d399' : '#ef4444',
      name: repo.name,
      message: res.ok ? res.message ?? 'Action effectuée' : res.error ?? 'Échec',
    });
  };

  if (pending === 'stash') {
    return (
      <div className="gloc-actions gloc-actions-confirm">
        <span className="gloc-actions-q">
          Mettre de côté {repo.uncommitted} fichier{repo.uncommitted > 1 ? 's' : ''} ?
        </span>
        <button type="button" className="gloc-action-btn is-go" disabled={busy} onClick={() => void run('stash')}>
          {busy ? <i className="fa-solid fa-circle-notch fa-spin" /> : 'Stash'}
        </button>
        <button type="button" className="gloc-action-btn" onClick={() => setPending(null)}>
          Annuler
        </button>
      </div>
    );
  }

  if (pending === 'branch') {
    return (
      <div className="gloc-actions gloc-actions-confirm">
        <input
          className="gloc-branch-input"
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && branchName.trim()) void run('branch', branchName);
            else if (e.key === 'Escape') setPending(null);
          }}
          placeholder="nom-de-branche"
          spellCheck={false}
          autoComplete="off"
          autoFocus
        />
        <button
          type="button"
          className="gloc-action-btn is-go"
          disabled={busy || !branchName.trim()}
          onClick={() => void run('branch', branchName)}
        >
          {busy ? <i className="fa-solid fa-circle-notch fa-spin" /> : 'Créer'}
        </button>
        <button type="button" className="gloc-action-btn" onClick={() => setPending(null)}>
          Annuler
        </button>
      </div>
    );
  }

  return (
    <div className="gloc-actions">
      <button
        type="button"
        className="gloc-action-btn"
        disabled={busy}
        onClick={() => void run('fetch')}
        title="git fetch --prune"
      >
        {busy ? <i className="fa-solid fa-circle-notch fa-spin" /> : <i className="fa-solid fa-arrows-rotate" />}
        Fetch
      </button>
      {repo.uncommitted > 0 && (
        <button
          type="button"
          className="gloc-action-btn"
          onClick={() => setPending('stash')}
          title="git stash push -u (réversible)"
        >
          <i className="fa-solid fa-box-archive" />
          Stash
        </button>
      )}
      <button
        type="button"
        className="gloc-action-btn"
        onClick={() => setPending('branch')}
        title="git checkout -b <nom>"
      >
        <i className="fa-solid fa-code-branch" />
        Branche
      </button>
    </div>
  );
}

function RepoRow({
  repo,
  onOpen,
  actionsEnabled,
}: {
  repo: GitLocalRepo;
  onOpen: (path: string) => void;
  actionsEnabled: boolean;
}) {
  return (
    <div className={'gloc-repo-wrap' + (repo.isDirty ? ' is-dirty' : '')}>
      <button
        type="button"
        className={'gloc-repo' + (repo.isDirty ? ' is-dirty' : '')}
        onClick={() => onOpen(repo.path)}
        title={repo.path}
      >
        <div className="gloc-repo-main">
          <div className="gloc-repo-line">
            <span className="gloc-repo-name">{repo.name}</span>
            {repo.branch && (
              <span className="gloc-repo-branch">
                <i className="fa-solid fa-code-branch" />
                {repo.branch}
              </span>
            )}
            {repo.noUpstream && (
              <span className="gloc-badge gloc-badge-noup">no upstream</span>
            )}
          </div>
          <div className="gloc-repo-meta">
            {repo.error ? (
              <span className="gloc-badge gloc-badge-error">
                <i className="fa-solid fa-triangle-exclamation" />
                {repo.error}
              </span>
            ) : (
              <>
                {repo.uncommitted > 0 && (
                  <span className="gloc-badge gloc-badge-uncommitted">
                    +{repo.uncommitted}
                  </span>
                )}
                {repo.ahead > 0 && (
                  <span className="gloc-badge gloc-badge-ahead">
                    <i className="fa-solid fa-arrow-up" />
                    {repo.ahead}
                  </span>
                )}
                {repo.behind > 0 && (
                  <span className="gloc-badge gloc-badge-behind">
                    <i className="fa-solid fa-arrow-down" />
                    {repo.behind}
                  </span>
                )}
                {!repo.isDirty && repo.uncommitted === 0 && repo.ahead === 0 && (
                  <span className="gloc-repo-clean">clean</span>
                )}
              </>
            )}
          </div>
        </div>
        <i className="fa-solid fa-chevron-right gloc-repo-chevron" />
      </button>
      {actionsEnabled && !repo.error && <RepoActions repo={repo} />}
    </div>
  );
}

interface Props {
  onClose: () => void;
}

export function GitLocalPanel({ onClose }: Props) {
  const { state, refresh } = useGitLocalContext();
  const { settings } = useSettingsContext();
  const { push: pushToast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const actionsEnabled = settings.moduleConfig.gitlocal.actionsEnabled;

  useMouseBackButton(onClose);
  useEscapeKey(onClose);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  };

  const handleOpen = async (path: string) => {
    const res = await window.notch.gitlocal.openRepo(path);
    if (!res.ok) {
      pushToast({
        icon: 'fa-solid fa-triangle-exclamation',
        iconColor: '#ef4444',
        name: 'Git local',
        message: res.error ?? 'Impossible d’ouvrir le repo',
      });
    }
  };

  const dirtyRepos = state.repos.filter((r) => r.isDirty);
  const cleanRepos = state.repos.filter((r) => !r.isDirty && !r.error);
  const erroredRepos = state.repos.filter((r) => !!r.error);

  return (
    <div className="gitlocal-panel" data-notch-hit="true">
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
          style={{ background: '#f9731622', color: '#f97316' }}
        >
          <i className="fa-solid fa-code-branch" />
        </div>
        <div className="settings-header-title">
          Git local
          {state.configured ? (
            <span className="settings-header-sub">
              {state.repos.length} repo{state.repos.length > 1 ? 's' : ''}
              {dirtyRepos.length > 0 && ` · ${dirtyRepos.length} dirty`}
            </span>
          ) : (
            <span className="settings-header-sub">non configuré</span>
          )}
        </div>
        {state.configured && (
          <button
            type="button"
            className="gloc-refresh-btn"
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

      <div className="gitlocal-panel-body">
        {!state.configured && (
          <div className="card-empty">
            <i className="fa-solid fa-code-branch" />
            <div className="ce-text">
              <span className="ce-title">Configure les dossiers racines</span>
              <span className="ce-desc">
                Ouvre les paramètres (icône engrenage) → Git local → ajoute un
                ou plusieurs dossiers à scanner (ex. <code>C:\Projets</code>).
              </span>
            </div>
          </div>
        )}

        {state.configured && state.lastError && (
          <div className="gloc-error">
            <i className="fa-solid fa-triangle-exclamation" />
            <span>{state.lastError}</span>
          </div>
        )}

        {state.configured && !state.lastError && state.repos.length === 0 && (
          <div className="gloc-empty">
            Aucun dépôt Git trouvé dans les dossiers configurés. Vérifie la
            profondeur de scan dans les paramètres.
          </div>
        )}

        {dirtyRepos.length > 0 && (
          <>
            <div className="gloc-section-title gloc-section-dirty">
              <i className="fa-solid fa-code-branch" />
              À pousser
              <span className="gloc-count gloc-count-dirty">
                {dirtyRepos.length}
              </span>
            </div>
            <div className="gloc-list">
              {dirtyRepos.map((repo) => (
                <RepoRow
                  key={repo.path}
                  repo={repo}
                  onOpen={handleOpen}
                  actionsEnabled={actionsEnabled}
                />
              ))}
            </div>
          </>
        )}

        {cleanRepos.length > 0 && (
          <>
            <div className="gloc-section-title">
              À jour
              <span className="gloc-count">{cleanRepos.length}</span>
            </div>
            <div className="gloc-list">
              {cleanRepos.map((repo) => (
                <RepoRow
                  key={repo.path}
                  repo={repo}
                  onOpen={handleOpen}
                  actionsEnabled={actionsEnabled}
                />
              ))}
            </div>
          </>
        )}

        {erroredRepos.length > 0 && (
          <>
            <div className="gloc-section-title gloc-section-issues">
              <i className="fa-solid fa-triangle-exclamation" />
              Erreurs
              <span className="gloc-count gloc-count-dirty">
                {erroredRepos.length}
              </span>
            </div>
            <div className="gloc-list">
              {erroredRepos.map((repo) => (
                <RepoRow
                  key={repo.path}
                  repo={repo}
                  onOpen={handleOpen}
                  actionsEnabled={actionsEnabled}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
