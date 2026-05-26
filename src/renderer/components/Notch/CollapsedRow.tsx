/**
 * Contenu du notch en état rétracté.
 *
 * Règles d'affichage :
 *  - chip Music : si `settings.modules.music` est activé, `moduleConfig.music.collapsed`
 *    est vrai, ET une lecture est détectée OU `hideWhenStopped === false`
 *  - chip DND : seulement quand `settings.dnd === true`. Masque les autres
 *    chips notifs (futur : Meetings/Messages/Tasks/GitLab/Claude)
 *
 * Les chips notifs des modules Meetings/GitLab/Claude/Tasks/Messages
 * arriveront avec leurs backends respectifs — placeholders ici pour le
 * moment.
 */
import { useMusicContext } from '../../modules/music/MusicContext';
import { MusicChip } from '../../modules/music/MusicChip';
import { MeetingChip } from '../../modules/meetings/MeetingChip';
import { useMeetingsContext } from '../../modules/meetings/MeetingsContext';
import { ClaudeChip } from '../../modules/claude/ClaudeChip';
import { useClaudeContext } from '../../modules/claude/ClaudeContext';
import { GitLabChip } from '../../modules/gitlab/GitLabChip';
import { useGitLabContext } from '../../modules/gitlab/GitLabContext';
import { GitLocalChip } from '../../modules/gitlocal/GitLocalChip';
import { useGitLocalContext } from '../../modules/gitlocal/GitLocalContext';
import { ClipboardChip } from '../../modules/clipboard/ClipboardChip';
import { useClipboardContext } from '../../modules/clipboard/ClipboardContext';
import { useSettingsContext } from '../../modules/settings/SettingsContext';

export function CollapsedRow() {
  const { state: music } = useMusicContext();
  const { next: nextMeeting } = useMeetingsContext();
  const { active: activeClaude } = useClaudeContext();
  const { state: gitlab } = useGitLabContext();
  const { state: gitlocal } = useGitLocalContext();
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

  // La chip Meeting : module activé + meeting upcoming/ongoing détecté.
  // Masquée en DND (toutes les chips droite le sont sauf la lune).
  const meetingsCfg = settings.moduleConfig.meetings;
  const meetingEnabled =
    !settings.dnd &&
    settings.modules.meetings &&
    meetingsCfg.collapsed &&
    !!nextMeeting;

  // La chip Claude : module activé + au moins 1 session active.
  const claudeCfg = settings.moduleConfig.claude;
  const claudeEnabled =
    !settings.dnd &&
    settings.modules.claude &&
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
        ) : (
          <>
            {meetingEnabled && <MeetingChip />}
            {gitlabEnabled && <GitLabChip />}
            {gitlocalEnabled && <GitLocalChip />}
            {claudeEnabled && <ClaudeChip />}
          </>
        )}
      </div>
    </div>
  );
}
