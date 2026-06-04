# Boucle du process PowerShell persistant mutualise de WinNotch.
#
# Lance une seule fois (cf. src/main/modules/shell/persistentPowershell.ts), ce
# script lit des requetes sur stdin et ecrit les reponses sur stdout. Garder
# un seul powershell.exe long-running evite de repayer l'autoload des modules
# CDXML (NetAdapter, VpnClient) + l'init CIM a chaque tick.
#
# Protocole (1 ligne in -> 1 ligne out, base64 pour eviter tout souci de
# quoting/newline) :
#   - in  : "<id> <base64(script UTF-8)>"
#   - out : {"id":"<id>","ok":true,"out":"<base64(sortie UTF-8)>"}
#           ou {"id":"<id>","ok":false,"err":"<base64(message)>"}
#
# $ProgressPreference coupe le flux de progression (sinon CLIXML sur stderr
# lors de l'autoload).

$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Length -eq 0) { continue }
  $sp = $line.IndexOf(' ')
  if ($sp -lt 0) { continue }
  $id = $line.Substring(0, $sp)
  $b64 = $line.Substring($sp + 1)
  try {
    $code = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
    $res = & ([scriptblock]::Create($code))
    $text = [string]$res
    $o = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text))
    [Console]::Out.WriteLine('{"id":"' + $id + '","ok":true,"out":"' + $o + '"}')
  } catch {
    $e = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([string]$_.Exception.Message))
    [Console]::Out.WriteLine('{"id":"' + $id + '","ok":false,"err":"' + $e + '"}')
  }
}
