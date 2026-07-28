# Boucle du process PowerShell persistant mutualise de WinNotch.
#
# Lance une seule fois (cf. src/main/modules/shell/persistentPowershell.ts), ce
# script lit des requetes sur stdin et ecrit les reponses sur stdout. Garder
# un seul powershell.exe long-running evite de repayer l'autoload des modules
# CDXML (NetAdapter, VpnClient) + l'init CIM a chaque tick.
#
# CONTRAINTE MAJEURE — ce script doit tourner en **ConstrainedLanguage**.
# AppLocker/WDAC impose ce mode aux scripts situes sous %LOCALAPPDATA%, donc a
# l'application INSTALLEE, alors que le meme fichier lance depuis le depot
# tourne en FullLanguage : un bug de ce type est donc invisible en dev.
# Sont interdits ici : [Console]::*, [Convert]::*, [System.Text.Encoding]::*,
# [scriptblock]::Create, [pscustomobject], Add-Type, New-Object. Seuls sont
# permis les cmdlets, les operateurs, et les methodes des types « core »
# (string, char, int, array, hashtable). Toute construction ajoutee ici doit
# etre testee depuis un dossier ou AppLocker force le CLM — pas depuis le depot.
#
# Historique : la version precedente lisait stdin via [Console]::In.ReadLine(),
# interdit en CLM. L'appel renvoyait $null des la premiere iteration, le script
# sortait aussitot, et le poller Systeme le relancait a 1 Hz — ~53 spawns de
# powershell.exe par minute pour zero resultat.
#
# Protocole (1 ligne JSON in -> 1 ligne JSON out), 100 % ASCII dans les deux
# sens pour etre insensible a la page de code de la console :
#   - in  : {"id":"<id>","code":"<script>"}
#   - out : {"id":"<id>","ok":true,"out":"<sortie>"}
#           ou {"id":"<id>","ok":false,"err":"<message>"}
# Node echappe les non-ASCII en \uXXXX a l'aller ; EscapeNonAscii fait de meme
# au retour, car ConvertTo-Json laisse passer les caracteres accentues tels
# quels et Node les decoderait de travers.
#
# $ProgressPreference coupe le flux de progression (sinon CLIXML sur stderr
# lors de l'autoload).

$ProgressPreference = 'SilentlyContinue'

function EscapeNonAscii($s) {
  if ($s -notmatch '[^\x00-\x7F]') { return $s }
  $out = ''
  foreach ($ch in $s.ToCharArray()) {
    $code = [int]$ch
    if ($code -gt 126) { $out = $out + ('\u{0:x4}' -f $code) }
    else { $out = $out + $ch }
  }
  return $out
}

# $input enumere le pipeline d'entree en streaming (verifie : une reponse part
# avant la fermeture de stdin). C'est le remplacant CLM-safe de ReadLine().
foreach ($line in $input) {
  if ($null -eq $line) { break }
  $trimmed = ([string]$line).Trim()
  if ($trimmed.Length -eq 0) { continue }

  $req = $null
  try { $req = $trimmed | ConvertFrom-Json } catch { continue }
  if ($null -eq $req) { continue }
  $id = [string]$req.id
  if ($id.Length -eq 0) { continue }

  try {
    # Invoke-Expression remplace [scriptblock]::Create : le code recu s'execute
    # dans le meme mode de langage que ce script (donc en CLM sur poste bride —
    # les scripts metier doivent l'etre aussi).
    $res = Invoke-Expression ([string]$req.code)
    $text = [string]$res
    $envelope = [ordered]@{ id = $id; ok = $true; out = $text }
  } catch {
    $envelope = [ordered]@{ id = $id; ok = $false; err = [string]$_.Exception.Message }
  }
  Write-Output (EscapeNonAscii ($envelope | ConvertTo-Json -Compress))
}
