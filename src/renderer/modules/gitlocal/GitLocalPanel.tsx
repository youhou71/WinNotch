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
import type { GitLocalRepo } from '../../../shared/types';
import { useGitLocalContext } from './GitLocalContext';
import { useMouseBackButton } from '../../hooks/useMouseBackButton';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useToast } from '../toast/ToastContext';

function RepoRow({
  repo,
  onOpen,
}: {
  repo: GitLocalRepo;
  onOpen: (path: string) => void;
}) {
  return (
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
  );
}

interface Props {
  onClose: () => void;
}

export function GitLocalPanel({ onClose }: Props) {
  const { state, refresh } = useGitLocalContext();
  const { push: pushToast } = useToast();
  const [refreshing, setRefreshing] = useState(false);

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
                <RepoRow key={repo.path} repo={repo} onOpen={handleOpen} />
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
                <RepoRow key={repo.path} repo={repo} onOpen={handleOpen} />
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
                <RepoRow key={repo.path} repo={repo} onOpen={handleOpen} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
