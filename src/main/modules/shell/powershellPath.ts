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
 * On résout donc le **chemin absolu** via `%SystemRoot%` (toujours défini sur
 * Windows), avec repli sur `'powershell.exe'` (PATH) si le binaire n'est pas
 * trouvé là où attendu (édition exotique de Windows). Résultat mémoïsé.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

let cached: string | null = null;

export function powershellExe(): string {
  if (cached) return cached;
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const abs = join(
    root,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  cached = existsSync(abs) ? abs : 'powershell.exe';
  return cached;
}
