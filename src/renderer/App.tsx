/**
 * Racine de l'arborescence React.
 *
 * Détient l'état "léger" (mode du notch, query de la search bar) et
 * branche les hooks transverses :
 *  - useHitTest             : signale au main quand capturer la souris
 *  - useKeyboardShortcuts   : Ctrl+Space toggle, Esc collapse
 *  - usePeekMode            : reçoit l'état Peek depuis le main (Alt held)
 *
 * Les providers de modules (SettingsProvider, MusicProvider, ToastProvider
 * en Phase 3) wrappent `<Notch>` afin que tous les sous-composants
 * partagent une seule subscription IPC par module.
 *
 * Ordre des providers important :
 *  Settings → Toast (Toast lit settings.dnd) → Music → Notch
 *
 * Le `<NotchToast>` est rendu **en dehors** de `<Notch>` mais à
 * l'intérieur de `<ToastProvider>` : il est positionné en `top:42px`
 * absolu et reste visible quand le notch est rétracté. Affiché
 * uniquement quand mode='collapsed' (sinon l'expanded couvre la zone).
 */
import { useEffect, useState } from 'react';
import type { NotchMode } from '../shared/types';
import { Notch } from './components/Notch/Notch';
import { NotchToast } from './modules/toast/NotchToast';
import { useHitTest } from './hooks/useHitTest';
import { usePeekMode } from './hooks/usePeekMode';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useShellEvents } from './hooks/useShellEvents';
import { useFullscreenMode } from './hooks/useFullscreenMode';
import { useDndToastSync } from './hooks/useDndToastSync';
import { SettingsProvider } from './modules/settings/SettingsContext';
import { ToastProvider, useToast } from './modules/toast/ToastContext';
import { MusicProvider } from './modules/music/MusicContext';
import { MeetingsProvider } from './modules/meetings/MeetingsContext';
import { ClaudeProvider } from './modules/claude/ClaudeContext';
import { useClaudeCompletionToasts } from './modules/claude/useClaudeCompletionToasts';
import { ClaudeUsageProvider } from './modules/claudeUsage/ClaudeUsageContext';
import { useClaudeUsageThresholdToasts } from './modules/claudeUsage/useClaudeUsageThresholdToasts';
import { useClaudeUsagePaceToast } from './modules/claudeUsage/useClaudeUsagePaceToast';
import { GitLabProvider } from './modules/gitlab/GitLabContext';
import { useGitLabReviewToasts } from './modules/gitlab/useGitLabReviewToasts';
import { useGitLabIssueToasts } from './modules/gitlab/useGitLabIssueToasts';
import { useGitLabPipelineToasts } from './modules/gitlab/useGitLabPipelineToasts';
import { GitLocalProvider } from './modules/gitlocal/GitLocalContext';
import { VpnProvider } from './modules/vpn/VpnContext';
import { PrivacyProvider } from './modules/privacy/PrivacyContext';
import { useVpnToasts } from './modules/vpn/useVpnToasts';
import { TeamsProvider } from './modules/teams/TeamsContext';
import { SystemProvider } from './modules/system/SystemContext';
import { BambuProvider } from './modules/bambu/BambuContext';
import { useBambuToasts } from './modules/bambu/useBambuToasts';
import { AudioProvider } from './modules/audio/AudioContext';
import { SearchProvider, useSearchContext } from './modules/search/SearchContext';
import { TasksProvider } from './modules/tasks/TasksContext';
import { UpdaterProvider } from './modules/updater/UpdaterContext';
import { useUpdateToasts } from './modules/updater/useUpdateToasts';
import {
  ClipboardProvider,
  useClipboardContext,
} from './modules/clipboard/ClipboardContext';

function NotchToastSlot({ collapsed }: { collapsed: boolean }) {
  const { current, dismiss } = useToast();
  if (!current) return null;
  // Affiché quel que soit le mode : en collapsed la pill sort sous le
  // notch (top:42px), en expanded une classe CSS la décale pour rester
  // visible au-dessus du dashboard. Sinon on perdrait toutes les notifs
  // émises pendant que l'utilisateur consulte le notch.
  return (
    <NotchToast
      key={current.id}
      toast={current}
      onDismiss={dismiss}
      collapsed={collapsed}
    />
  );
}

