/**
 * Détecteur d'application en plein écran sur l'écran principal.
 *
 * Stratégie : un process PowerShell long-running poll `GetForegroundWindow`
 * + `GetWindowRect` toutes les ~750 ms et écrit les bounds sur stdout.
 * Node lit chaque ligne, compare aux bounds du primary display (via
 * `screen.getPrimaryDisplay().bounds`) et émet `shell:fullscreenChange`
 * au renderer si l'état bascule.
 *
 * Pourquoi un PS long-running plutôt que `execFile` à chaque tick :
 *  - Spawn PowerShell coûte 150-300 ms et ~5% CPU
 *  - Un seul spawn au boot + read de lignes via pipe = ~0% CPU au repos
 *
 * Pourquoi 750 ms : compromis entre réactivité (l'utilisateur passe en
 * fullscreen → le notch disparaît rapidement) et coût (peu de wake-ups).
 *
 * Détection :
 *  - "fullscreen" = la fenêtre foreground couvre **exactement** les
 *    bounds (pas workArea) du primary display
 *  - Tolérance ±2 px sur chaque bord pour gérer les arrondis DPI
 *  - On exclut notre propre fenêtre (sinon expanded déclencherait)
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { screen } from 'electron';
import { IpcChannel } from '../../../shared/types';
import { powershellExe } from './powershellPath';
import { getNotchWindow } from '../../window/notchWindow';

const POLL_INTERVAL_MS = 750;
/** Marge tolérée sur chaque bord (DPI, ombres, etc.). */
const EDGE_TOLERANCE_PX = 2;

let psProcess: ChildProcessWithoutNullStreams | null = null;
let lastEmitted: boolean | null = null;

/**
 * Script PowerShell qui définit le P/Invoke et boucle en émettant
 * "x,y,w,h,pid" sur chaque tick. Le timestamp implicite (ordre des
 * lignes) suffit, pas besoin de l'inclure.
 */
const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
while ($true) {
  $h = [W]::GetForegroundWindow()
  if ($h -ne [IntPtr]::Zero) {
    $r = New-Object RECT
    if ([W]::GetWindowRect($h, [ref]$r)) {
      # $pid est une variable réservée PowerShell (read-only, PID du
      # process PS courant). On utilise $winPid pour le PID de la
      # fenêtre foreground.
      $winPid = [uint32]0
      [void][W]::GetWindowThreadProcessId($h, [ref]$winPid)
      Write-Output "$($r.Left),$($r.Top),$($r.Right),$($r.Bottom),$winPid"
    }
  }
  [System.Console]::Out.Flush()
  Start-Sleep -Milliseconds ${POLL_INTERVAL_MS}
}
`;

/**
 * Compare deux rectangles avec une marge de tolérance.
 * Retourne true si `inner` ≈ `outer` sur les 4 bords.
 */
function rectsMatch(
  inner: { x: number; y: number; w: number; h: number },
  outer: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    Math.abs(inner.x - outer.x) <= EDGE_TOLERANCE_PX &&
    Math.abs(inner.y - outer.y) <= EDGE_TOLERANCE_PX &&
    Math.abs(inner.x + inner.w - (outer.x + outer.width)) <= EDGE_TOLERANCE_PX &&
    Math.abs(inner.y + inner.h - (outer.y + outer.height)) <= EDGE_TOLERANCE_PX
  );
}

function emit(fullscreen: boolean): void {
  if (lastEmitted === fullscreen) return;
  lastEmitted = fullscreen;
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.ShellFullscreenChange, fullscreen);
}

function handleLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  const parts = trimmed.split(',');
  if (parts.length < 5) return;
  const [l, t, r, b, pidStr] = parts.map((s) => Number(s));
  if (![l, t, r, b].every(Number.isFinite)) return;

  // On ignore notre propre process : si l'utilisateur passe le notch
  // en expanded sur primary display, on ne veut pas se masquer
  // nous-mêmes (de toute façon le mode expanded n'est pas concerné,
  // c'est un filet supplémentaire).
  const win = getNotchWindow();
  if (win && pidStr === process.pid) {
    emit(false);
    return;
  }
  void pidStr;

  const display = screen.getPrimaryDisplay();
  const isFullscreen = rectsMatch(
    { x: l, y: t, w: r - l, h: b - t },
    display.bounds,
  );
  emit(isFullscreen);
}

export function startFullscreenDetector(): void {
  if (psProcess) return;
  try {
    psProcess = spawn(
      powershellExe(),
      ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT],
      { windowsHide: true },
    );
  } catch (err) {
    console.warn('[fullscreen] spawn PowerShell échoué — détection désactivée:', err);
    return;
  }

  // `spawn` n'échoue PAS de façon synchrone sur un ENOENT (binaire
  // introuvable) : l'erreur arrive en asynchrone via l'événement 'error'.
  // Sans ce handler, l'ENOENT devient une exception non catchée qui crashe
  // tout le main process. On dégrade donc proprement (détection désactivée).
  psProcess.on('error', (err) => {
    console.warn('[fullscreen] PowerShell indisponible — détection désactivée:', err.message);
    psProcess = null;
    lastEmitted = null;
  });

  let buffer = '';
  psProcess.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    // Découpage par lignes ; on garde l'éventuel reliquat dans le buffer.
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  });
  psProcess.stderr.on('data', (chunk: Buffer) => {
    // Les warnings PowerShell sont émis ici ; on les ignore tant que
    // le process tourne et que stdout délivre.
    console.warn('[fullscreen] PS stderr:', chunk.toString('utf8').trim());
  });
  psProcess.on('exit', (code) => {
    console.warn(`[fullscreen] détecteur arrêté (code=${code})`);
    psProcess = null;
    lastEmitted = null;
  });
}

export function stopFullscreenDetector(): void {
  if (!psProcess) return;
  try {
    psProcess.kill();
  } catch { /* ignore */ }
  psProcess = null;
  lastEmitted = null;
}
