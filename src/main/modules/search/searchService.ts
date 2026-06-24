/**
 * Façade IPC du module Search (modes `/` et `vs` de la search bar).
 *
 * Expose 4 handlers :
 *  - `search:listVsCode`  : liste des workspaces VS Code récents
 *  - `search:listVs`      : liste des solutions Visual Studio scannées
 *  - `search:openVsCode`  : `code <path>` détaché
 *  - `search:openVs`      : `start "" <path>` (association de fichier)
 *
 * Spawn détaché pour les ouvertures : si WinNotch est fermé après le
 * lancement, l'éditeur cible reste vivant.
 */
import { ipcMain } from 'electron';
import { spawn } from 'child_process';
import { createHash } from 'node:crypto';
import { IpcChannel, type SearchResult } from '../../../shared/types';
import { listVsCodeWorkspaces } from './vscodeWorkspaces';
import { listVsSolutions } from './visualStudioSolutions';

/** Ops de hash autorisées pour `search:transform` (mode `;` de la search bar). */
const HASH_OPS = new Set(['md5', 'sha1', 'sha256', 'sha512']);

/**
 * Transforme une chaîne côté main — actuellement uniquement le hash (crypto
 * Node, indisponible côté renderer pour MD5). Digest hex minuscule.
 */
function transform(
  op: string,
  input: string,
): { ok: boolean; output?: string; error?: string } {
  try {
    if (HASH_OPS.has(op)) {
      return { ok: true, output: createHash(op).update(input, 'utf8').digest('hex') };
    }
    return { ok: false, error: `Opération inconnue : ${op}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function spawnDetached(
  file: string,
  args: string[],
  options: { useShell?: boolean } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(file, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        shell: options.useShell ?? false,
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
 * Ouvre un workspace VS Code via la CLI `code`.
 *
 * Important : chaque token (`code`, `-n`, path) est passé en arg
 * **séparé** à spawn. Sinon, concaténer `code "<path>"` en une seule
 * string puis la passer comme argument à `cmd /c` déclenche le quoting
 * MS C-runtime de Node qui réinjecte `\"`, que cmd ne reconnaît pas
 * comme échappement → un arg vide finit par traîner après le path et
 * VS Code l'interprète comme un fichier à ouvrir (bug "ouvre un nouveau
 * fichier nommé comme le dossier").
 *
 * `-n` force une nouvelle fenêtre — pour les workspaces multi-root
 * (.code-workspace), `code` détecte automatiquement le format à partir
 * de l'extension du fichier.
 */
async function openVsCode(
  path: string,
  kind: SearchResult['kind'],
): Promise<{ ok: boolean; error?: string }> {
  try {
    void kind;
    await spawnDetached('cmd.exe', ['/c', 'code', '-n', path]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Ouvre un .sln/.slnx via l'association de fichier Windows (qui pointe
 * vers Visual Studio s'il est installé). On utilise `cmd /c start`
 * avec un titre vide en 1er argument pour éviter que `start` ne le
 * confonde avec le chemin.
 */
async function openVs(path: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await spawnDetached('cmd.exe', ['/c', 'start', '""', path]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export function registerSearchIpc(): void {
  ipcMain.handle(IpcChannel.SearchListVsCode, () => {
    try {
      return listVsCodeWorkspaces();
    } catch (err) {
      console.warn('[search] listVsCodeWorkspaces failed:', err);
      return [];
    }
  });

  ipcMain.handle(IpcChannel.SearchListVs, async () => {
    try {
      return await listVsSolutions();
    } catch (err) {
      console.warn('[search] listVsSolutions failed:', err);
      return [];
    }
  });

  ipcMain.handle(
    IpcChannel.SearchOpenVsCode,
    async (_e, path: string, kind: SearchResult['kind']) => {
      return openVsCode(path, kind);
    },
  );

  ipcMain.handle(IpcChannel.SearchOpenVs, async (_e, path: string) => {
    return openVs(path);
  });

  ipcMain.handle(IpcChannel.SearchTransform, (_e, op: string, input: string) =>
    transform(op, input),
  );
}
