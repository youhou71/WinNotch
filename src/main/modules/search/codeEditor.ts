/**
 * Détection de l'éditeur de code installé (famille VS Code).
 *
 * WinNotch supposait VS Code : dossier de données `%APPDATA%/Code` et CLI
 * `code`. Les forks (VSCodium, Cursor, Windsurf, Insiders) utilisent le même
 * format de `workspaceStorage` mais un autre dossier et une autre CLI — le
 * mode `/` renvoyait donc une liste vide, et l'ouverture échouait
 * silencieusement (`code` absent du PATH).
 *
 * Sélection : parmi les candidats du catalogue, on garde ceux dont le
 * `workspaceStorage` contient au moins un workspace, puis on retient le plus
 * récemment utilisé. C'est volontairement une comparaison de récence et non
 * un ordre fixe : quelqu'un qui a migré de VS Code vers VSCodium garde un
 * `%APPDATA%/Code` peuplé mais mort, et un ordre fixe le choisirait à vie.
 * Si aucun candidat n'a de données (installation neuve), on retombe sur le
 * premier dont l'exécutable existe — l'ouverture marche, la liste est juste
 * vide tant que rien n'a été ouvert.
 *
 * Lancement : on privilégie l'exécutable en chemin absolu plutôt que la CLI
 * via `cmd /c`. La CLI n'est dans le PATH que si l'utilisateur a coché
 * l'option à l'installation, et un chemin absolu vers un `.cmd` passé à
 * `cmd /c` réveille le quoting MS C-runtime de Node (cf. `resolveEditorLaunch`).
 * Un `.exe` se lance directement par `spawn`, sans shell ni échappement.
 * Repli sur `cmd /c <cli>` si aucun exe connu n'est trouvé.
 */
import { promises as fs } from 'fs';
import { join } from 'path';

interface EditorCandidate {
  id: string;
  label: string;
  /** Nom du dossier de données sous `%APPDATA%`. */
  appDataDir: string;
  /** Nom de la CLI, utilisé en repli via le PATH. */
  cli: string;
  /**
   * Emplacements d'installation connus, `%VAR%` interpolés à la résolution.
   * Testés dans l'ordre ; le premier existant gagne.
   */
  exeCandidates: string[];
}

/**
 * Catalogue des éditeurs reconnus. L'ordre ne sert qu'à départager une
 * égalité de récence (cf. en-tête) — VS Code d'abord car le plus répandu.
 */
const CANDIDATES: EditorCandidate[] = [
  {
    id: 'vscode',
    label: 'VS Code',
    appDataDir: 'Code',
    cli: 'code',
    exeCandidates: [
      '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe',
      '%PROGRAMFILES%\\Microsoft VS Code\\Code.exe',
      '%PROGRAMFILES(X86)%\\Microsoft VS Code\\Code.exe',
    ],
  },
  {
    id: 'vscode-insiders',
    label: 'VS Code Insiders',
    appDataDir: 'Code - Insiders',
    cli: 'code-insiders',
    exeCandidates: [
      '%LOCALAPPDATA%\\Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe',
      '%PROGRAMFILES%\\Microsoft VS Code Insiders\\Code - Insiders.exe',
    ],
  },
  {
    id: 'vscodium',
    label: 'VSCodium',
    appDataDir: 'VSCodium',
    cli: 'codium',
    exeCandidates: [
      '%PROGRAMFILES%\\VSCodium\\VSCodium.exe',
      '%LOCALAPPDATA%\\Programs\\VSCodium\\VSCodium.exe',
    ],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    appDataDir: 'Cursor',
    cli: 'cursor',
    exeCandidates: [
      '%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe',
      '%PROGRAMFILES%\\cursor\\Cursor.exe',
    ],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    appDataDir: 'Windsurf',
    cli: 'windsurf',
    exeCandidates: [
      '%LOCALAPPDATA%\\Programs\\Windsurf\\Windsurf.exe',
      '%PROGRAMFILES%\\Windsurf\\Windsurf.exe',
    ],
  },
];

export interface DetectedEditor {
  id: string;
  /** Nom affichable (chip de la search bar, toasts, logs). */
  label: string;
  /** `%APPDATA%/<dir>/User/workspaceStorage`, ou `null` si `APPDATA` manque. */
  workspaceStorageDir: string | null;
  /** Exécutable en chemin absolu, ou `null` si introuvable (→ repli CLI). */
  exePath: string | null;
  /** Nom de la CLI, pour le repli `cmd /c <cli>`. */
  cli: string;
}

/**
 * TTL de la détection. Assez court pour capter une installation faite pendant
 * que WinNotch tourne, assez long pour ne pas re-stat à chaque refresh de
 * cache (le scan des workspaces tourne toutes les 30 s).
 */
const DETECT_TTL_MS = 5 * 60_000;

let cache: { at: number; editor: DetectedEditor } | null = null;

