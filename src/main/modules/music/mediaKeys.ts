/**
 * Simulation des touches média virtuelles Windows.
 *
 * Toute application qui s'enregistre auprès de SMTC (Spotify, Apple Music,
 * navigateur YouTube, Windows Media Player, foobar2000…) réagit aux touches
 * média virtuelles `VK_MEDIA_PLAY_PAUSE`, `VK_MEDIA_NEXT_TRACK` et
 * `VK_MEDIA_PREV_TRACK`. On les envoie via le binding natif
 * `@nut-tree-fork/libnut-win32` (`keyTap`), qui appelle l'API Windows en C++.
 *
 * Pourquoi pas PowerShell ? L'implémentation précédente lançait
 * `powershell.exe` + `Add-Type` (compilation C# runtime de `user32::keybd_event`)
 * à chaque clic — un pattern que les antivirus heuristiques signalent comme
 * suspect. L'appel natif est synchrone, quasi instantané, et ne spawne aucun
 * process externe.
 *
 * `keyTap` reconnaît les libellés `'audio_play'` (play/pause), `'audio_next'`
 * et `'audio_prev'`. Le binding est platform-specific (`-win32`) : WinNotch ne
 * cible que Windows (cf. electron-builder.yml `win.target: nsis`), on l'importe
 * donc directement plutôt que via le wrapper `@nut-tree-fork/libnut` (dont la
 * dépendance `@nut-tree-fork/shared` n'est pas résolue en v4).
 *
 * Import : le bundle main est ESM (`"type": "module"`) mais `libnut-win32` est
 * un module CJS dont les exports sont définis dynamiquement par le binaire
 * natif — Node ESM ne peut donc PAS en extraire les exports nommés
 * (`import { keyTap }` échoue au runtime). On importe le default (= l'objet
 * `module.exports` complet) et on lit `keyTap` dessus.
 */
import libnut from '@nut-tree-fork/libnut-win32';

/** Libellés de touches média acceptés par `keyTap`. */
type MediaKey = 'audio_play' | 'audio_next' | 'audio_prev';

/**
 * Envoie une touche média virtuelle. Tolère les échecs (log + return) : un
 * clic média ne doit jamais faire crasher l'app. `async` conservé pour ne pas
 * changer le contrat des appelants (`musicService.ts` fait `await sendX()`),
 * même si `keyTap` est synchrone.
 */
async function sendKey(key: MediaKey): Promise<void> {
  try {
    libnut.keyTap(key);
  } catch (err) {
    console.warn('[music/mediaKeys] échec envoi touche média:', err);
  }
}

export const sendPlayPause = (): Promise<void> => sendKey('audio_play');
export const sendNext = (): Promise<void> => sendKey('audio_next');
export const sendPrevious = (): Promise<void> => sendKey('audio_prev');
