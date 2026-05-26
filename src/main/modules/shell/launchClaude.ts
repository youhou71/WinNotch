/**
 * Lanceur Claude CLI : ouvre un nouveau terminal Windows et exécute
 * `claude <prompt>`.
 *
 * Stratégie d'invocation :
 *  1. Tente d'abord Windows Terminal (`wt.exe`) qui est l'expérience la
 *     plus moderne sur Win11. Si présent → on ouvre un nouvel onglet
 *     avec le shell par défaut puis on tape `claude "<prompt>"`.
 *  2. Sinon repli sur `cmd /c start cmd /k claude "<prompt>"` qui
 *     marche partout depuis Windows 7.
 *
 * Le prompt est échappé pour éviter qu'un guillemet, un saut de ligne
 * ou un caractère de contrôle ne casse la ligne de commande.
 *
 * Le sous-process est lancé en `detached: true` + `unref()` pour ne pas
 * mourir avec le main process — sinon fermer WinNotch tuerait aussi le
 * terminal Claude.
 */
import { spawn } from 'child_process';
import { existsSync, statSync } from 'fs';
import { app, ipcMain, shell } from 'electron';
import { IpcChannel } from '../../../shared/types';

/**
 * Échappe les guillemets pour le passage dans une commande shell
 * Windows. cmd.exe utilise le doublement de quote (`""`) pour échapper.
 */
function escapeForCmd(s: string): string {
  return s.replace(/"/g, '""');
}

/**
 * Spawn détaché — le terminal ouvert vit indépendamment du main process
 * WinNotch. Si WinNotch crash ou est fermé, le terminal Claude reste.
 */
function spawnDetached(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(file, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        shell: false,
      });
      child.on('error', reject);
      child.unref();
      resolve();
    } catch (err) {
      reject(err as Error);
    }
  });
}

/**
 * Lance Claude. Retourne `{ ok: true }` si le spawn a réussi.
 * En cas d'erreur, renvoie le message au renderer pour qu'il affiche
 * un toast utile.
 */
async function launchClaude(prompt: string): Promise<{ ok: boolean; error?: string }> {
  const safe = escapeForCmd(prompt);
  // Commande passée à cmd : `claude "<prompt>"`. Les `""` doublés
  // restent corrects après que cmd.exe les ait dépliés en `"` simples.
  const claudeCmd = safe ? `claude "${safe}"` : 'claude';

  // 1) Windows Terminal si disponible.
  try {
    await spawnDetached('wt.exe', [
      'new-tab',
      '--',
      'cmd.exe',
      '/K',
      claudeCmd,
    ]);
    return { ok: true };
  } catch {
    // wt absent ou erreur → on retombe sur cmd /c start.
  }

  // 2) Repli universel via `cmd /c start`.
  try {
    await spawnDetached('cmd.exe', [
      '/c',
      'start',
      '""',         // titre vide pour `start` (sinon il prend le 1er arg comme titre)
      'cmd.exe',
      '/K',
      claudeCmd,
    ]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Ouvre une URL externe dans le navigateur par défaut.
 *
 * `shell.openExternal` est déjà restrictif (refuse `file://`, gère bien
 * les schémas custom enregistrés), mais on filtre **explicitement** sur
 * http(s) au niveau IPC. Ça évite qu'une faille de rendu permette
 * d'invoquer `shell:openExternal` avec un schéma exotique (ex. ms-msdt:)
 * pour exécuter du code via un handler système.
 */
async function openExternal(
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  if (typeof url !== 'string') {
    return { ok: false, error: 'URL invalide' };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'URL malformée' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `Schéma non autorisé : ${parsed.protocol}` };
  }
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Ouvre l'Explorer Windows sur un chemin arbitraire.
 *
 * Validation stricte (le path peut venir d'une saisie utilisateur dans
 * la search bar) :
 *  - format Windows local (`C:\…`) ou UNC (`\\server\share\…`)
 *  - rejet des caractères réservés (`<>"|?*` + contrôles)
 *  - vérification d'existence via `existsSync` AVANT l'appel système,
 *    pour éviter qu'un chemin réseau aléatoire ne déclenche un timeout
 *    de résolution SMB
 *
 * Sélection du bon appel Electron :
 *  - **Dossier** → `shell.openPath()` qui entre DANS le dossier
 *    (`showItemInFolder` ouvrirait le parent avec le dossier sélectionné,
 *    inutile et carrément cassé quand le parent est la racine `C:\`)
 *  - **Fichier** → `shell.showItemInFolder()` qui ouvre Explorer sur le
 *    dossier parent et met le fichier en surbrillance
 */
const PATH_LOCAL_RE = /^[a-zA-Z]:[\\/][^<>"|?*\r\n]*$/;
const PATH_UNC_RE = /^\\\\[^\\<>"|?*\r\n]+\\[^<>"|?*\r\n]+/;

async function openPath(path: string): Promise<{ ok: boolean; error?: string }> {
  if (typeof path !== 'string' || !path.trim()) {
    return { ok: false, error: 'Chemin invalide' };
  }
  // Trim + normalisation des slashes : Windows accepte `/` mais
  // `shell.openPath` / `showItemInFolder` préfèrent `\`.
  let trimmed = path.trim().replace(/\//g, '\\');
  // Trailing backslash : OK pour un dossier mais on l'enlève pour ne
  // pas perturber statSync sur les racines (sauf `C:\` qui en a besoin).
  if (trimmed.length > 3 && trimmed.endsWith('\\')) {
    trimmed = trimmed.slice(0, -1);
  }
  if (!PATH_LOCAL_RE.test(trimmed) && !PATH_UNC_RE.test(trimmed)) {
    return { ok: false, error: 'Format de chemin Windows non reconnu' };
  }
  if (!existsSync(trimmed)) {
    return { ok: false, error: "Le chemin n'existe pas" };
  }
  try {
    let isDirectory = false;
    try {
      isDirectory = statSync(trimmed).isDirectory();
    } catch {
      // Si stat échoue (permissions, race), on tombe sur openPath qui
      // gère les deux cas de toute façon — pire cas il ouvre l'app
      // associée au fichier au lieu de sélectionner dans Explorer.
    }
    if (isDirectory) {
      const errMsg = await shell.openPath(trimmed);
      if (errMsg) return { ok: false, error: errMsg };
      return { ok: true };
    }
    shell.showItemInFolder(trimmed);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function registerShellIpc(): void {
  ipcMain.handle(IpcChannel.ShellLaunchClaude, async (_e, prompt: string) => {
    return launchClaude(prompt ?? '');
  });
  ipcMain.handle(IpcChannel.ShellOpenExternal, async (_e, url: string) => {
    return openExternal(url ?? '');
  });
  ipcMain.handle(IpcChannel.ShellOpenPath, async (_e, path: string) => {
    return openPath(path ?? '');
  });
  // One-way send : le renderer n'attend pas de retour, l'app est en train
  // de mourir. `app.quit()` enchaîne `before-quit` (cleanup des timers et
  // hooks externes) puis ferme les fenêtres → `window-all-closed` →
  // `app.exit()`.
  ipcMain.on(IpcChannel.ShellQuit, () => {
    app.quit();
  });
}
