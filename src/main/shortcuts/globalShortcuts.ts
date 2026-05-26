/**
 * Raccourcis clavier globaux Windows via `Electron.globalShortcut`.
 *
 *  - Ctrl + Shift + D     : toggle DND (Ne pas déranger)
 *  - Ctrl + Shift + Space : toggle collapsed/expanded du notch
 *
 * Note : Escape **ne peut pas** être enregistré via globalShortcut
 * (Electron le refuse explicitement). On le capte donc via le keyserver
 * natif `node-global-key-listener` (cf. `altPeek.ts`), conditionnel au
 * mode `expanded` que le renderer notifie via `shell:modeChanged`.
 *
 * Note : pas de `win.focus()` agressif ni de `app.focus({ steal: true })`.
 * Sur Windows, ces appels réveillent la taskbar auto-hide quand
 * `SetForegroundWindow` est invoqué. Le focus système n'est pas
 * indispensable car :
 *  - Les events clavier (Esc) sont captés via `node-global-key-listener`
 *  - L'utilisateur peut cliquer dans la search bar pour donner le focus
 *    naturellement quand il veut taper
 */
import { ipcMain, globalShortcut } from 'electron';
import { IpcChannel, type NotchMode } from '../../shared/types';
import { toggleDnd } from '../modules/settings/settingsService';
import { focusClipboardCard } from '../modules/clipboard/clipboardService';
import { getNotchWindow } from '../window/notchWindow';
import { setNotchMode } from './altPeek';

const SHORTCUT_DND = 'CommandOrControl+Shift+D';
const SHORTCUT_TOGGLE = 'CommandOrControl+Shift+Space';
const SHORTCUT_CLIPBOARD = 'CommandOrControl+Shift+V';

function tryRegister(accelerator: string, handler: () => void, label: string): void {
  const ok = globalShortcut.register(accelerator, handler);
  if (!ok) {
    console.warn(
      `[WinNotch] Le raccourci global ${accelerator} (${label}) n'a pas pu être ` +
        `enregistré — probablement déjà utilisé par une autre application.`,
    );
  }
}

export function registerGlobalShortcuts(): void {
  tryRegister(SHORTCUT_DND, () => {
    toggleDnd();
  }, 'toggle DND');

  tryRegister(SHORTCUT_TOGGLE, () => {
    const win = getNotchWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send(IpcChannel.ShellToggleNotch);
    if (!win.isVisible()) win.show();
    // Sans focus système, l'input de search ne peut pas recevoir les
    // keystrokes Windows même si on l'a `focus()` côté DOM. On force
    // donc l'activation au raccourci pour que l'utilisateur puisse taper
    // immédiatement. Compromis : peut réveiller la taskbar auto-hide
    // (Windows appelle SetForegroundWindow sous le capot).
    win.focus();
    win.webContents.focus();
  }, 'toggle Notch');

  // Ctrl+Shift+V : signale au renderer d'afficher la card Clipboard.
  // C'est le renderer qui force le passage en expanded + focus sur la
  // search bar de la card (pas de ShellToggleNotch ici, qui rétracterait
  // le notch s'il est déjà ouvert). Même pattern de focus système que
  // SHORTCUT_TOGGLE pour autoriser la saisie immédiate.
  tryRegister(SHORTCUT_CLIPBOARD, () => {
    const win = getNotchWindow();
    if (!win || win.isDestroyed()) return;
    if (!win.isVisible()) win.show();
    focusClipboardCard();
    win.focus();
    win.webContents.focus();
  }, 'ouvrir Clipboard');

  // Le renderer notifie chaque changement de mode pour qu'on relaye
  // au listener clavier global qui décidera si Esc doit fermer le notch.
  ipcMain.on(IpcChannel.ShellModeChanged, (_e, mode: NotchMode) => {
    setNotchMode(mode);
  });
}

export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
}