/** Interpole les `%VAR%` d'un chemin ; `null` si une variable est absente. */
function expandEnv(path: string): string | null {
  let missing = false;
  const out = path.replace(/%([^%]+)%/g, (_, name: string) => {
    const value = process.env[name];
    if (!value) {
      missing = true;
      return '';
    }
    return value;
  });
  return missing ? null : out;
}

function storageDirOf(candidate: EditorCandidate): string | null {
  const appData = process.env['APPDATA'];
  if (!appData) return null;
  return join(appData, candidate.appDataDir, 'User', 'workspaceStorage');
}

/** Premier exécutable existant parmi les emplacements connus. */
async function findExe(candidate: EditorCandidate): Promise<string | null> {
  for (const raw of candidate.exeCandidates) {
    const path = expandEnv(raw);
    if (!path) continue;
    try {
      await fs.access(path);
      return path;
    } catch {
      // Emplacement non utilisé par cette installation — on continue.
    }
  }
  return null;
}

/**
 * Nombre de workspaces connus et date du plus récent, pour un
 * `workspaceStorage` donné. `count: 0` = éditeur jamais utilisé (ou absent).
 */
async function storageActivity(
  dir: string | null,
): Promise<{ count: number; mtimeMs: number }> {
  if (!dir) return { count: 0, mtimeMs: 0 };
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { count: 0, mtimeMs: 0 };
  }
  const dirs = entries.filter((e) => e.isDirectory());
  let mtimeMs = 0;
  await Promise.all(
    dirs.map(async (d) => {
      try {
        const st = await fs.stat(join(dir, d.name));
        if (st.mtimeMs > mtimeMs) mtimeMs = st.mtimeMs;
      } catch {
        // Dossier disparu entre readdir et stat — sans effet sur le max.
      }
    }),
  );
  return { count: dirs.length, mtimeMs };
}

function toDetected(
  candidate: EditorCandidate,
  exePath: string | null,
): DetectedEditor {
  return {
    id: candidate.id,
    label: candidate.label,
    workspaceStorageDir: storageDirOf(candidate),
    exePath,
    cli: candidate.cli,
  };
}

/**
 * Éditeur retenu pour ce poste. Résultat mis en cache `DETECT_TTL_MS` ; un
 * échec total (aucun éditeur trouvé) n'est pas mis en cache pour qu'une
 * installation faite entre-temps soit captée sans redémarrer WinNotch.
 */
export async function detectCodeEditor(): Promise<DetectedEditor> {
  if (cache && Date.now() - cache.at < DETECT_TTL_MS) return cache.editor;

  const probed = await Promise.all(
    CANDIDATES.map(async (candidate) => ({
      candidate,
      exePath: await findExe(candidate),
      activity: await storageActivity(storageDirOf(candidate)),
    })),
  );

  // 1. Éditeurs réellement utilisés, le plus récent gagne. `>` (et non `>=`)
  //    préserve l'ordre du catalogue en cas d'égalité.
  let best: (typeof probed)[number] | null = null;
  for (const p of probed) {
    if (p.activity.count === 0) continue;
    if (!best || p.activity.mtimeMs > best.activity.mtimeMs) best = p;
  }
  // 2. Sinon, le premier installé (liste vide mais ouverture fonctionnelle).
  if (!best) best = probed.find((p) => p.exePath !== null) ?? null;

  if (!best) {
    // Rien de détecté : on rend VS Code + CLI nue, comportement historique.
    return toDetected(CANDIDATES[0], null);
  }

  const editor = toDetected(best.candidate, best.exePath);
  cache = { at: Date.now(), editor };
  return editor;
}

/** `%APPDATA%/<éditeur>/User/workspaceStorage` de l'éditeur retenu. */
export async function resolveWorkspaceStorageDir(): Promise<string | null> {
  return (await detectCodeEditor()).workspaceStorageDir;
}

/**
 * Commande d'ouverture d'un dossier / `.code-workspace` dans l'éditeur
 * retenu, prête pour `spawn`. `-n` force une nouvelle fenêtre ; le format
 * (dossier ou workspace multi-root) est déduit par l'éditeur de l'extension
 * du chemin.
 *
 * Chaque token reste un argument **séparé** : concaténer puis passer à
 * `cmd /c` déclenche le quoting MS C-runtime de Node, qui réinjecte des `\"`
 * que cmd ne reconnaît pas comme échappement — un argument vide finit par
 * traîner après le chemin et l'éditeur l'interprète comme un fichier à ouvrir.
 */
export async function resolveEditorLaunch(
  path: string,
): Promise<{ file: string; args: string[]; label: string }> {
  const editor = await detectCodeEditor();
  if (editor.exePath) {
    return { file: editor.exePath, args: ['-n', path], label: editor.label };
  }
  return {
    file: 'cmd.exe',
    args: ['/c', editor.cli, '-n', path],
    label: editor.label,
  };
}
