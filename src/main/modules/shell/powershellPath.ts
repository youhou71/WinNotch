/**
 * Résolution du chemin de `powershell.exe`.
 *
 * Spawn via `'powershell.exe'` (résolution par le PATH) échoue parfois dans
 * le process Electron avec `ENOENT` : le PATH hérité par le main peut ne pas
 * contenir `…\System32\WindowsPowerShell\v1.0` selon la façon dont l'app est
 * lancée (double-clic, IDE, launcher qui assainit l'environnement). Le shell
 * de l'utilisateur, lui, l'a — d'où une erreur déroutante « ça marche en
 * terminal mais pas dans l'app ».
 *
 * On résout donc un **chemin absolu** en testant plusieurs racines candidates
 * et en gardant la première dont le binaire existe réellement, avec repli
 * final sur `'powershell.exe'` (PATH). Subtilité Windows : certains dossiers
 * ont la **sensibilité à la casse** activée (machines avec WSL) → `C:\Windows`
 * ≠ `C:\WINDOWS`. On essaie donc les deux casses + les variables d'env (qui
 * portent la casse réelle du système). Résultat mémoïsé.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SUFFIX = ['System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'];

let cached: string | null = null;

export function powershellExe(): string {
  if (cached) return cached;

  const drive = process.env.SystemDrive || 'C:';
  const roots = [
    process.env.SystemRoot,
    process.env.windir,
    `${drive}\\WINDOWS`,
    `${drive}\\Windows`,
    'C:\\WINDOWS',
    'C:\\Windows',
  ];

  for (const root of roots) {
    if (!root) continue;
    const abs = join(root, ...SUFFIX);
    if (existsSync(abs)) {
      cached = abs;
      return cached;
    }
  }

  // Dernier recours : résolution par le PATH (peut échouer en ENOENT, mais
  // les appelants ont tous un handler 'error' qui dégrade proprement).
  cached = 'powershell.exe';
  return cached;
}
