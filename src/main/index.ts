/**
 * Point d'entrée du main process Electron.
 *
 * Responsabilités :
 *  - cycle de vie de l'app (ready, activate, quit)
 *  - création de la fenêtre Notch + suivi multi-écrans
 *  - enregistrement des handlers IPC (souris, audio)
 *  - démarrage du polling audio et du listener clavier Alt
 *
 * Les modules métier sont volontairement isolés dans `modules/<id>/` pour
 * que l'ajout d'un nouveau module (Music, Meetings, GitLab, etc.) suive le
 * même patron : un service côté main + un handler IPC + un dossier renderer.
 */
// `./bootstrap` DOIT rester en premier : il override `app.setPath('userData')`
// en mode dev, et plusieurs services ci-dessous instancient `new Store()`
// au top-level (electron-store résout le chemin à la construction).
import './bootstrap';
import { app, BrowserWindow } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import {
  createNotchWindow,
  registerNotchWindowIpc,
  registerScreenListeners,
} from './window/notchWindow';
import { registerMouseIpc } from './ipc/mouse';
import {
  registerAudioIpc,
  startAudioPolling,
  stopAudioPolling,
} from './modules/audio/audioService';
import { registerMusicIpc, stopMusic } from './modules/music/musicService';
import {
  registerClipboardIpc,
  stopClipboard,
} from './modules/clipboard/clipboardService';
import {
  registerMeetingsIpc,
  startMeetingsPolling,
  stopMeetingsPolling,
} from './modules/meetings/meetingsService';
import { registerClaudeIpc, stopClaude } from './modules/claude/claudeService';
import {
  registerClaudeUsageIpc,
  stopClaudeUsage,
} from './modules/claudeUsage/claudeUsageService';
import { registerGitLabIpc, stopGitLab } from './modules/gitlab/gitlabService';
import {
  registerGitLocalIpc,
  stopGitLocal,
} from './modules/gitlocal/gitlocalService';
import { registerVpnIpc, stopVpn } from './modules/vpn/vpnService';
import { registerPrivacyIpc, stopPrivacy } from './modules/privacy/privacyService';
import { registerTeamsIpc, stopTeams } from './modules/teams/teamsService';
import { registerBambuIpc, stopBambu } from './modules/bambu/bambuService';
import {
  registerSystemIpc,
  stopSystem,
} from './modules/system/systemService';
import { registerTasksIpc, stopTasks } from './modules/tasks/tasksService';
import {
  registerUpdaterIpc,
  stopUpdater,
} from './modules/updater/updaterService';
import {
  registerSettingsIpc,
  syncAutoStartFromSystem,
} from './modules/settings/settingsService';
import { registerSearchIpc } from './modules/search/searchService';
import { registerShellIpc } from './modules/shell/launchClaude';
import {
  startFullscreenDetector,
  stopFullscreenDetector,
} from './modules/shell/fullscreenDetector';
import { stopPersistentPowershell } from './modules/shell/persistentPowershell';
import { startAltPeekListener, stopAltPeekListener } from './shortcuts/altPeek';
import {
  registerGlobalShortcuts,
  unregisterGlobalShortcuts,
} from './shortcuts/globalShortcuts';

