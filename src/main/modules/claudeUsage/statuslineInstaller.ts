/**
 * Installation / désinstallation du wrapper statusline WinNotch dans
 * `~/.claude/settings.json`.
 *
 * Le wrapper est `resources/winnotch-statusline.cjs` — copié au démarrage
 * du main dans `app.getPath('userData')/winnotch-statusline.cjs` pour
 * disposer d'un chemin stable (le chemin d'install Electron change à
 * chaque version sinon).
 *
 * Patch idempotent : on lit le settings.json existant, on y ajoute (ou
 * remplace) le champ `statusLine` avec notre commande, puis on réécrit.
 * En cas de commande utilisateur préexistante non-WinNotch, on la stocke
 * dans `statusLine.wrappedCommand` pour que le wrapper l'invoque à la
 * suite via la variable d'environnement `WINNOTCH_WRAPPED_STATUSLINE`.
 *
 * Désinstallation : retire le `statusLine` si c'est le nôtre, OU restaure
 * la commande utilisateur d'origine si on était en mode wrap.
 */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const WRAPPER_FILENAME = 'winnotch-statusline.cjs';
const WRAPPER_MARKER = '__winnotch_statusline__';

export interface InstallResult {
  ok: boolean;
  installed: boolean;
  path?: string;
  error?: string;
}

/**
 * Chemin stable du wrapper après copie dans userData. À utiliser dans
 * `~/.claude/settings.json` comme `statusLine.command`.
 */
function wrapperTargetPath(): string {
  return path.join(app.getPath('userData'), WRAPPER_FILENAME);
}

/**
 * Source du wrapper dans les resources de l'app (bundled).
 * En dev (non packagé), `process.resourcesPath` n'existe pas — on
 * retombe sur le dossier `resources/` à la racine du projet.
 */
function wrapperSourcePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, WRAPPER_FILENAME);
  }
  return path.join(app.getAppPath(), 'resources', WRAPPER_FILENAME);
}

/**
 * Copie le wrapper depuis les resources vers userData. Idempotent : on
 * écrase à chaque appel pour propager les éventuelles mises à jour du
 * script entre versions WinNotch.
 */
async function copyWrapperToUserData(): Promise<string> {
  const src = wrapperSourcePath();
  const dst = wrapperTargetPath();
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
  return dst;
}

/**
 * Au démarrage de WinNotch : si l'utilisateur a déjà installé le
 * wrapper, on rafraîchit le fichier sur disque depuis les resources
 * bundlées de la nouvelle version. Évite de demander à l'utilisateur
 * une réinstallation manuelle après chaque bump WinNotch.
 *
 * Best-effort : aucune erreur ne fait crasher le service.
 */
export async function refreshWrapperIfInstalled(): Promise<void> {
  try {
    if (!(await isStatuslineInstalled())) return;
    await copyWrapperToUserData();
  } catch (err) {
    console.warn('[claudeUsage] refresh wrapper échec (best-effort):', err);
  }
}

/** True si le `~/.claude/` existe (proxy pour "Claude Code installé"). */
export async function isClaudeInstalled(): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(os.homedir(), '.claude'));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/** Lit le settings.json (objet vide si absent / corrompu). */
async function readClaudeSettings(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(CLAUDE_SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ENOENT ou corruption — on repart sur un objet vide.
  }
  return {};
}

async function writeClaudeSettings(obj: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(CLAUDE_SETTINGS_PATH), { recursive: true });
  await fs.writeFile(CLAUDE_SETTINGS_PATH, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/**
 * Détecte si le `statusLine` actuel pointe vers le wrapper WinNotch.
 * On regarde la présence du marqueur `__winnotch_statusline__` dans le
 * statusLine — robuste face aux changements de chemin (dev vs prod).
 */
export function isWinNotchStatuslineInstalledIn(settings: Record<string, unknown>): boolean {
  const sl = settings.statusLine as Record<string, unknown> | undefined;
  if (!sl || typeof sl !== 'object') return false;
  return sl[WRAPPER_MARKER] === true;
}

/** True si WinNotch est installé dans le settings.json courant. */
export async function isStatuslineInstalled(): Promise<boolean> {
  return isWinNotchStatuslineInstalledIn(await readClaudeSettings());
}

/**
 * Installe le wrapper :
 *  - copie le script dans userData
 *  - ajoute `statusLine` dans settings.json
 *  - si un statusLine utilisateur existait, on le stocke pour wrap
 */
export async function installStatusline(): Promise<InstallResult> {
  try {
    const wrapperPath = await copyWrapperToUserData();
    const settings = await readClaudeSettings();

    const previous = settings.statusLine as Record<string, unknown> | undefined;
    const wasWinNotch = previous && previous[WRAPPER_MARKER] === true;
    const wrappedCommand = wasWinNotch
      ? (previous?.wrappedCommand as string | undefined)
      : typeof previous?.command === 'string'
        ? previous.command
        : undefined;

    settings.statusLine = {
      type: 'command',
      // node est requis pour exécuter le .cjs. Sur Windows, node.exe est
      // dans le PATH si l'utilisateur a Node installé ; on l'invoque
      // explicitement plutôt que de compter sur l'association de fichier.
      command: `node "${wrapperPath}"`,
      env: wrappedCommand ? { WINNOTCH_WRAPPED_STATUSLINE: wrappedCommand } : undefined,
      // Marqueur de propriété — permet de détecter notre installation
      // même si le chemin du wrapper change entre versions.
      [WRAPPER_MARKER]: true,
      ...(wrappedCommand ? { wrappedCommand } : {}),
    };

    await writeClaudeSettings(settings);

    return { ok: true, installed: true, path: wrapperPath };
  } catch (err) {
    return {
      ok: false,
      installed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Désinstalle le wrapper :
 *  - si on est en mode wrap, restaure la commande utilisateur d'origine
 *  - sinon, retire le `statusLine` entièrement
 */
export async function uninstallStatusline(): Promise<InstallResult> {
  try {
    const settings = await readClaudeSettings();
    const sl = settings.statusLine as Record<string, unknown> | undefined;

    if (!sl || sl[WRAPPER_MARKER] !== true) {
      // Rien à faire — pas notre installation.
      return { ok: true, installed: false };
    }

    const wrappedCommand = sl.wrappedCommand as string | undefined;
    if (wrappedCommand) {
      settings.statusLine = {
        type: 'command',
        command: wrappedCommand,
      };
    } else {
      delete settings.statusLine;
    }

    await writeClaudeSettings(settings);
    return { ok: true, installed: false };
  } catch (err) {
    return {
      ok: false,
      installed: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
