/**
 * Lecture des compteurs système.
 *
 * Sources :
 *  - **CPU** : `os.cpus()` retourne des compteurs cumulés
 *    (user/nice/sys/idle/irq). On compare deux snapshots pour calculer
 *    le % de temps non-idle entre les deux instants.
 *  - **RAM** : `os.totalmem()` / `os.freemem()` — instantanés, pas de
 *    différentiel nécessaire.
 *  - **Uptime** : `os.uptime()` (secondes depuis le boot).
 *  - **Réseau** : `Get-NetAdapterStatistics` via PowerShell. Les compteurs
 *    `ReceivedBytes` / `SentBytes` sont cumulés depuis le boot ; on calcule
 *    un débit en bytes/seconde via la différence entre deux snapshots.
 *
 * Le script PowerShell est passé en `-EncodedCommand` (base64 UTF-16LE)
 * comme dans `vpnDetector.ts` — c'est la façon recommandée par Microsoft
 * pour éviter les pièges d'échappement de quotes dans un script multi-ligne.
 */
import * as os from 'os';
import { runPersistentPowershell } from '../shell/persistentPowershell';

// Généreux : le premier appel (dans le process persistant partagé) paie
// l'autoload des modules + l'init CIM ; les suivants sont quasi instantanés.
// Sert aussi de filet pour un cmdlet réellement bloqué.
const POWERSHELL_TIMEOUT_MS = 20000;

/**
 * Filtres d'exclusion par défaut pour les interfaces réseau. Match
 * case-insensitive sur `Name` ET `InterfaceDescription` — un seul match
 * suffit pour exclure l'interface.
 *
 * Ces noms couvrent : la boucle locale, les bridges WSL/Hyper-V, le
 * Bluetooth PAN, et les pseudo-interfaces ISATAP/Teredo. L'utilisateur
 * peut surcharger via la config `netInterfaces` (whitelist explicite).
 */
const DEFAULT_NET_EXCLUDE_PATTERNS = [
  'loopback',
  'wsl',
  'vethernet',
  'bluetooth pan',
  'pseudo-interface',
  'isatap',
  'teredo',
];

interface CpuSnapshot {
  total: number;
  idle: number;
}

/** Capture les compteurs cumulés de toutes les cores. */
function snapshotCpu(): CpuSnapshot {
  let total = 0;
  let idle = 0;
  for (const cpu of os.cpus()) {
    const times = cpu.times;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
    idle += times.idle;
  }
  return { total, idle };
}

/**
 * Calcule le % d'utilisation entre deux snapshots CPU. Retourne 0 si les
 * snapshots sont identiques (premier tick) ou aberrants.
 */
