# Detecteur d'application au premier plan en plein ecran (WinNotch).
#
# Lance comme process long-running (cf.
# src/main/modules/shell/fullscreenDetector.ts), ce script poll
# GetForegroundWindow + GetWindowRect toutes les $IntervalMs ms et ecrit
# "left,top,right,bottom,pid" sur stdout a chaque tick. Node compare ensuite
# aux bounds du primary display.
#
# L'intervalle de poll est passe en argument par l'appelant pour rester pilote
# cote TypeScript (POLL_INTERVAL_MS).
#
# Note : ce script reste en PowerShell (Add-Type / P-Invoke user32) faute de
# lib native fournissant les bounds de la fenetre active avec des prebuilds
# compatibles Electron. Il est externalise en .ps1 (plutot qu'inline via
# -Command) pour garder la ligne de commande de powershell.exe propre.

param([int]$IntervalMs = 750)

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
      # $pid est une variable reservee PowerShell (read-only, PID du process PS
      # courant). On utilise $winPid pour le PID de la fenetre foreground.
      $winPid = [uint32]0
      [void][W]::GetWindowThreadProcessId($h, [ref]$winPid)
      Write-Output "$($r.Left),$($r.Top),$($r.Right),$($r.Bottom),$winPid"
    }
  }
  [System.Console]::Out.Flush()
  Start-Sleep -Milliseconds $IntervalMs
}
