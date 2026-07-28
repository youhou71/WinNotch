/**
 * Détection des connexions VPN actives sur Windows.
 *
 * Stratégie hybride en un seul appel PowerShell :
 *  1. `Get-NetAdapter` filtré sur les descripteurs typiques (TAP, WireGuard,
 *     ProtonVPN, NordLynx, WAN Miniport L2TP/SSTP/IKEv2/PPTP).
 *  2. `Get-CimInstance Win32_Process` pour récupérer la ligne de commande
 *     des clients VPN connus (utilisé pour extraire le `--config` d'OpenVPN).
 *  3. `Get-VpnConnection` (user + AllUser) pour les VPN configurés dans
 *     Windows lui-même.
 *
 * Le script est passé via `-EncodedCommand` (base64 UTF-16LE) plutôt
 * que par stdin ou `-Command` — c'est l'unique façon documentée d'éviter
 * tous les pièges d'échappement de quotes et de newlines entre TS et PS.
 *
 * Timeout dur de 5 s : si PowerShell rame ou pend, on tue le child et on
 * remonte une erreur dans `VpnState.lastError`.
 */
import type { VpnClient, VpnConnection } from '../../../shared/types';
import { runPersistentPowershell } from '../shell/persistentPowershell';

// Généreux : le tout premier appel paie l'autoload des modules CDXML
// (NetAdapter, VpnClient) + l'init CIM dans le process persistant (~plusieurs
// secondes sur une machine corporate). Les appels suivants sont quasi instantanés.
const POWERSHELL_TIMEOUT_MS = 20000;

interface AdapterInfo {
  name: string;
  description: string;
  mediaType: string;
  status: string;
}

interface ProcessInfo {
  name: string;
  commandLine: string | null;
}

interface WindowsVpnInfo {
  name: string;
  serverAddress: string | null;
  status: string;
}

interface VpnRawSnapshot {
  adapters: AdapterInfo[];
  processes: ProcessInfo[];
  windowsVpn: WindowsVpnInfo[];
}

/**
 * Script PowerShell exécuté à chaque tick. Doit rester rapide (< 1 s sur
 * une machine raisonnable) — on évite les pipelines redondants et on
 * n'interroge que les cmdlets utiles.
 *
 * Sortie : un JSON compact via `ConvertTo-Json -Compress`.
 */
const DETECT_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
# Pas de $OutputEncoding ici : interdit en ConstrainedLanguage, et inutile —
# le transport du PowerShell résident est en ASCII pur (cf. persistent-loop.ps1).

# Patterns d'InterfaceDescription / Name typiques d'une interface VPN.
# Liste large : on préfère un faux positif raisonnable à louper un client.
# Wintun est partagé par WireGuard et OpenVPN moderne — la classification
# fine se fait côté TS en croisant avec les processes actifs.
$vpnDescriptorPatterns = @(
  'TAP-', 'Wintun', 'WireGuard', 'OpenVPN', 'ProtonVPN', 'Proton VPN',
  'NordLynx', 'NordVPN', 'Mullvad', 'ExpressVPN',
  'Fortinet', 'FortiClient', 'Forti SSL', 'Cisco AnyConnect', 'GlobalProtect',
  'WAN Miniport (PPTP)', 'WAN Miniport (L2TP)',
  'WAN Miniport (SSTP)', 'WAN Miniport (IKEv2)', 'WAN Miniport (IP)'
)

$adapters = @()
try {
  $all = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' }
  foreach ($a in $all) {
    $desc = [string]$a.InterfaceDescription
    $name = [string]$a.Name
    $media = [string]$a.MediaType
    $matched = $false
    # MediaType-based detection : 'Tunnel' / 'PPP' = VPN sans ambiguïté
    if ($media -eq 'Tunnel' -or $media -eq 'PPP') { $matched = $true }
    if (-not $matched) {
      foreach ($pat in $vpnDescriptorPatterns) {
        if ($desc -like "*$pat*" -or $name -like "*$pat*") { $matched = $true; break }
      }
    }
    if (-not $matched -and $name -like 'wg*') { $matched = $true }
    if ($matched) {
      $adapters += @{
        name = $name
        description = $desc
        mediaType = $media
        status = $a.Status.ToString()
      }
    }
  }
} catch {}

