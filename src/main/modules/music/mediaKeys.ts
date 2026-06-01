/**
 * Simulation des touches média virtuelles Windows.
 *
 * Toute application qui s'enregistre auprès de SMTC (Spotify, Apple Music,
 * navigateur YouTube, Windows Media Player, foobar2000…) réagit aux touches
 * média virtuelles `VK_MEDIA_PLAY_PAUSE` (0xB3), `VK_MEDIA_NEXT_TRACK` (0xB0)
 * et `VK_MEDIA_PREV_TRACK` (0xB1). On les déclenche via PowerShell + P/Invoke
 * sur `user32::keybd_event` — pas de binaire à bundler, pas de dépendance
 * utilisateur, fonctionne sur tout Windows 10/11.
 *
 * Coût : un spawn PowerShell par appel (~150-300 ms). Acceptable car les
 * actions sont déclenchées par clic utilisateur, pas en boucle.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { powershellExe } from '../shell/powershellPath';

const execFileAsync = promisify(execFile);

/** Codes virtuels Windows pour les touches média. */
const VK_MEDIA_PLAY_PAUSE = 0xb3;
const VK_MEDIA_NEXT_TRACK = 0xb0;
const VK_MEDIA_PREV_TRACK = 0xb1;

/**
 * Construit le script PowerShell qui définit le P/Invoke et envoie la
 * touche (key down puis key up avec 30 ms de pause, durée minimale
 * acceptée par la plupart des players).
 *
 * On utilise une chaîne PowerShell simple-quote (pas de here-string),
 * compatible avec un script sur une seule ligne — `@'...'@` exige des
 * sauts de ligne autour de ses délimiteurs.
 */
function buildScript(vkCode: number): string {
  const sig =
    "'[System.Runtime.InteropServices.DllImport(\"user32.dll\")] " +
    "public static extern void keybd_event(byte vk, byte scan, uint flags, int extra);'";
  return [
    `$sig = ${sig}`,
    "$t = Add-Type -MemberDefinition $sig -Name 'WnKbd' -Namespace WinNotch -PassThru",
    `$t::keybd_event(${vkCode}, 0, 0, 0)`,
    'Start-Sleep -Milliseconds 30',
    `$t::keybd_event(${vkCode}, 0, 2, 0)`,
  ].join('; ');
}

/** Envoie une touche média virtuelle. Tolère les échecs (log + return). */
async function sendKey(vk: number): Promise<void> {
  try {
    await execFileAsync(
      powershellExe(),
      ['-NoProfile', '-NonInteractive', '-Command', buildScript(vk)],
      { windowsHide: true, timeout: 5000 },
    );
  } catch (err) {
    console.warn('[music/mediaKeys] échec envoi touche média:', err);
  }
}

export const sendPlayPause = (): Promise<void> => sendKey(VK_MEDIA_PLAY_PAUSE);
export const sendNext = (): Promise<void> => sendKey(VK_MEDIA_NEXT_TRACK);
export const sendPrevious = (): Promise<void> => sendKey(VK_MEDIA_PREV_TRACK);
