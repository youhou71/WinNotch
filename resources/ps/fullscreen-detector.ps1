# Detecteur d'application au premier plan en plein ecran + touche Alt (WinNotch).
#
# Lance comme process long-running (cf.
# src/main/modules/shell/fullscreenDetector.ts), ce script combine deux
# pollings dans UNE seule boucle (un seul powershell.exe resident) :
#  - toutes les $AltIntervalMs ms : GetAsyncKeyState(VK_MENU) pour le mode
#    Peek (Alt maintenu). Emet "ALT,1" / "ALT,0" sur stdout UNIQUEMENT sur
#    transition (down/up) — zero trafic au repos.
#  - toutes les ~$IntervalMs ms (1 tick rapide sur N) : GetForegroundWindow
#    + GetWindowRect, emet "left,top,right,bottom,pid". Node compare ensuite
#    aux bounds du primary display.
#
# Pourquoi GetAsyncKeyState plutot qu'un hook clavier global WH_KEYBOARD_LL
# (ex-node-global-key-listener, retire) : le hook imposait un aller-retour
# pipe vers l'event loop Node POUR CHAQUE FRAPPE de chaque application du
# PC — des que le main process Electron bloquait (I/O synchrone, GC), la
# latence clavier de TOUT Windows augmentait. Le polling est hors du chemin
# critique clavier : un syscall leger toutes les 75 ms, cout fixe
# negligeable, latence de detection <= 75 ms (imperceptible pour un effet
# d'opacite).
#
# $AltIntervalMs <= 0 desactive le polling Alt (WINNOTCH_DISABLE_ALT_PEEK=1
# ou aucun handler enregistre cote Node) : la boucle retombe au comportement
# historique (un tick fullscreen toutes les $IntervalMs ms).
#
# Les intervalles sont passes en argument par l'appelant pour rester pilotes
# cote TypeScript. Ce script reste en PowerShell (Add-Type / P-Invoke user32)
# faute de lib native compatible Electron ; il est externalise en .ps1
# (plutot qu'inline via -Command) pour garder la ligne de commande propre.

param([int]$IntervalMs = 750, [int]$AltIntervalMs = 75)

$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@

$VK_MENU = 0x12
$altPolling = $AltIntervalMs -gt 0
$sleepMs = if ($altPolling) { $AltIntervalMs } else { $IntervalMs }
# Nombre de ticks rapides entre deux checks fullscreen (>= 1).
$fsEvery = if ($altPolling) { [Math]::Max(1, [int][Math]::Round($IntervalMs / $AltIntervalMs)) } else { 1 }
$altDown = $false
$tick = 0

while ($true) {
  if ($altPolling) {
    # Bit de poids fort = touche actuellement enfoncee. VK_MENU couvre les
    # deux Alt (gauche/droite).
    $down = ([W]::GetAsyncKeyState($VK_MENU) -band 0x8000) -ne 0
    if ($down -ne $altDown) {
      $altDown = $down
      Write-Output "ALT,$([int]$down)"
      [System.Console]::Out.Flush()
    }
  }
  if (($tick % $fsEvery) -eq 0) {
    $h = [W]::GetForegroundWindow()
    if ($h -ne [IntPtr]::Zero) {
      $r = New-Object RECT
      if ([W]::GetWindowRect($h, [ref]$r)) {
        # $pid est une variable reservee PowerShell (read-only, PID du process PS
        # courant). On utilise $winPid pour le PID de la fenetre foreground.
        $winPid = [uint32]0
        [void][W]::GetWindowThreadProcessId($h, [ref]$winPid)
        Write-Output "$($r.Left),$($r.Top),$($r.Right),$($r.Bottom),$winPid"
      }
    }
    [System.Console]::Out.Flush()
  }
  $tick++
  Start-Sleep -Milliseconds $sleepMs
}