# Filtre côté WMI (WQL) : beaucoup plus rapide que de lister tous les
# processes puis filtrer côté PowerShell (~10 ms vs 3-5 s en cold start).
$procFilter = "Name='openvpn.exe' OR Name='wireguard.exe' OR Name='ProtonVPN.exe' OR Name='NordVPN.exe' OR Name='nordvpn-service.exe'"
$processes = @()
try {
  $rows = Get-CimInstance Win32_Process -Filter $procFilter -ErrorAction SilentlyContinue
  foreach ($p in $rows) {
    $n = [System.IO.Path]::GetFileNameWithoutExtension([string]$p.Name)
    $processes += @{
      name = $n
      commandLine = [string]$p.CommandLine
    }
  }
} catch {}

$windowsVpn = @()
try {
  $userConns = @()
  try { $userConns = Get-VpnConnection -ErrorAction SilentlyContinue } catch {}
  $allConns = @()
  try { $allConns = Get-VpnConnection -AllUserConnection -ErrorAction SilentlyContinue } catch {}
  $combined = @()
  if ($userConns) { $combined += $userConns }
  if ($allConns) { $combined += $allConns }
  $unique = $combined | Where-Object { $_.ConnectionStatus -eq 'Connected' } |
    Group-Object -Property Name |
    ForEach-Object { $_.Group[0] }
  foreach ($c in $unique) {
    $windowsVpn += @{
      name = [string]$c.Name
      serverAddress = [string]$c.ServerAddress
      status = $c.ConnectionStatus.ToString()
    }
  }
} catch {}

