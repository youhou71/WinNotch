/**
 * Scan récursif des dossiers racines pour trouver les repos Git locaux.
 *
 * Règles :
 *  - on s'arrête dès qu'un `.git` est trouvé (pas de descente dans les
 *    submodules ni dans les sous-repos)
 *  - on ignore les dossiers cachés (basename commençant par `.`) en
 *    plus des `ignorePatterns` explicites
 *  - la comparaison `ignorePatterns` est case-insensitive (Windows)
 *  - les erreurs d'accès (EACCES, EPERM, etc.) sont silencieuses : on
 *    saute le dossier et on continue
 */
import { promises as fs } from 'fs';
import { join } from 'path';

const HARD_MAX_DEPTH = 6;

/**
 * Vérifie si un dossier contient un `.git`. Accepte aussi un fichier
 * `.git` (cas des worktrees Git, où `.git` est un texte `gitdir: …`).
 */
async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(join(dir, '.git'));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Walk récursif d'un dossier racine. Renvoie les chemins absolus des
 * repos trouvés. Ne lève jamais : retourne `[]` si la racine est
 * inaccessible.
 */
async function walk(
  dir: string,
  depthLeft: number,
  ignoreLower: Set<string>,
  out: string[],
): Promise<void> {
  if (depthLeft < 0) return;
  // Si on est dans un repo, on l'ajoute et on n'entre pas dedans.
  if (await isGitRepo(dir)) {
    out.push(dir);
    return;
  }
  if (depthLeft === 0) return;
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.startsWith('.')) continue;
    if (ignoreLower.has(name.toLowerCase())) continue;
    await walk(join(dir, name), depthLeft - 1, ignoreLower, out);
  }
}

/**
 * Scanne plusieurs racines en parallèle.
 *
 * `scanDepth` est plafonné à `HARD_MAX_DEPTH` (6) pour éviter qu'un slider
 * UI mal configuré ne lance un scan trop profond (ex. racine de C:).
 */
export async function scanForRepos(
  rootDirs: string[],
  scanDepth: number,
  ignorePatterns: string[],
): Promise<string[]> {
  const depth = Math.min(Math.max(1, scanDepth), HARD_MAX_DEPTH);
  const ignoreLower = new Set(
    ignorePatterns.map((p) => p.toLowerCase()).filter((p) => p.length > 0),
  );
  const results: string[][] = await Promise.all(
    rootDirs
      .map((d) => d.trim())
      .filter((d) => d.length > 0)
      .map(async (root) => {
        const found: string[] = [];
        await walk(root, depth, ignoreLower, found);
        return found;
      }),
  );
  // Dédup global (au cas où deux rootDirs se chevauchent).
  return [...new Set(results.flat())];
}
