/**
 * Contenu du notch en état rétracté.
 *
 * Règles d'affichage :
 *  - chip Music : si `settings.modules.music` est activé, `moduleConfig.music.collapsed`
 *    est vrai, ET une lecture est détectée OU `hideWhenStopped === false`
 *  - chip DND : seulement quand `settings.dnd === true`. Masque les autres
 *    chips notifs (Meetings/GitLab/GitLocal/Claude)
 */
import { useMusicContext } from '../../modules/music/MusicContext';
import { MusicChip } from '../../modules/music/MusicChip';
import { MeetingChip } from '../../modules/meetings/MeetingChip';
import { useMeetingsContext } from '../../modules/meetings/MeetingsContext';
import { isToday } from '../../modules/meetings/helpers';
import { ClaudeChip } from '../../modules/claude/ClaudeChip';
import { useClaudeContext } from '../../modules/claude/ClaudeContext';
import { GitLabChip } from '../../modules/gitlab/GitLabChip';
import { useGitLabContext } from '../../modules/gitlab/GitLabContext';
import { GitLocalChip } from '../../modules/gitlocal/GitLocalChip';
import { useGitLocalContext } from '../../modules/gitlocal/GitLocalContext';
import { VpnChip } from '../../modules/vpn/VpnChip';
import { useVpnContext } from '../../modules/vpn/VpnContext';
import { TeamsChip } from '../../modules/teams/TeamsChip';
import { SystemChip } from '../../modules/system/SystemChip';
import { NotchTooltip } from '../Tooltip/NotchTooltip';
import { ClipboardChip } from '../../modules/clipboard/ClipboardChip';
import { useClipboardContext } from '../../modules/clipboard/ClipboardContext';
import { useSettingsContext } from '../../modules/settings/SettingsContext';

