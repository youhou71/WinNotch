/**
 * Process PowerShell **persistant** mutualisé.
 *
 * Pourquoi : sur certaines machines (corporate + antivirus qui scanne chaque
 * lancement, init CIM/WMI lente), un `powershell.exe` à froid coûte ~4 s et
 * le premier appel à `Get-NetAdapter` / `Get-VpnConnection` déclenche un
 * autoload de modules CDXML de plusieurs secondes. Spawner un powershell.exe
 * par tick (VPN toutes les 10 s, Système toutes les 1 s) repaye ce coût à
 * chaque fois → timeouts permanents (cas réel observé : script VPN à 11,7 s
 * pour un timeout de 8 s).
 *
 * Solution : un seul powershell.exe long-running, qui charge ses modules une
 * fois (premier tick lent ~quelques secondes), puis exécute les scripts
 * suivants en quelques millisecondes (CIM/modules déjà chauds dans le
 * process). Partagé par les modules VPN et Système.
 *
 * Protocole (1 ligne in → 1 ligne out, base64 pour éviter tout souci de
 * quoting/newline) :
 *   - Node écrit sur stdin : `<id> <base64(script UTF-8)>\n`
 *   - le boucleur PS exécute le script et écrit sur stdout une enveloppe JSON
 *     compacte : `{"id":"<id>","ok":true,"out":"<base64(sortie UTF-8)>"}`
 *     (ou `"ok":false,"err":"<base64(message)>"`).
 *
 * Le process est relancé automatiquement au prochain appel s'il meurt ou si
 * une requête dépasse son délai (un cmdlet réellement bloqué).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { powershellExe } from './powershellPath';

/**
 * Boucle lue par le powershell.exe persistant. Passée en `-EncodedCommand`
 * (base64 UTF-16LE) pour être insensible au quoting. `$ProgressPreference`
 * coupe le flux de progression (sinon CLIXML sur stderr lors de l'autoload).
 */
const BOOTSTRAP = [
  "$ProgressPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'while ($true) {',
  '  $line = [Console]::In.ReadLine()',
  '  if ($null -eq $line) { break }',
  '  if ($line.Length -eq 0) { continue }',
  "  $sp = $line.IndexOf(' ')",
  '  if ($sp -lt 0) { continue }',
  '  $id = $line.Substring(0, $sp)',
  '  $b64 = $line.Substring($sp + 1)',
  '  try {',
  '    $code = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))',
  '    $res = & ([scriptblock]::Create($code))',
  '    $text = [string]$res',
  '    $o = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text))',
  '    [Console]::Out.WriteLine(\'{"id":"\' + $id + \'","ok":true,"out":"\' + $o + \'"}\')',
  '  } catch {',
  '    $e = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([string]$_.Exception.Message))',
  '    [Console]::Out.WriteLine(\'{"id":"\' + $id + \'","ok":false,"err":"\' + $e + \'"}\')',
  '  }',
  '}',
].join('\n');

export interface PsResult {
  /** Sortie stdout du script (chaîne vide si rien). */
  stdout: string;
  /** Message d'erreur, ou `null` si succès. */
  error: string | null;
}

interface Pending {
  resolve: (r: PsResult) => void;
  timer: NodeJS.Timeout;
}

let proc: ChildProcessWithoutNullStreams | null = null;
let stdoutBuf = '';
let seq = 0;
let stopped = false;
const pending = new Map<string, Pending>();

/** Tue le process (le cas échéant), vide la file en résolvant en erreur. */
function resetProc(reason: string): void {
  for (const [id, pend] of pending) {
    clearTimeout(pend.timer);
    pend.resolve({ stdout: '', error: reason });
    pending.delete(id);
  }
  if (proc) {
    try {
      proc.removeAllListeners();
      proc.kill();
    } catch {
      /* déjà mort */
    }
    proc = null;
  }
  stdoutBuf = '';
}

function onStdout(chunk: string): void {
  stdoutBuf += chunk;
  let nl: number;
  while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
    const line = stdoutBuf.slice(0, nl).trim();
    stdoutBuf = stdoutBuf.slice(nl + 1);
    if (!line) continue;
    let env: { id?: string; ok?: boolean; out?: string; err?: string };
    try {
      env = JSON.parse(line) as typeof env;
    } catch {
      continue; // ligne parasite (ne devrait pas arriver)
    }
    if (!env.id) continue;
    const pend = pending.get(env.id);
    if (!pend) continue;
    pending.delete(env.id);
    clearTimeout(pend.timer);
    if (env.ok) {
      pend.resolve({
        stdout: Buffer.from(env.out ?? '', 'base64').toString('utf8'),
        error: null,
      });
    } else {
      pend.resolve({
        stdout: '',
        error:
          Buffer.from(env.err ?? '', 'base64').toString('utf8') ||
          'erreur PowerShell',
      });
    }
  }
}

function encodeUtf16(s: string): string {
  return Buffer.from(s, 'utf16le').toString('base64');
}

/** Démarre le process si besoin. Retourne null si le spawn échoue. */
function ensureProc(): ChildProcessWithoutNullStreams | null {
  if (proc) return proc;
  if (stopped) return null;
  let p: ChildProcessWithoutNullStreams;
  try {
    p = spawn(
      powershellExe(),
      [
        '-NoProfile',
        '-NoLogo',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encodeUtf16(BOOTSTRAP),
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
  } catch {
    return null;
  }
  proc = p;
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', onStdout);
  // stderr = progression d'autoload / warnings : ignoré (jamais nos données).
  p.stderr.on('data', () => {});
  p.on('error', (err) => resetProc(`PowerShell: ${err.message}`));
  p.on('exit', (code) => resetProc(`PowerShell terminé (code=${code})`));
  return p;
}

/**
 * Exécute `script` dans le process PowerShell persistant et résout sa sortie
 * stdout. En cas d'échec (spawn impossible, process mort, timeout), résout
 * `{ stdout: '', error }` — ne rejette jamais.
 *
 * `timeoutMs` doit être **généreux** : le tout premier appel paie l'autoload
 * des modules (plusieurs secondes). Les appels suivants sont quasi instantanés.
 * Sur timeout, le process est tué + relancé pour ne pas bloquer la file.
 */
export function runPersistentPowershell(
  script: string,
  timeoutMs: number,
): Promise<PsResult> {
  return new Promise((resolve) => {
    const p = ensureProc();
    if (!p || !p.stdin.writable) {
      resolve({ stdout: '', error: 'PowerShell indisponible' });
      return;
    }
    const id = `r${++seq}`;
    const timer = setTimeout(() => {
      // Requête dépassée = cmdlet probablement bloqué. On relance tout le
      // process (resetProc résout aussi les requêtes en file).
      resetProc(`timeout (${timeoutMs} ms)`);
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    try {
      p.stdin.write(`${id} ${Buffer.from(script, 'utf8').toString('base64')}\n`);
    } catch (err) {
      pending.delete(id);
      clearTimeout(timer);
      resolve({
        stdout: '',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

/** Coupe le process persistant (appelé à la fermeture de l'app). */
export function stopPersistentPowershell(): void {
  stopped = true;
  resetProc('arrêt de l\'application');
}
