/**
 * Gestion du démarrage automatique de WinNotch avec Windows via le
 * **Task Scheduler** (à la place de la Run key historique).
 *
 * Pourquoi pas la Run key ?
 * --------------------------
 * `app.setLoginItemSettings({ openAtLogin: true })` écrit dans
 * `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. Windows 10/11
 * applique alors son **Startup Delay** : 10 s fixes + jusqu'à 150 s
 * aléatoires selon le « Startup Impact » estimé. En pratique, beaucoup
 * d'utilisateurs voyaient le notch n'apparaître que 1–2 minutes après
 * l'ouverture de la session.
 *
 * Le Task Scheduler ne subit pas ce délai. Un trigger `AtLogOn` se
 * déclenche immédiatement à l'ouverture de session. La task reste visible
 * dans Task Manager → Démarrage (Windows 22H2+ liste aussi les tasks au
 * logon), mais sans le délai imposé.
 *
 * Pourquoi PowerShell et pas `schtasks.exe` ?
 * --------------------------------------------
 * `schtasks` est simple pour les cas basiques mais ses flags ligne de
 * commande ne suffisent pas pour régler proprement « autoriser sur
 * batterie », « ne pas s'arrêter en cas de bascule batterie », etc. Le
 * cmdlet `Register-ScheduledTask` est plus lisible et cohérent avec les
 * autres usages PowerShell du projet (cf. `vpnDetector.ts`,
 * `metricsReader.ts`).
 *
 * Idempotence : `Register-ScheduledTask -Force` remplace la task si elle
 * existe déjà. `Unregister-ScheduledTask` est tolérant à l'absence avec
 * `-ErrorAction SilentlyContinue`. `Get-ScheduledTask` retourne `null`
 * si absente.
 */
import { spawn } from 'child_process';
import { powershellExe } from '../shell/powershellPath';

/** Nom de la task créée dans le Task Scheduler. */
export const AUTOSTART_TASK_NAME = 'WinNotch';

const POWERSHELL_TIMEOUT_MS = 8000;

/**
 * Exécute un script PowerShell via `-EncodedCommand` (base64 UTF-16LE).
 * Pattern repris de `vpnDetector` et `metricsReader` : évite tous les
 * pièges d'échappement de quotes Windows. Retourne `{ stdout, code }` —
 * `null` en cas de timeout ou d'erreur de spawn.
 */
function runPowerShell(
  script: string,
): Promise<{ stdout: string; stderr: string; code: number | null } | null> {
  return new Promise((resolve) => {
    let resolved = false;
    let stdout = '';
    let stderr = '';
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn(
      powershellExe(),
      [
        '-NoProfile',
        '-NoLogo',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encoded,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try { child.kill(); } catch { /* déjà mort */ }
      resolve(null);
    }, POWERSHELL_TIMEOUT_MS);

    child.on('error', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve(null);
    });
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    child.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve({ stdout, stderr, code });
    });
  });
}

/**
 * Échappe une string pour l'inclure dans un script PowerShell entre
 * single quotes. Seul caractère à doubler en single-quoted PS : `'`.
 */
function psQuote(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Crée (ou remplace) la task de démarrage auto pour l'exe courant.
 *
 * Réglages choisis :
 *  - `AtLogOn` user courant : se déclenche à l'ouverture de session.
 *  - `LogonType Interactive` + `RunLevel Limited` : pas d'élévation,
 *    contexte utilisateur normal. Cohérent avec l'install per-user NSIS.
 *  - `AllowStartIfOnBatteries` + `DontStopIfGoingOnBatteries` : un
 *    laptop sur batterie au boot doit quand même voir le notch
 *    apparaître. L'utilisateur peut désactiver via Settings s'il
 *    préfère.
 *  - `StartWhenAvailable` : si le PC était endormi au moment du logon
 *    (cas peu probable mais possible), rattrape au réveil.
 *  - Pas de `ExecutionTimeLimit` : la task ne se termine pas (WinNotch
 *    tourne tant que l'utilisateur ne quit pas).
 */
export async function createAutostartTask(
  exePath: string,
): Promise<{ ok: boolean; error?: string }> {
  const script = `
$ErrorActionPreference = 'Stop'
try {
  $action = New-ScheduledTaskAction -Execute '${psQuote(exePath)}'
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet \`
    -AllowStartIfOnBatteries \`
    -DontStopIfGoingOnBatteries \`
    -StartWhenAvailable \`
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
  $principal = New-ScheduledTaskPrincipal \`
    -UserId $env:USERNAME \`
    -LogonType Interactive \`
    -RunLevel Limited
  Register-ScheduledTask \`
    -TaskName '${AUTOSTART_TASK_NAME}' \`
    -Action $action \`
    -Trigger $trigger \`
    -Settings $settings \`
    -Principal $principal \`
    -Force | Out-Null
  Write-Output 'OK'
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
  `.trim();

  const result = await runPowerShell(script);
  if (!result) {
    return { ok: false, error: 'PowerShell timeout' };
  }
  if (result.code !== 0) {
    return { ok: false, error: result.stderr.trim() || `PowerShell exit ${result.code}` };
  }
  return { ok: true };
}

/**
 * Supprime la task. Idempotent : `-ErrorAction SilentlyContinue` rend
 * l'appel safe même si la task n'existe pas.
 */
export async function removeAutostartTask(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Unregister-ScheduledTask -TaskName '${AUTOSTART_TASK_NAME}' -Confirm:$false | Out-Null
Write-Output 'OK'
  `.trim();
  const result = await runPowerShell(script);
  if (!result) {
    return { ok: false, error: 'PowerShell timeout' };
  }
  return { ok: true };
}

/**
 * Vérifie si la task est enregistrée. Retourne `false` si la task
 * n'existe pas, si PowerShell timeout, ou en cas d'erreur de spawn.
 */
export async function isAutostartTaskRegistered(): Promise<boolean> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$task = Get-ScheduledTask -TaskName '${AUTOSTART_TASK_NAME}'
if ($task) { Write-Output 'YES' } else { Write-Output 'NO' }
  `.trim();
  const result = await runPowerShell(script);
  if (!result) return false;
  return result.stdout.trim() === 'YES';
}
