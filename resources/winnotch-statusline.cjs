#!/usr/bin/env node
/**
 * WinNotch statusline wrapper pour Claude Code.
 *
 * Claude Code invoque le binaire désigné par `statusLine.command` dans
 * `~/.claude/settings.json` à chaque turn, en lui passant sur stdin un
 * JSON décrivant l'état courant de la session — dont, depuis la v1.2.80,
 * un sous-objet `rate_limits` avec les pourcentages d'usage et les
 * timestamps de reset pour les fenêtres 5h et 7d.
 *
 * Ce wrapper :
 *  1. lit le JSON sur stdin
 *  2. en extrait les rate_limits et les écrit dans
 *     `~/.claude/winnotch-usage.json` (atomically, via rename)
 *  3. écrit sur stdout une statusline minimale lisible
 *
 * Si l'utilisateur avait déjà un statusline custom, le module
 * `statuslineInstaller.ts` configure WinNotch en mode wrap : on stocke
 * la commande d'origine et on l'invoque ici à la suite, en transmettant
 * son stdout au stdout de Claude Code.
 *
 * Aucune dépendance npm — script destiné à être bundlé tel quel dans
 * `resources/` et copié vers `userData/` à l'install.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const HOME = os.homedir();
const OUT_FILE = path.join(HOME, '.claude', 'winnotch-usage.json');
const LOG_FILE = path.join(HOME, '.claude', 'winnotch-statusline.log');

/**
 * Petit log de diagnostic — une ligne par invocation. Utile pour vérifier
 * que Claude Code appelle bien le wrapper, et avec quel payload. Conserve
 * uniquement les 50 dernières lignes pour ne pas grossir indéfiniment.
 */
function appendLog(line) {
  try {
    const stamp = new Date().toISOString();
    let existing = '';
    try {
      existing = fs.readFileSync(LOG_FILE, 'utf8');
    } catch {
      existing = '';
    }
    const lines = (existing + `${stamp} ${line}\n`).trim().split('\n');
    const trimmed = lines.slice(-50).join('\n') + '\n';
    fs.writeFileSync(LOG_FILE, trimmed, 'utf8');
  } catch {
    // log best-effort, ne casse jamais la session Claude
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
    // Timeout de sécurité : si stdin reste vide 1500 ms, on relâche.
    setTimeout(() => resolve(buf), 1500);
  });
}

function atomicWriteJson(file, payload) {
  try {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    fs.renameSync(tmp, file);
  } catch {
    // Best-effort : si on ne peut pas écrire, on ne casse pas la session
    // Claude Code. WinNotch retombera sur le fallback jsonl parser.
  }
}

function buildOwnStatusline(input) {
  // Retourne une statusline lisible "à la défaut" si on n'a pas de
  // wrapper utilisateur. Reste très minimal pour ne pas surprendre.
  if (input && input.workspace && input.workspace.current_dir) {
    return `📁 ${path.basename(input.workspace.current_dir)}`;
  }
  return '';
}

async function main() {
  const raw = await readStdin();
  let input = null;
  try {
    input = raw ? JSON.parse(raw) : null;
  } catch (err) {
    input = null;
    appendLog(`parse-error ${err && err.message ? err.message : 'unknown'}`);
  }

  if (input && input.rate_limits) {
    atomicWriteJson(OUT_FILE, {
      capturedAt: Date.now(),
      rate_limits: input.rate_limits,
      session_id: input.session_id ?? null,
      model: (input.model && input.model.id) || null,
    });
    appendLog(`ok rate_limits keys=${Object.keys(input.rate_limits).join(',')}`);
  } else if (input) {
    // Le payload existe mais ne contient pas de rate_limits — on logue
    // les clés top-level pour permettre d'ajuster le statuslineReader
    // si Anthropic renomme un champ.
    appendLog(`no-rate-limits top-keys=${Object.keys(input).slice(0, 10).join(',')}`);
  } else {
    appendLog(`empty-stdin (rawLen=${raw ? raw.length : 0})`);
  }

  // Wrap-mode : si une commande utilisateur d'origine est passée en arg,
  // on l'invoque avec le même stdin et on relaie son stdout.
  const wrappedCmd = process.env.WINNOTCH_WRAPPED_STATUSLINE;
  if (wrappedCmd && wrappedCmd.trim()) {
    try {
      const child = spawnSync(wrappedCmd, {
        input: raw,
        shell: true,
        encoding: 'utf8',
        timeout: 2000,
      });
      const out = (child.stdout || '').trimEnd();
      if (out) {
        process.stdout.write(out);
        return;
      }
    } catch {
      // ignore — on retombe sur la statusline par défaut
    }
  }

  process.stdout.write(buildOwnStatusline(input));
}

void main();
