/**
 * Contenu du notch en état étendu.
 *
 * Layout :
 *   ┌─────────────────────────────────────┐
 *   │ <NotchSearch/> (sticky top)        │  ← search bar + détection préfixe
 *   │ [<DndBanner/> si dnd, hors search]  │
 *   │ [<SettingsView/> si gear actif]     │  ← prend la place du dashboard
 *   │ [<TasksList/> si mode `-`]          │
 *   │ Vue par défaut (cards + placeholder)│
 *   ├─────────────────────────────────────┤
 *   │ <AudioFooter/>                      │  ← sticky bottom (toujours visible)
 *   └─────────────────────────────────────┘
 *
 * Priorités de rendu (mutually exclusive) :
 *   1. inSearch (préfixe détecté) → cache la SettingsView automatiquement
 *   2. settingsOpen → SettingsView
 *   3. défaut → cards modules + placeholder
 *
 * Les modules sont rendus uniquement si activés dans `settings.modules`.
 */
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import { AudioFooter } from '../../modules/audio/AudioFooter';
import { MusicCard } from '../../modules/music/MusicCard';
import { useMusicContext } from '../../modules/music/MusicContext';
import { useSettingsContext } from '../../modules/settings/SettingsContext';
import { useSearchContext } from '../../modules/search/SearchContext';
import { TasksCounterCard } from '../../modules/tasks/TasksCounterCard';
import { TasksList } from '../../modules/tasks/TasksList';
import { MeetingsCard } from '../../modules/meetings/MeetingsCard';
import { ClaudeCard } from '../../modules/claude/ClaudeCard';
import { useClaudeContext } from '../../modules/claude/ClaudeContext';
import { ClaudeUsageCard } from '../../modules/claudeUsage/ClaudeUsageCard';
import { GitLabCard } from '../../modules/gitlab/GitLabCard';
import { GitLocalCard } from '../../modules/gitlocal/GitLocalCard';
import { GitLocalPanel } from '../../modules/gitlocal/GitLocalPanel';
import { VpnCard } from '../../modules/vpn/VpnCard';
import { TeamsCard } from '../../modules/teams/TeamsCard';
import { SystemCard } from '../../modules/system/SystemCard';
import { ClipboardDetectionView } from '../../modules/clipboard/ClipboardDetectionView';
import { useClipboardContext } from '../../modules/clipboard/ClipboardContext';
import { NotchSearch } from '../../modules/search/NotchSearch';
import { detectMode } from '../../modules/search/detectMode';
import { SearchHelp } from '../../modules/search/SearchHelp';
import { useMouseBackButton } from '../../hooks/useMouseBackButton';
import { useEscapeKey } from '../../hooks/useEscapeKey';

// Lazy-load des 3 pages plein dashboard (chargées à la 1ère ouverture
// seulement). Économise ~150 KB de JS au boot du renderer et réduit le
// heap au repos quand l'utilisateur n'a jamais ouvert ces overlays.
// `React.lazy` requiert un default export → on remappe le named export.
const SettingsView = lazy(() =>
  import('../../modules/settings/SettingsView').then((m) => ({
    default: m.SettingsView,
  })),
);
const GitLabPanel = lazy(() =>
  import('../../modules/gitlab/GitLabPanel').then((m) => ({
    default: m.GitLabPanel,
  })),
);
const ClipboardPage = lazy(() =>
  import('../../modules/clipboard/ClipboardPage').then((m) => ({
    default: m.ClipboardPage,
  })),
);

/**
 * Placeholder discret affiché pendant le fetch+parse d'un chunk lazy.
 * Volontairement minimal : l'utilisateur ouvre une page connue, le notch
 * est déjà étendu, on évite un saut visuel trop violent.
 */
function DashboardLoader() {
  return (
    <div className="dashboard-loader" data-notch-hit="true">
      <i className="fa-solid fa-circle-notch fa-spin" />
    </div>
  );
}

interface Props {
  /** Appelé après une action de search réussie (rétracte le notch). */
  onSearchAction?: () => void;
}