@{
  adapters = $adapters
  processes = $processes
  windowsVpn = $windowsVpn
} | ConvertTo-Json -Depth 4 -Compress
`.trim();

/**
 * Exécute le script PowerShell et retourne le snapshot brut. Retourne
 * null si PowerShell ne répond pas ou si le JSON est invalide — l'appelant
 * traduit ça en `lastError`.
 */
export async function runDetectScript(): Promise<{ snapshot: VpnRawSnapshot | null; error: string | null }> {
  // Exécuté dans le powershell.exe persistant partagé (cf. persistentPowershell)
  // : pas de spawn par tick, les modules CDXML restent chauds entre les appels.
  const { stdout, error } = await runPersistentPowershell(
    DETECT_SCRIPT,
    POWERSHELL_TIMEOUT_MS,
  );
  if (error) {
    console.warn('[vpn] détection échouée:', error);
    return { snapshot: null, error: `Détection VPN : ${error}` };
  }
  const trimmed = stdout.trim();
  if (!trimmed) {
    // Sortie vide quand toutes les listes sont vides — aucun VPN détecté.
    return {
      snapshot: { adapters: [], processes: [], windowsVpn: [] },
      error: null,
    };
  }
  try {
    const parsed = JSON.parse(trimmed) as Partial<VpnRawSnapshot>;
    const snapshot: VpnRawSnapshot = {
      adapters: Array.isArray(parsed.adapters) ? parsed.adapters : [],
      processes: Array.isArray(parsed.processes) ? parsed.processes : [],
      windowsVpn: Array.isArray(parsed.windowsVpn) ? parsed.windowsVpn : [],
    };
    return { snapshot, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[vpn] PS JSON parse failed', { stdout: stdout.slice(0, 500) });
    return { snapshot: null, error: `Détection VPN : JSON invalide (${msg})` };
  }
}

/**
 * Identifie le client VPN à partir de la description / nom d'adaptateur,
 * en croisant avec la liste des processes actifs pour lever les
 * ambiguïtés (cas Wintun, partagé par WireGuard et OpenVPN moderne).
 */
function classifyAdapter(adapter: AdapterInfo, processes: ProcessInfo[]): VpnClient {
  const desc = adapter.description.toLowerCase();
  const name = adapter.name.toLowerCase();
  const media = (adapter.mediaType ?? '').toLowerCase();
  const procNames = new Set(processes.map((p) => p.name.toLowerCase()));

  if (desc.includes('protonvpn') || desc.includes('proton vpn') || name.includes('protonvpn')) {
    return 'protonvpn';
  }
  if (
    desc.includes('nordlynx') ||
    desc.includes('nordvpn') ||
    name.includes('nordvpn') ||
    name.includes('nordlynx')
  ) {
    return 'nordvpn';
  }
  if (
    desc.includes('fortinet') ||
    desc.includes('forticlient') ||
    desc.includes('forti ssl') ||
    name.includes('fortinet')
  ) {
    return 'fortinet';
  }
  if (desc.includes('wireguard') || name.startsWith('wg')) return 'wireguard';
  if (desc.includes('openvpn')) return 'openvpn';
  if (desc.includes('tap-windows') || desc.includes('tap-')) {
    // TAP-Windows est typique OpenVPN community
    return 'openvpn';
  }
  if (desc.includes('wintun')) {
    // Wintun est partagé : WG le préfère, OpenVPN moderne l'utilise aussi.
    if (procNames.has('wireguard')) return 'wireguard';
    if (procNames.has('openvpn')) return 'openvpn';
    if (procNames.has('protonvpn')) return 'protonvpn';
    if (procNames.has('nordvpn')) return 'nordvpn';
    return 'unknown';
  }
  if (desc.includes('wan miniport') || media === 'ppp') return 'windows-native';
  return 'unknown';
}

/** Extrait le chemin de la config OpenVPN dans `openvpn.exe --config "<path>"`. */
function extractOpenVpnConfig(commandLine: string): string | null {
  if (!commandLine) return null;
  const match = commandLine.match(/--config\s+(?:"([^"]+)"|(\S+))/i);
  if (!match) return null;
  const raw = match[1] ?? match[2] ?? '';
  if (!raw) return null;
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? raw;
  return base.replace(/\.ovpn$/i, '') || base;
}

/**
 * Mappe le snapshot brut vers une liste de `VpnConnection` typées.
 *
 * Pour chaque adaptateur VPN détecté, on enrichit avec les infos process
 * disponibles. Les VPN Windows natifs sont remontés à part puisqu'ils
 * n'ont pas toujours une interface visible dans `Get-NetAdapter` (cas
 * d'un WAN Miniport éphémère).
 *
 * `connectedSince` est fourni par l'appelant (qui tient la table d'historique)
 * — ici on construit juste le squelette de la connexion sans timestamp.
 */
export interface RawConnection {
  client: VpnClient;
  interfaceName: string;
  connectionName?: string;
  serverAddress?: string;
}

export function buildConnections(snapshot: VpnRawSnapshot): RawConnection[] {
  const out: RawConnection[] = [];
  const seenKeys = new Set<string>();

  // Process index par client pour récupérer le commandLine quand utile
  const openVpnProcs = snapshot.processes.filter((p) => p.name.toLowerCase() === 'openvpn');

  for (const a of snapshot.adapters) {
    const client = classifyAdapter(a, snapshot.processes);
    let connectionName: string | undefined;
    let serverAddress: string | undefined;

    if (client === 'openvpn') {
      // 1 process openvpn = 1 config en général. Si plusieurs, on prend le 1er.
      for (const p of openVpnProcs) {
        const cfg = extractOpenVpnConfig(p.commandLine ?? '');
        if (cfg) { connectionName = cfg; break; }
      }
    } else if (client === 'wireguard') {
      // L'interface WireGuard est nommée d'après le tunnel actif.
      connectionName = a.name;
    } else if (client === 'protonvpn' || client === 'nordvpn') {
      // Pas d'info précise sans plugin propriétaire — on garde le nom d'interface
      connectionName = a.name;
    }

    const key = a.name.toLowerCase();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    out.push({
      client,
      interfaceName: a.name,
      connectionName,
      serverAddress,
    });
  }

  for (const w of snapshot.windowsVpn) {
    const key = `winvpn:${w.name.toLowerCase()}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push({
      client: 'windows-native',
      interfaceName: w.name,
      connectionName: w.name,
      serverAddress: w.serverAddress ?? undefined,
    });
  }

  return out;
}

export function toVpnConnection(
  raw: RawConnection,
  connectedSince: number,
  connectedSinceIsApprox: boolean,
  country?: string,
): VpnConnection {
  return {
    client: raw.client,
    interfaceName: raw.interfaceName,
    connectionName: raw.connectionName,
    serverAddress: raw.serverAddress,
    country,
    connectedSince,
    connectedSinceIsApprox,
  };
}