export function cpuPercentBetween(prev: CpuSnapshot, curr: CpuSnapshot): number {
  const totalDelta = curr.total - prev.total;
  const idleDelta = curr.idle - prev.idle;
  if (totalDelta <= 0) return 0;
  const pct = 100 * (1 - idleDelta / totalDelta);
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

/** Lit la mémoire physique. Tout en octets. */
export function readMemory(): {
  usedBytes: number;
  totalBytes: number;
  percent: number;
} {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const percent = total > 0 ? (used / total) * 100 : 0;
  return { usedBytes: used, totalBytes: total, percent };
}

/** Uptime du système en secondes. */
export function readUptimeSec(): number {
  return os.uptime();
}

/** Retourne un nouveau snapshot CPU. Exposé pour que le service puisse stocker l'état. */
export function readCpuSnapshot(): CpuSnapshot {
  return snapshotCpu();
}

/* ────────────────────────── Réseau ────────────────────────── */

/**
 * Un échantillon de compteurs réseau brut renvoyé par PowerShell. Les
 * valeurs `bytes` sont cumulées depuis le boot.
 */
export interface NetAdapterSample {
  name: string;
  description: string;
  bytesReceived: number;
  bytesSent: number;
}

export interface NetSnapshot {
  /** Unix ms du moment de capture. */
  at: number;
  adapters: NetAdapterSample[];
}

/**
 * Le script ne filtre PAS côté PowerShell — la sélection finale (whitelist
 * utilisateur OU exclusion par défaut) est faite côté TS pour rester
 * configurable sans relancer PS.
 */
const NET_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$OutputEncoding = [System.Text.Encoding]::UTF8
$stats = Get-NetAdapterStatistics -ErrorAction SilentlyContinue
# Jointure hashtable : DEUX requêtes CIM fixes au lieu de 1 + N
# (l'ancien Get-NetAdapter -Name par adaptateur multipliait les requêtes
# WMI à chaque tick 1 Hz — audit perf P7, gain mesurable sur WmiPrvSE).
$adaptersByName = @{}
foreach ($a in (Get-NetAdapter -ErrorAction SilentlyContinue)) {
  if ($a.Status -eq 'Up') { $adaptersByName[$a.Name] = $a }
}
$rows = @()
if ($stats) {
  foreach ($s in $stats) {
    $adapter = $adaptersByName[[string]$s.Name]
    if (-not $adapter) { continue }
    $rows += [pscustomobject]@{
      name = [string]$s.Name
      description = [string]$adapter.InterfaceDescription
      bytesReceived = [int64]$s.ReceivedBytes
      bytesSent = [int64]$s.SentBytes
    }
  }
}
[pscustomobject]@{ adapters = $rows } | ConvertTo-Json -Depth 3 -Compress
`.trim();

/**
 * Exécute le script et retourne la liste des adapters actifs avec leurs
 * compteurs cumulés. Retourne `null` en cas d'erreur PowerShell (le caller
 * remonte ça dans `SystemState.lastError`).
 */
export async function readNetSnapshot(): Promise<{
  snapshot: NetSnapshot | null;
  error: string | null;
}> {
  // Exécuté dans le powershell.exe persistant partagé (cf. persistentPowershell)
  // : pas de spawn par tick (le module Système poll jusqu'à 1 Hz), les modules
  // CDXML et la session CIM restent chauds entre les appels.
  const { stdout, error } = await runPersistentPowershell(
    NET_SCRIPT,
    POWERSHELL_TIMEOUT_MS,
  );
  if (error) {
    return { snapshot: null, error: `Lecture réseau : ${error}` };
  }
  try {
    // ConvertTo-Json renvoie `null` (ou une chaîne vide) si la collection est
    // vide — on tolère.
    const text = stdout.trim();
    if (!text || text === 'null') {
      return { snapshot: { at: Date.now(), adapters: [] }, error: null };
    }
    const parsed = JSON.parse(text) as { adapters?: unknown };
    const adapters: NetAdapterSample[] = [];
    const list = Array.isArray(parsed?.adapters)
      ? parsed.adapters
      : parsed?.adapters
        ? [parsed.adapters]
        : [];
    for (const row of list) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      adapters.push({
        name: String(r.name ?? ''),
        description: String(r.description ?? ''),
        bytesReceived: Number(r.bytesReceived ?? 0),
        bytesSent: Number(r.bytesSent ?? 0),
      });
    }
    return { snapshot: { at: Date.now(), adapters }, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { snapshot: null, error: `JSON parse: ${msg}` };
  }
}

/**
 * Filtre les adapters selon la config utilisateur. `whitelist === null`
 * applique les exclusions par défaut (loopback, vEthernet, WSL, etc.).
 */
export function selectAdapters(
  adapters: NetAdapterSample[],
  whitelist: string[] | null,
): NetAdapterSample[] {
  if (whitelist && whitelist.length > 0) {
    const allow = new Set(whitelist.map((n) => n.toLowerCase()));
    return adapters.filter((a) => allow.has(a.name.toLowerCase()));
  }
  return adapters.filter((a) => {
    const hay = (a.name + ' ' + a.description).toLowerCase();
    return !DEFAULT_NET_EXCLUDE_PATTERNS.some((pat) => hay.includes(pat));
  });
}

/**
 * Calcule le débit en bytes/seconde entre deux snapshots. Si l'écart de
 * temps est nul (premier tick) ou si les adapters ne matchent pas, retourne
 * 0 (pas de débit calculable). Les compteurs qui régressent (interface
 * désactivée puis ré-activée) sont ignorés pour cette transition.
 */
export function netBytesPerSec(
  prev: NetSnapshot | null,
  curr: NetSnapshot,
  whitelist: string[] | null,
): number {
  if (!prev) return 0;
  const dtMs = curr.at - prev.at;
  if (dtMs <= 0) return 0;

  const prevByName = new Map<string, NetAdapterSample>();
  for (const a of selectAdapters(prev.adapters, whitelist)) {
    prevByName.set(a.name.toLowerCase(), a);
  }

  let bytes = 0;
  for (const a of selectAdapters(curr.adapters, whitelist)) {
    const p = prevByName.get(a.name.toLowerCase());
    if (!p) continue;
    const dRx = a.bytesReceived - p.bytesReceived;
    const dTx = a.bytesSent - p.bytesSent;
    // Ignore les compteurs qui régressent (reset d'interface).
    if (dRx > 0) bytes += dRx;
    if (dTx > 0) bytes += dTx;
  }
  return (bytes / dtMs) * 1000;
}