function AppInner() {
  const [mode, setModeState] = useState<NotchMode>('collapsed');

  // Wrapper qui expose une signature "updater" (style React.SetStateAction)
  // attendue par les hooks consommateurs.
  const setMode = (updater: (m: NotchMode) => NotchMode) => {
    setModeState((m) => updater(m));
  };

  useHitTest();
  useKeyboardShortcuts({ setMode });
  useShellEvents({ setMode });
  const peeking = usePeekMode();
  const fullscreen = useFullscreenMode();

  // Notifie le main à chaque transition collapsed ↔ expanded. Le main
  // enregistre Escape comme global shortcut quand le notch est ouvert,
  // pour pouvoir le fermer même sans focus système (contournement de
  // l'anti-focus-stealing Windows).
  useEffect(() => {
    window.notch.shell.notifyModeChanged(mode);
  }, [mode]);
  // Lance un toast système chaque fois que DND bascule (y compris via le
  // raccourci global Ctrl+Shift+D depuis le main process).
  useDndToastSync();
  // Détecte les transitions de sessions Claude working/waiting → idle/done
  // et émet un toast (sous réserve du toggle notifyCompletion).
  useClaudeCompletionToasts();
  // Toasts à chaque franchissement de seuil 5h / 7d sur les limites Claude.
  useClaudeUsageThresholdToasts();
  // Toast de RYTHME : prévient quand une fenêtre sera épuisée avant son reset.
  useClaudeUsagePaceToast();
  // Détecte les nouvelles MR assignées en review et émet un toast par
  // nouvelle assignation (sous réserve du toggle moduleConfig.gitlab.notify.mr).
  useGitLabReviewToasts();
  // Détecte les nouvelles issues correspondant à un label surveillé
  // (Severity::Critique, etc.) et émet un toast par nouvelle issue.
  useGitLabIssueToasts();
  // Toast « pipeline échoué » sur une de mes MR (moduleConfig.gitlab.notify.pipelines).
  useGitLabPipelineToasts();
  // Toasts aux transitions du flux d'update (available / downloaded / error).
  useUpdateToasts();
  // Toasts à chaque connexion / déconnexion VPN détectée par le polling.
  useVpnToasts();
  // Toasts Bambu : fin / échec d'impression, HMS grave, filament bas (toast-only).
  useBambuToasts();
  // Le raccourci global Ctrl+Alt+V incrémente `pendingFocusAt` côté
  // clipboard ; on force alors le passage en expanded pour que la page
  // (auto-ouverte par useClipboard) soit visible.
  const { pendingFocusAt, closePage: closeClipboardPage } =
    useClipboardContext();
  useEffect(() => {
    if (pendingFocusAt === 0) return;
    setModeState('expanded');
  }, [pendingFocusAt]);
  // Quand le notch passe en collapsed, on referme la page Clipboard pour
  // que la prochaine ouverture via Ctrl+Shift+Space retombe sur le
  // dashboard normal (et non sur la dernière page consultée).
  useEffect(() => {
    if (mode === 'collapsed') closeClipboardPage();
  }, [mode, closeClipboardPage]);
  // Idem pour la search bar : on vide la query au passage en collapsed
  // pour que la prochaine ouverture du notch parte sur un état neutre.
  const { clearSearch } = useSearchContext();
  useEffect(() => {
    if (mode === 'collapsed') clearSearch();
  }, [mode, clearSearch]);

  return (
    <>
      <Notch
        mode={mode}
        setMode={setMode}
        peeking={peeking}
        fullscreen={fullscreen}
      />
      <NotchToastSlot collapsed={mode === 'collapsed'} />
    </>
  );
}

export function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <AudioProvider>
        <SearchProvider>
        <TasksProvider>
        <MusicProvider>
          <MeetingsProvider>
            <ClaudeProvider>
              <ClaudeUsageProvider>
              <GitLabProvider>
                <GitLocalProvider>
                  <VpnProvider>
                    <PrivacyProvider>
                    <TeamsProvider>
                      <SystemProvider>
                        <BambuProvider>
                        <UpdaterProvider>
                          <ClipboardProvider>
                            <AppInner />
                          </ClipboardProvider>
                        </UpdaterProvider>
                        </BambuProvider>
                      </SystemProvider>
                    </TeamsProvider>
                    </PrivacyProvider>
                  </VpnProvider>
                </GitLocalProvider>
              </GitLabProvider>
              </ClaudeUsageProvider>
            </ClaudeProvider>
          </MeetingsProvider>
        </MusicProvider>
        </TasksProvider>
        </SearchProvider>
        </AudioProvider>
      </ToastProvider>
    </SettingsProvider>
  );
}