export function ExpandedDashboard({ onSearchAction }: Props) {
  const { state: music } = useMusicContext();
  const { active: claudeActive } = useClaudeContext();
  const { settings, toggleDnd } = useSettingsContext();
  const { query, setQuery } = useSearchContext();
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * Overlay GitLab plein dashboard. Ouvert par clic sur la GitLabCard
   * compacte, fermé par le bouton back du panel. Mutuellement exclusif
   * avec Settings et avec le mode search (les préfixes search reprennent
   * la priorité, comme pour Settings).
   */
  const [gitlabPanelOpen, setGitlabPanelOpen] = useState(false);
  /**
   * Overlay Git local plein dashboard. Mêmes règles que GitLab : ouvert
   * par clic sur la `GitLocalCard`, fermé par bouton back / Esc / XButton1.
   */
  const [gitlocalPanelOpen, setGitlocalPanelOpen] = useState(false);
  /**
   * État de la page Clipboard — vit dans le Context pour survivre aux
   * démontages d'ExpandedDashboard (chaque collapse/expand du notch).
   * Le reset au passage en collapsed est géré par AppInner.
   */
  const {
    pageOpen: clipboardOpen,
    closePage: closeClipboard,
    togglePage: toggleClipboard,
  } = useClipboardContext();

  const hasMusic = !!music.title;
  // Card masquée s'il n'y a aucune session active — les sessions
  // idle/done n'intéressent pas l'utilisateur (cf. ClaudeCard). Le toggle
  // `moduleConfig['claude.live'].showCard` permet aussi de la masquer en gardant
  // les toasts (mode "notifications seulement").
  const hasClaude =
    claudeActive.length > 0 && settings.moduleConfig['claude.live'].showCard;
  const detected = detectMode(query);
  const inSearch = !!detected;
  const inTaskMode = detected?.mode === 'task';
  const inHelpMode = detected?.mode === 'help';
  // Mode "détection live" (URL/JSON/JWT/color/path tapé dans la search bar).
  // Le pipeline shared remplit `detection` dans ces cas, et on rend la
  // vue plein dashboard correspondante à la place du dashboard normal.
  const inDetectionMode = !!detected?.detection;

  // Si l'utilisateur tape un préfixe pendant qu'un overlay est ouvert,
  // on le ferme pour laisser la place aux résultats de la search.
  useEffect(() => {
    if (inSearch) {
      if (settingsOpen) setSettingsOpen(false);
      if (gitlabPanelOpen) setGitlabPanelOpen(false);
      if (gitlocalPanelOpen) setGitlocalPanelOpen(false);
      if (clipboardOpen) closeClipboard();
    }
  }, [
    inSearch,
    settingsOpen,
    gitlabPanelOpen,
    gitlocalPanelOpen,
    clipboardOpen,
    closeClipboard,
  ]);

  // Mutex entre les overlays : Settings / GitLab panel / Git local panel / Clipboard.
  // En ouvrir un ferme automatiquement les autres.
  useEffect(() => {
    if (settingsOpen) {
      if (gitlabPanelOpen) setGitlabPanelOpen(false);
      if (gitlocalPanelOpen) setGitlocalPanelOpen(false);
      if (clipboardOpen) closeClipboard();
    }
  }, [
    settingsOpen,
    gitlabPanelOpen,
    gitlocalPanelOpen,
    clipboardOpen,
    closeClipboard,
  ]);
  useEffect(() => {
    if (clipboardOpen) {
      if (settingsOpen) setSettingsOpen(false);
      if (gitlabPanelOpen) setGitlabPanelOpen(false);
      if (gitlocalPanelOpen) setGitlocalPanelOpen(false);
    }
  }, [clipboardOpen, settingsOpen, gitlabPanelOpen, gitlocalPanelOpen]);
  useEffect(() => {
    if (gitlocalPanelOpen) {
      if (settingsOpen) setSettingsOpen(false);
      if (gitlabPanelOpen) setGitlabPanelOpen(false);
      if (clipboardOpen) closeClipboard();
    }
  }, [
    gitlocalPanelOpen,
    settingsOpen,
    gitlabPanelOpen,
    clipboardOpen,
    closeClipboard,
  ]);

  // Bouton "Précédent" de la souris (XButton1) en mode recherche :
  //  - vide la query → sort du mode task / claude / vscode / visualstudio
  //    et restaure le dashboard normal.
  // Les autres "sous-pages" (GitLabPanel, SettingsView) gèrent leur
  // propre back via leur hook respectif — les états sont exclusifs
  // donc un seul handler est attaché au document à un instant T.
  const clearSearch = useCallback(() => setQuery(''), []);
  useMouseBackButton(inSearch ? clearSearch : null);

  /**
   * Touche Esc — comportement unifié avec le bouton souris :
   *  1. Un overlay enfant est monté (Settings / GitLabPanel) → on n'attache
   *     PAS de handler ici, l'enfant gère lui-même. Sinon `useEscapeKey`
   *     du parent serait appelé EN PREMIER (ordre d'ajout des listeners
   *     en capture phase, parent monté avant enfant) et ferait l'inverse.
   *  2. Mode recherche → vide la query, retour au dashboard normal.
   *  3. Dashboard normal → collapse le notch (cohérent avec l'ancien
   *     comportement de `useKeyboardShortcuts`).
   */
  const handleEscape = useMemo(() => {
    // Les overlays enfants (Settings, GitLab panel, Git local panel,
    // Clipboard page) gèrent leur propre back via useMouseBackButton +
    // useEscapeKey internes. Le parent doit rester silencieux pendant
    // qu'ils sont montés — sinon double-déclenchement (parent attaché en
    // premier en capture).
    if (settingsOpen || gitlabPanelOpen || gitlocalPanelOpen || clipboardOpen)
      return null;
    if (inSearch) return clearSearch;
    return onSearchAction ?? null;
  }, [
    settingsOpen,
    gitlabPanelOpen,
    gitlocalPanelOpen,
    clipboardOpen,
    inSearch,
    clearSearch,
    onSearchAction,
  ]);
  useEscapeKey(handleEscape);

  // Toggles des modules — un module désactivé n'apparaît plus du tout
  // dans le dashboard (sa chip dans le collapsed est aussi masquée par
  // CollapsedRow et Notch.tsx recalcule la largeur).
  const modulesOn = settings.modules;

  return (
    <div className="expanded-shell">
      <div className="dashboard">
        <NotchSearch
          query={query}
          setQuery={setQuery}
          onAfterAction={onSearchAction}
          settingsOpen={settingsOpen}
          onGearClick={() => setSettingsOpen((o) => !o)}
          clipboardOpen={clipboardOpen}
          onClipboardClick={
            settings.modules.clipboard ? toggleClipboard : undefined
          }
        />

        {settings.dnd && !inSearch && !settingsOpen && !gitlabPanelOpen && !gitlocalPanelOpen && !clipboardOpen && (
          <div className="dnd-banner" data-notch-hit="true">
            <i className="fa-solid fa-moon" />
            <div className="dnd-banner-body">
              <div className="dnd-banner-title">Ne pas déranger</div>
              <div className="dnd-banner-sub">
                Notifications et pills masquées.{' '}
                <span className="dnd-kbd">Ctrl + Shift + D</span> pour basculer.
              </div>
            </div>
            <button
              type="button"
              className="dnd-banner-btn"
              onClick={() => void toggleDnd()}
            >
              Désactiver
            </button>
          </div>
        )}

        {/* Settings : prend la place du dashboard tant que ni la search
            ni un autre overlay n'est actif. Chargé en lazy. */}
        {settingsOpen && !inSearch && (
          <Suspense fallback={<DashboardLoader />}>
            <SettingsView onClose={() => setSettingsOpen(false)} />
          </Suspense>
        )}

        {/* Panel GitLab plein dashboard, ouvert par clic sur la card.
            Chargé en lazy. */}
        {gitlabPanelOpen && !inSearch && !settingsOpen && (
          <Suspense fallback={<DashboardLoader />}>
            <GitLabPanel onClose={() => setGitlabPanelOpen(false)} />
          </Suspense>
        )}

        {/* Panel Git local plein dashboard, ouvert par clic sur la card. */}
        {gitlocalPanelOpen && !inSearch && !settingsOpen && !gitlabPanelOpen && (
          <GitLocalPanel onClose={() => setGitlocalPanelOpen(false)} />
        )}

        {/* Page Clipboard plein dashboard, ouverte via bouton search bar
            ou raccourci global Ctrl+Shift+V. Chargée en lazy. */}
        {clipboardOpen && !inSearch && !settingsOpen && !gitlabPanelOpen && !gitlocalPanelOpen && (
          <Suspense fallback={<DashboardLoader />}>
            <ClipboardPage onClose={closeClipboard} />
          </Suspense>
        )}

        {/* Mode `-` (tâche) : liste détaillée. Compteur déjà inclus dans
            le header de TasksList. */}
        {inTaskMode && modulesOn.tasks && <TasksList />}

        {/* Mode `?` (aide) : doc filtrée selon les modules actifs. */}
        {inHelpMode && <SearchHelp />}

        {/* Mode détection live (URL / JSON / JWT / color / path tapé dans
            la search bar). Vue plein dashboard avec preview + actions. */}
        {inDetectionMode && detected?.detection && (
          <ClipboardDetectionView
            detection={detected.detection}
            onAfterAction={() => {
              setQuery('');
              onSearchAction?.();
            }}
          />
        )}

        {/* Vue par défaut (hors recherche, settings, panel GitLab,
            panel Git local et page Clipboard). Le rendu suit l'ordre
            et les largeurs définis dans `settings.dashboardLayout`
            (configurable via Settings → Disposition). */}
        {!inSearch && !settingsOpen && !gitlabPanelOpen && !gitlocalPanelOpen && !clipboardOpen && (
          <div className="dash-grid">
            {settings.dashboardLayout.map((tile) => {
              // Module éteint dans Settings → on n'occupe pas le slot.
              if (!modulesOn[tile.id]) return null;
              // Skip si la card est désactivée via Settings (showCard=false).
              // Toutes les tuiles supportent ce toggle ; clipboard n'est pas
              // dans DashTileId (page plein dashboard à la place) donc pas concerné.
              const tileCfg = settings.moduleConfig[tile.id] as
                | { showCard?: boolean }
                | undefined;
              if (tileCfg?.showCard === false) return null;
              // Cas conditionnels d'absence de données :
              //   - music : pas de track en cours
              //   - claude : pas de session active
              if (tile.id === 'music' && !hasMusic) return null;
              if (tile.id === 'claude.live' && !hasClaude) return null;
              return (
                <div
                  key={tile.id}
                  className="dash-tile"
                  style={{ '--cols': tile.cols } as CSSProperties}
                  data-tile={tile.id}
                >
                  {tile.id === 'tasks' && (
                    <TasksCounterCard onOpen={() => setQuery('-')} />
                  )}
                  {tile.id === 'meetings' && <MeetingsCard />}
                  {tile.id === 'music' && <MusicCard />}
                  {tile.id === 'gitlab' && (
                    <GitLabCard onOpen={() => setGitlabPanelOpen(true)} />
                  )}
                  {tile.id === 'claude.live' && <ClaudeCard />}
                  {tile.id === 'claude.usage' && <ClaudeUsageCard />}
                  {tile.id === 'gitlocal' && (
                    <GitLocalCard onOpen={() => setGitlocalPanelOpen(true)} />
                  )}
                  {tile.id === 'vpn' && <VpnCard />}
                  {tile.id === 'teams' && <TeamsCard />}
                  {tile.id === 'system' && <SystemCard />}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <AudioFooter />
    </div>
  );
}
