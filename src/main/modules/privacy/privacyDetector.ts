/**
 * Détection d'usage caméra / microphone (Lot B #6, sans le verrouillage).
 *
 * 100 % LOCAL : lecture du registre Windows `CapabilityAccessManager\
 * ConsentStore` (HKCU). Chaque application ayant accédé au périphérique a
 * une sous-clé portant `LastUsedTimeStart` et `LastUsedTimeStop` (FILETIME).
 * Convention Windows : une app **utilise actuellement** le périphérique
 * quand `LastUsedTimeStop == 0` (démarré, pas encore arrêté).
 *
 * Exécuté via le PowerShell résident partagé (aucun spawn par tick).
 */
import { runPersistentPowershell } from '../shell/persistentPowershell';

const TIMEOUT_MS = 10_000;

/**
 * Script PS : pour `webcam` et `microphone`, retourne la liste des noms de
 * clés (identités d'app) actuellement en usage. La mise en forme "jolie"
 * du nom est faite côté TS (`prettifyApp`).
 */
const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$OutputEncoding = [System.Text.Encoding]::UTF8

function Get-ActiveApps($cap) {
  $apps = @()
  $base = "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\$cap"
  $keys = @()
  $keys += Get-ChildItem -Path $base -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -ne 'NonPackaged' }
  $np = Join-Path $base 'NonPackaged'
  if (Test-Path $np) { $keys += Get-ChildItem -Path $np -ErrorAction SilentlyContinue }
  foreach ($k in $keys) {
    $props = Get-ItemProperty -Path $k.PSPath -ErrorAction SilentlyContinue
    $start = $props.LastUsedTimeStart
    $stop = $props.LastUsedTimeStop
    if ($null -ne $start -and $start -ne 0 -and ($null -eq $stop -or $stop -eq 0)) {
      $apps += $k.PSChildName
    }
  }
  return $apps
}

$result = [ordered]@{
  cam = @(Get-ActiveApps 'webcam')
  mic = @(Get-ActiveApps 'microphone')
}
ConvertTo-Json $result -Compress
`;

export interface PrivacySnapshot {
  cam: string[];
  mic: string[];
}

interface RawResult {
  cam?: string[];
  mic?: string[];
}

/**
 * Transforme une clé de registre en nom lisible :
 *  - NonPackaged : `C:#Program Files#Zoom#bin#Zoom.exe` → `Zoom`
 *  - packagé : `Microsoft.Teams_8wekyb3d8bbwe` → `Teams`
 */
export function prettifyApp(raw: string): string {
  if (raw.includes('#')) {
    const path = raw.replace(/#/g, '\\');
    const base = path.split('\\').filter(Boolean).pop() ?? raw;
    return base.replace(/\.exe$/i, '');
  }
  // App packagée : PackageFamilyName `Editeur.Nom_hash`.
  const beforeHash = raw.split('_')[0] ?? raw;
  const lastSegment = beforeHash.split('.').pop() ?? beforeHash;
  return lastSegment;
}

/**
 * Exécute la détection. Retourne `{ snapshot, error }` : `snapshot` est
 * `null` si le script a échoué (l'appelant garde alors son dernier état).
 */
export async function runPrivacyScript(): Promise<{
  snapshot: PrivacySnapshot | null;
  error: string | null;
}> {
  const { stdout, error } = await runPersistentPowershell(SCRIPT, TIMEOUT_MS);
  if (error) return { snapshot: null, error };
  const trimmed = stdout.trim();
  if (!trimmed) return { snapshot: { cam: [], mic: [] }, error: null };
  try {
    const raw = JSON.parse(trimmed) as RawResult;
    const dedup = (arr: unknown): string[] => {
      const list = Array.isArray(arr) ? arr : [];
      const seen = new Set<string>();
      const out: string[] = [];
      for (const item of list) {
        if (typeof item !== 'string') continue;
        const name = prettifyApp(item);
        const key = name.toLowerCase();
        if (name && !seen.has(key)) {
          seen.add(key);
          out.push(name);
        }
      }
      return out;
    };
    return { snapshot: { cam: dedup(raw.cam), mic: dedup(raw.mic) }, error: null };
  } catch {
    return { snapshot: null, error: 'Sortie PowerShell inexploitable (privacy).' };
  }
}
