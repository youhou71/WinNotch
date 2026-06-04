/**
 * Gestion du démarrage automatique de WinNotch avec Windows via le
 * **Task Scheduler**, piloté par `schtasks.exe`.
 *
 * Pourquoi pas la Run key ?
 * --------------------------
 * `app.setLoginItemSettings({ openAtLogin: true })` écrit dans
 * `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, soumis au **Startup
 * Delay** de Windows 10/11 (10 s fixes + jusqu'à 150 s aléatoires). Le notch
 * n'apparaissait alors que 1–2 min après l'ouverture de session. Un trigger
 * Task Scheduler `AtLogOn` ne subit pas ce délai.
 *
 * Pourquoi `schtasks.exe` et pas PowerShell (`Register-ScheduledTask`) ?
 * ---------------------------------------------------------------------
 * `schtasks.exe` est un binaire Microsoft signé : il ne déclenche pas les
 * antivirus heuristiques, contrairement à `powershell.exe -EncodedCommand`
 * (base64 = signature d'obfuscation). Contrairement à une idée reçue,
 * `schtasks /Create /XML` permet de régler **tous** les paramètres fins
 * (démarrage sur batterie, pas d'arrêt en bascule batterie, etc.) via le
 * fichier XML — l'argument « il faut PowerShell pour ça » est faux.
 *
 * Idempotence : `/Create … /F` remplace la task existante.
 * `/Delete … /F` est silencieux. `/Query` renvoie un code non nul si absente.
 */
import { execFile } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

/** Nom de la task créée dans le Task Scheduler. */
export const AUTOSTART_TASK_NAME = 'WinNotch';

const SCHTASKS_TIMEOUT_MS = 8000;

/** Résultat brut d'un appel `schtasks.exe`. */
interface SchtasksResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Issue d'une opération de gestion de la task (create/remove). */
type AutostartResult = { ok: boolean; error?: string };

/**
 * Exécute `schtasks.exe` avec les arguments donnés. Retourne `{ stdout, stderr,
 * code }`, ou `null` en cas de timeout / spawn impossible. Ne rejette jamais.
 */
function runSchtasks(args: string[]): Promise<SchtasksResult | null> {
  return new Promise((resolve) => {
    execFile(
      'schtasks.exe',
      args,
      { windowsHide: true, timeout: SCHTASKS_TIMEOUT_MS },
      (err, stdout, stderr) => {
        const e = err as (Error & { killed?: boolean; code?: number | string }) | null;
        if (e?.killed) {
          resolve(null); // timeout : process tué
          return;
        }
        // e.code = code de sortie (number) pour un exit non nul, ou une string
        // ('ENOENT') si schtasks.exe est introuvable.
        const rawCode = e?.code;
        const code = typeof rawCode === 'number' ? rawCode : e ? 1 : 0;
        resolve({ stdout: String(stdout), stderr: String(stderr), code });
      },
    );
  });
}

/** Échappe une chaîne pour l'insérer dans le XML de tâche. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Identifiant de l'utilisateur courant pour le XML (`DOMAIN\User` si le
 * domaine est connu, sinon le nom seul — suffisant pour un trigger AtLogOn
 * per-user, comme le faisait l'ancien `-User $env:USERNAME`).
 */
function currentUserId(): string {
  const user = process.env.USERNAME ?? '';
  const domain = process.env.USERDOMAIN ?? '';
  return domain && user ? `${domain}\\${user}` : user;
}

/**
 * Construit le XML d'une tâche planifiée reproduisant les réglages de l'ancien
 * `Register-ScheduledTask` :
 *  - `LogonTrigger` user courant : déclenchement immédiat à l'ouverture de session.
 *  - `InteractiveToken` + `LeastPrivilege` : contexte utilisateur normal, pas
 *    d'élévation (cohérent avec l'install per-user NSIS, pas de mot de passe stocké).
 *  - `DisallowStartIfOnBatteries=false` + `StopIfGoingOnBatteries=false` : un
 *    laptop sur batterie au boot voit quand même le notch apparaître.
 *  - `StartWhenAvailable=true` : rattrape si le PC était endormi au logon.
 *  - `ExecutionTimeLimit=PT0S` : la task ne se termine pas (WinNotch tourne
 *    tant que l'utilisateur ne quit pas).
 *
 * ⚠️ NE PAS ajouter `<UseUnifiedSchedulingEngine>` ni
 * `<DisallowStartOnRemoteAppSession>` : ces nœuds appartiennent au schéma Task
 * Scheduler **1.3**. Avec `version="1.2"`, `schtasks /Create /XML` les rejette
 * (« nœud inattendu ») et **toute la création échoue**. (Bug corrigé en v1.4.1.)
 */
function buildTaskXml(exePath: string): string {
  const user = xmlEscape(currentUserId());
  const command = xmlEscape(`"${exePath}"`);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Démarre WinNotch à l'ouverture de session.</Description>
    <URI>\\${AUTOSTART_TASK_NAME}</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${user}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${command}</Command>
    </Exec>
  </Actions>
</Task>`;
}

/**
 * Crée (ou remplace) la task de démarrage auto pour l'exe courant.
 *
 * Le XML est écrit dans un fichier temporaire **encodé en UTF-16LE + BOM** —
 * `schtasks /Create /XML` est capricieux sur l'encodage et attend de l'UTF-16
 * conforme à la déclaration `encoding="UTF-16"`.
 */
export async function createAutostartTask(
  exePath: string,
): Promise<AutostartResult> {
  const tmpFile = join(tmpdir(), `winnotch-task-${randomUUID()}.xml`);
  try {
    // Écrit l'XML en UTF-16 LE préfixé du BOM (0xFF 0xFE) attendu par
    // `schtasks /XML` — BOM en octets explicites plutôt qu'un U+FEFF invisible.
    const xmlBuf = Buffer.from(buildTaskXml(exePath), 'utf16le');
    writeFileSync(tmpFile, Buffer.concat([Buffer.from([0xff, 0xfe]), xmlBuf]));
    const result = await runSchtasks([
      '/Create',
      '/TN',
      AUTOSTART_TASK_NAME,
      '/XML',
      tmpFile,
      '/F',
    ]);
    if (!result) return { ok: false, error: 'schtasks timeout' };
    if (result.code !== 0) {
      return {
        ok: false,
        error: result.stderr.trim() || result.stdout.trim() || `schtasks exit ${result.code}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      /* déjà absent */
    }
  }
}

/**
 * Supprime la task. Idempotent : un code non nul (task absente) est ignoré.
 */
export async function removeAutostartTask(): Promise<AutostartResult> {
  const result = await runSchtasks(['/Delete', '/TN', AUTOSTART_TASK_NAME, '/F']);
  if (!result) return { ok: false, error: 'schtasks timeout' };
  return { ok: true };
}

/**
 * Vérifie si la task est enregistrée. Retourne `false` si la task n'existe
 * pas (exit non nul), si schtasks timeout, ou en cas d'erreur de spawn.
 */
export async function isAutostartTaskRegistered(): Promise<boolean> {
  const result = await runSchtasks(['/Query', '/TN', AUTOSTART_TASK_NAME]);
  if (!result) return false;
  return result.code === 0;
}