app.whenReady().then(async () => {
  // Identifiant utilisé par Windows pour grouper les notifications/jumplist.
  electronApp.setAppUserModelId('com.cfast.winnotch');

  // Raccourcis dev (F12 devtools, Ctrl+R reload) appliqués sur chaque BrowserWindow.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // Les handlers IPC doivent être enregistrés AVANT createNotchWindow,
  // sinon le renderer peut émettre des `invoke` qui partent dans le vide.
  registerMouseIpc();
  registerNotchWindowIpc();
  registerSettingsIpc();
  // Réconcilie le toggle autoStart avec l'état système (migration v0.x →
  // v1 Task Scheduler, ou suppression manuelle de la task via msconfig /
  // Task Scheduler / Gestionnaire des tâches). Async (spawn PowerShell)
  // mais non-bloquant : on n'attend pas, le renderer recevra la valeur à
  // jour via le push `settings:change` quand la réconciliation termine.
  void syncAutoStartFromSystem();
  registerShellIpc();
  registerSearchIpc();
  registerTasksIpc();
  registerMeetingsIpc();
  void registerClaudeIpc();
  registerGitLabIpc();
  if (process.env.WINNOTCH_DISABLE_GITLOCAL !== '1') {
    registerGitLocalIpc();
  } else {
    console.log(
      '[WinNotch] Module Git local désactivé (WINNOTCH_DISABLE_GITLOCAL=1)',
    );
  }
  if (process.env.WINNOTCH_DISABLE_VPN !== '1') {
    registerVpnIpc();
  } else {
    console.log('[WinNotch] Module VPN désactivé (WINNOTCH_DISABLE_VPN=1)');
  }
  // Témoin caméra/micro (self-guard via WINNOTCH_DISABLE_PRIVACY en interne).
  registerPrivacyIpc();
  if (process.env.WINNOTCH_DISABLE_TEAMS !== '1') {
    registerTeamsIpc();
  } else {
    console.log('[WinNotch] Module Teams désactivé (WINNOTCH_DISABLE_TEAMS=1)');
  }
  if (process.env.WINNOTCH_DISABLE_SYSTEM !== '1') {
    registerSystemIpc();
  } else {
    console.log(
      '[WinNotch] Module Système live désactivé (WINNOTCH_DISABLE_SYSTEM=1)',
    );
  }
  if (process.env.WINNOTCH_DISABLE_BAMBU !== '1') {
    registerBambuIpc();
  } else {
    console.log('[WinNotch] Module Bambu désactivé (WINNOTCH_DISABLE_BAMBU=1)');
  }
  if (process.env.WINNOTCH_DISABLE_CLAUDE_USAGE !== '1') {
    registerClaudeUsageIpc();
  } else {
    console.log(
      '[WinNotch] Module Claude usage désactivé (WINNOTCH_DISABLE_CLAUDE_USAGE=1)',
    );
  }
  registerUpdaterIpc();
  registerAudioIpc();
  if (process.env.WINNOTCH_DISABLE_MUSIC !== '1') {
    registerMusicIpc();
  } else {
    console.log('[WinNotch] Module Music désactivé (WINNOTCH_DISABLE_MUSIC=1)');
  }
  if (process.env.WINNOTCH_DISABLE_CLIPBOARD !== '1') {
    registerClipboardIpc();
  } else {
    console.log(
      '[WinNotch] Module Clipboard désactivé (WINNOTCH_DISABLE_CLIPBOARD=1)',
    );
  }

  createNotchWindow();
  registerScreenListeners();
  registerGlobalShortcuts();

  // Feature flags de diagnostic — utiles pour isoler une source d'erreur
  // sans avoir à recompiler. Définir l'env var à "1" pour désactiver.
  //  - WINNOTCH_DISABLE_AUDIO_POLL=1 : coupe le polling volume 2 s (loudness)
  //  - WINNOTCH_DISABLE_ALT_PEEK=1   : coupe la détection Alt (mode Peek)
  //  - WINNOTCH_DISABLE_MUSIC=1      : coupe le monitor SMTC + media keys
  //  - WINNOTCH_DISABLE_CLIPBOARD=1  : coupe le polling clipboard + IPC
  //  - WINNOTCH_DISABLE_VPN=1        : coupe le polling PowerShell VPN
  if (process.env.WINNOTCH_DISABLE_AUDIO_POLL !== '1') {
    startAudioPolling();
  } else {
    console.log('[WinNotch] Audio polling désactivé (WINNOTCH_DISABLE_AUDIO_POLL=1)');
  }
  // IMPORTANT : avant startFullscreenDetector() — le handler Alt doit être
  // enregistré au moment du spawn du poller PS (cf. altPeek.ts).
  if (process.env.WINNOTCH_DISABLE_ALT_PEEK !== '1') {
    startAltPeekListener();
  } else {
    console.log('[WinNotch] Alt peek listener désactivé (WINNOTCH_DISABLE_ALT_PEEK=1)');
  }

  startMeetingsPolling();
  startFullscreenDetector();

  // Sur macOS, le clic sur l'icône dock réveille la fenêtre fermée.
  // Windows n'utilise pas ce flux mais on garde le comportement pour
  // la portabilité future.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createNotchWindow();
  });
});

app.on('window-all-closed', () => {
  // Nettoyage explicite avant la fin du process : les timers et les hooks
  // clavier doivent être démontés sinon Node peut tarder à se terminer.
  stopAudioPolling();
  stopAltPeekListener();
  stopMusic();
  stopClipboard();
  stopMeetingsPolling();
  stopClaude();
  stopClaudeUsage();
  stopGitLab();
  stopGitLocal();
  stopVpn();
  stopPrivacy();
  stopTeams();
  stopSystem();
  stopBambu();
  stopTasks();
  stopUpdater();
  stopFullscreenDetector();
  stopPersistentPowershell();
  unregisterGlobalShortcuts();
  // Convention Electron : sur macOS l'app reste vivante sans fenêtre,
  // sur Windows/Linux on quitte.
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Filet de sécurité : même si window-all-closed n'a pas été déclenché
  // (ex. quit programmatique), on coupe les ressources externes.
  stopAudioPolling();
  stopAltPeekListener();
  stopMusic();
  stopClipboard();
  stopMeetingsPolling();
  stopClaude();
  stopClaudeUsage();
  stopGitLab();
  stopGitLocal();
  stopVpn();
  stopPrivacy();
  stopTeams();
  stopSystem();
  stopBambu();
  stopTasks();
  stopUpdater();
  stopFullscreenDetector();
  stopPersistentPowershell();
  unregisterGlobalShortcuts();
});
