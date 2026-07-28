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
import { psScriptPath } from './psScriptPath';

// La boucle exécutée par le process persistant vit dans le script embarqué
// `resources/ps/persistent-loop.ps1`, lancé via `-File` (cf. ensureProc).
// On évite ainsi `-EncodedCommand` (base64) dans la ligne de commande, que les
// antivirus heuristiques signalent comme de l'obfuscation. Le protocole stdin
// (1 ligne par requête, script en base64) reste interne au pipe — jamais dans
// la ligne de commande, donc invisible aux scanners.

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

/**
 * `resetProc` filtré sur l'identité du process émetteur.
 *
 * Les événements d'un process *déjà remplacé* arrivent en retard (un EPIPE
 * tardif sur le stdin de l'ancien pipe, un `exit` traité après le respawn) :
 * les router vers `resetProc` tuerait le process courant, parfaitement sain.
 * Le garde rend donc chaque handler inoffensif dès que `proc` a changé — et
 * c'est pour cela que `resetProc` ne détache PAS les listeners de `stdin` :
 * ils doivent rester en place pour continuer à absorber les EPIPE tardifs
 * plutôt que de les laisser remonter en `uncaughtException`.
 */
function resetProcFor(
  emitter: ChildProcessWithoutNullStreams,
  reason: string,
): void {
  if (proc !== emitter) return;
  resetProc(reason);
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
        // RemoteSigned (et non Bypass) : autorise un .ps1 local non signé sans
        // Mark-of-the-Web (cas des fichiers extraits par l'installeur), tout en
        // étant bien moins alarmant qu'un Bypass pour les antivirus.
        '-ExecutionPolicy',
        'RemoteSigned',
        '-File',
        psScriptPath('persistent-loop.ps1'),
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
  // stdin SANS handler d'erreur = crash de l'app. `write()` sur un pipe dont
  // l'autre bout est mort ne lève rien de synchrone : l'EPIPE est émis sur le
  // stream *après* le retour de `write()` (d'où `afterWriteDispatched` en tête
  // de pile), donc le try/catch de `runPersistentPowershell` ne peut pas
  // l'attraper. Sans listener, le stream escalade en `uncaughtException` →
  // dialogue Electron « A JavaScript error occurred in the main process » et
  // l'app entière est perdue pour une requête WMI lente.
  //
  // La fenêtre de tir est réelle : trois modules (Système 1 Hz, Confidentialité
  // 4 s, VPN 10 s) partagent ce process. Le timeout de l'un déclenche
  // `resetProc` → `kill()`, et une écriture d'un autre module peut partir avant
  // que l'événement `exit` n'ait été traité par l'event loop (`stdin.writable`
  // est alors encore `true`, le garde de `runPersistentPowershell` ne voit rien).
  // L'EDR peut aussi tuer le process de son côté. Ici on absorbe : la requête
  // en vol est résolue en erreur par `resetProc` et le tick suivant respawn.
  p.stdin.on('error', (err) => resetProcFor(p, `PowerShell stdin: ${err.message}`));
  p.on('error', (err) => resetProcFor(p, `PowerShell: ${err.message}`));
  p.on('exit', (code) => resetProcFor(p, `PowerShell terminé (code=${code})`));
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
    if (!p) {
      resolve({ stdout: '', error: 'PowerShell indisponible' });
      return;
    }
    if (!p.stdin.writable) {
      // Pipe déjà fermé alors que le process n'a pas (encore) émis `exit` : sans
      // ce reset, `proc` resterait accroché à un process inutilisable et TOUS
      // les appels suivants échoueraient en « PowerShell indisponible » jusqu'au
      // redémarrage de l'app (modules Système / Confidentialité / VPN figés).
      resetProcFor(p, 'PowerShell: stdin fermé');
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