export function CollapsedRow() {
  const { state: music } = useMusicContext();
  const { next: nextMeeting } = useMeetingsContext();
  const { active: activeClaude } = useClaudeContext();
  const { state: gitlab } = useGitLabContext();
  const { state: gitlocal } = useGitLocalContext();
  const { state: vpn } = useVpnContext();
  const { state: clipboard } = useClipboardContext();
  const { settings, toggleDnd } = useSettingsContext();

  // La chip Music suit les règles :
  //  - module activé
  //  - autorisée en mode collapsed
  //  - si hideWhenStopped : besoin d'une lecture active (title non vide)
  const musicCfg = settings.moduleConfig.music;
  const musicEnabled =
    settings.modules.music &&
    musicCfg.collapsed &&
    (!musicCfg.hideWhenStopped || !!music.title);

  // La chip Meeting : module activé + meeting upcoming/ongoing **du jour même**.
  // Les RDV du lendemain et au-delà n'apparaissent pas dans le notch
  // rétracté — ils restent visibles dans la card du dashboard étendu.
  // Masquée en DND (toutes les chips droite le sont sauf la lune).
  const meetingsCfg = settings.moduleConfig.meetings;
  const meetingEnabled =
    !settings.dnd &&
    settings.modules.meetings &&
    meetingsCfg.collapsed &&
    !!nextMeeting &&
    isToday(nextMeeting.start);

  // La chip Claude : module activé + au moins 1 session active.
  const claudeCfg = settings.moduleConfig['claude.live'];
  const claudeEnabled =
    !settings.dnd &&
    settings.modules['claude.live'] &&
    claudeCfg.collapsed &&
    activeClaude.length > 0;

  // La chip GitLab : module activé + configuré + au moins 1 élément
  // actionnable (issue à prendre, MR à reviewer, ou MR perso). Masquée en DND.
  const gitlabCfg = settings.moduleConfig.gitlab;
  const gitlabEnabled =
    !settings.dnd &&
    settings.modules.gitlab &&
    gitlabCfg.collapsed &&
    gitlab.configured &&
    (gitlab.watchedIssues.length > 0 ||
      gitlab.toReview.length > 0 ||
      gitlab.mine.length > 0);

  // La chip Git local : module activé + configuré + au moins 1 repo dirty
  // (uncommitted > 0 ou ahead > 0). Masquée en DND (rappel passif, pas une
  // urgence — on ne veut pas le voir pendant une présentation).
  const gitlocalCfg = settings.moduleConfig.gitlocal;
  const gitlocalDirty = gitlocal.repos.filter((r) => r.isDirty).length;
  const gitlocalEnabled =
    !settings.dnd &&
    settings.modules.gitlocal &&
    gitlocalCfg.collapsed &&
    gitlocal.configured &&
    gitlocalDirty > 0;

  // La chip Clipboard : module activé + autorisée en collapsed + au moins
  // une entrée. Pas masquée en DND : c'est un raccourci d'historique, pas
  // une notif active. Le badge "non vu" est tout de même intéressant pour
  // savoir si un copy s'est produit pendant qu'on était concentré ailleurs.
  const clipboardCfg = settings.moduleConfig.clipboard;
  const clipboardEnabled =
    settings.modules.clipboard &&
    clipboardCfg.collapsed &&
    clipboard.entries.length > 0;

  // La chip VPN : module activé + autorisée en collapsed + (connexion
  // active OU showWhenDisconnected). Pas masquée en DND — c'est un état
  // système, pas une notification ; l'utilisateur veut savoir en
  // permanence si son VPN tourne, même quand il ne veut plus être
  // dérangé par des toasts.
  const vpnCfg = settings.moduleConfig.vpn;
  const vpnEnabled =
    settings.modules.vpn &&
    vpnCfg.collapsed &&
    (vpn.connected || vpnCfg.showWhenDisconnected);

  // La chip Teams : module activé + autorisée en collapsed + un statut
  // lisible (la chip se cache d'elle-même si `Unknown` ou `no-account`).
  // Pas masquée en DND : c'est un état système comme la chip VPN,
  // l'utilisateur veut savoir en permanence son statut Teams.
  const teamsCfg = settings.moduleConfig.teams;
  const teamsEnabled = settings.modules.teams && teamsCfg.collapsed;

  // La chip Système live : module activé + autorisée en collapsed. Toujours
  // pertinente (pas de condition "no-data") puisque CPU/RAM/uptime sont
  // toujours disponibles. Pas masquée en DND — c'est un état système :
  // l'utilisateur veut voir la charge même pendant une démo.
  const systemCfg = settings.moduleConfig.system;
  const systemEnabled = settings.modules.system && systemCfg.collapsed;

  return (
    <div
      className="collapsed-row"
      data-has-cover={musicEnabled ? 'true' : undefined}
    >
      <div className="cr-left">
        {musicEnabled && <MusicChip />}
        {clipboardEnabled && <ClipboardChip />}
      </div>
      <div className="cr-right">
        {settings.dnd ? (
          <NotchTooltip
            content={
              <div className="tt-body">
                <div className="tt-head">
                  <i className="fa-solid fa-moon" />
                  <span>ne pas déranger</span>
                </div>
                <div className="tt-sub">
                  Notifications et pills masquées. Cliquer pour désactiver,
                  ou utilise Ctrl + Shift + D.
                </div>
              </div>
            }
          >
            <div
              className="chip chip-dnd"
              onClick={(e) => {
                // stopPropagation : sinon le clic remonte au notch et
                // déclencherait une bascule collapsed → expanded.
                e.stopPropagation();
                void toggleDnd();
              }}
            >
              <i className="fa-solid fa-moon" />
            </div>
          </NotchTooltip>
        ) : (
          <>
            {meetingEnabled && <MeetingChip />}
            {gitlabEnabled && <GitLabChip />}
            {gitlocalEnabled && <GitLocalChip />}
            {claudeEnabled && <ClaudeChip />}
          </>
        )}
        {/* VPN reste visible même en DND : c'est un état système, pas une
            notification — l'utilisateur veut savoir en permanence si son
            VPN tourne, indépendamment du mode "ne pas déranger". */}
        {vpnEnabled && <VpnChip />}
        {/* Teams Presence — même logique que VPN : c'est un état système
            (le statut Teams reste pertinent pendant un mode DND, surtout
            avec le couplage bidirectionnel P3 où DND WinNotch écrit Teams). */}
        {teamsEnabled && <TeamsChip />}
        {/* Système live (CPU/RAM/NET) — toujours pertinent, jamais masqué
            par DND : c'est une jauge d'état de la machine, pas une alerte. */}
        {systemEnabled && <SystemChip />}
      </div>
    </div>
  );
}
