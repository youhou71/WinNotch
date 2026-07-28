/**
 * Compteurs réseau par interface, lus via `GetIfTable2` (iphlpapi) — donc
 * **dans le process**, sans `powershell.exe`.
 *
 * Remplace le `NET_SCRIPT` du module Système, qui était l'usage le plus
 * fréquent du PowerShell résident (un aller-retour par seconde). Coût mesuré :
 * ~2,7 ms par relevé complet, contre 80 à 200 ms pour le script.
 *
 * ── Deux pièges, tous deux vérifiés empiriquement ────────────────────────
 *
 * 1. ALIGNEMENT. `MIB_IF_ROW2` fait 1352 octets sur x64 et le moindre champ
 *    mal déclaré décale tout le reste : on obtiendrait des compteurs
 *    plausibles mais faux, donc un débit silencieusement erroné. La taille est
 *    vérifiée au chargement (`EXPECTED_ROW_SIZE`) et le module se désactive si
 *    elle ne correspond pas — mieux vaut pas de donnée qu'une fausse donnée.
 *
 * 2. COUCHES DE FILTRAGE NDIS. `GetIfTable2` ne renvoie pas que les cartes
 *    réseau : il renvoie aussi chaque couche de filtrage empilée dessus (QoS
 *    Packet Scheduler, WFP MAC Layer, Native WiFi Filter…), **avec les mêmes
 *    compteurs**. Sur la machine de test, le Wi-Fi apparaissait ainsi 6 fois :
 *    sommer sans discriminer multipliait le débit par 6. Le bit
 *    `FilterInterface` du champ `InterfaceAndOperStatusFlags` les identifie
 *    exactement — c'est lui qui fait le tri, et il donne la même liste que
 *    `Get-NetAdapter`.
 */
import { createRequire } from 'module';

/** Un relevé par interface, aligné sur ce que produisait le `NET_SCRIPT`. */
export interface NetAdapterCounters {
  name: string;
  description: string;
  bytesReceived: number;
  bytesSent: number;
}

/** `sizeof(MIB_IF_ROW2)` attendu sur x64 — garde-fou d'alignement. */
const EXPECTED_ROW_SIZE = 1352;
/** En-tête de `MIB_IF_TABLE2` : `ULONG NumEntries` + padding d'alignement. */
const TABLE_HEADER_SIZE = 8;
/** `IF_OPER_STATUS.IfOperStatusUp` */
const IF_OPER_STATUS_UP = 1;
/** Bit 1 de `InterfaceAndOperStatusFlags` : couche de filtrage, à exclure. */
const FLAG_FILTER_INTERFACE = 1 << 1;

interface NetApi {
  koffi: {
    decode: (ptr: unknown, offset: number | unknown, type?: unknown) => Record<string, unknown>;
  };
  row: unknown;
  table: unknown;
  rowSize: number;
  getIfTable2: (out: unknown[]) => number;
  freeMibTable: (ptr: unknown) => void;
}

let api: NetApi | null = null;
let attempted = false;
let loadError: string | null = null;

function load(): NetApi | null {
  if (attempted) return api;
  attempted = true;

  if (process.platform !== 'win32') {
    loadError = 'plateforme non Windows';
    return null;
  }

  try {
    const require = createRequire(import.meta.url);
    const koffi = require('koffi');
    const iphlpapi = koffi.load('iphlpapi.dll');

    const guid = koffi.array('uint8', 16);
    const physAddr = koffi.array('uint8', 32);
    // IF_MAX_STRING_SIZE + 1 = 257 WCHAR ; le hint 'String' fait décoder koffi
    // directement en chaîne JS.
    const ifString = koffi.array('char16_t', 257, 'String');

    // Champs dans l'ordre EXACT de netioapi.h — c'est cet ordre qui détermine
    // les offsets. Les enums valent `int`. Le bitfield
    // `InterfaceAndOperStatusFlags` tient sur 1 octet mais précède un champ
    // aligné sur 4 : le déclarer en `uint32` absorbe le padding et évite
    // d'avoir à raisonner sur le remplissage.
    const row = koffi.struct('MIB_IF_ROW2', {
      InterfaceLuid: 'uint64',
      InterfaceIndex: 'uint32',
      InterfaceGuid: guid,
      Alias: ifString,
      Description: ifString,
      PhysicalAddressLength: 'uint32',
      PhysicalAddress: physAddr,
      PermanentPhysicalAddress: physAddr,
      Mtu: 'uint32',
      Type: 'uint32',
      TunnelType: 'int',
      MediaType: 'int',
      PhysicalMediumType: 'int',
      AccessType: 'int',
      DirectionType: 'int',
      InterfaceAndOperStatusFlags: 'uint32',
      OperStatus: 'int',
      AdminStatus: 'int',
      MediaConnectState: 'int',
      NetworkGuid: guid,
      ConnectionType: 'int',
      TransmitLinkSpeed: 'uint64',
      ReceiveLinkSpeed: 'uint64',
      InOctets: 'uint64',
      InUcastPkts: 'uint64',
      InNUcastPkts: 'uint64',
      InDiscards: 'uint64',
      InErrors: 'uint64',
      InUnknownProtos: 'uint64',
      InUcastOctets: 'uint64',
      InMulticastOctets: 'uint64',
      InBroadcastOctets: 'uint64',
      OutOctets: 'uint64',
      OutUcastPkts: 'uint64',
      OutNUcastPkts: 'uint64',
      OutDiscards: 'uint64',
      OutErrors: 'uint64',
      OutUcastOctets: 'uint64',
      OutMulticastOctets: 'uint64',
      OutBroadcastOctets: 'uint64',
      OutQLen: 'uint64',
    });

    const rowSize = koffi.sizeof(row);
    if (rowSize !== EXPECTED_ROW_SIZE) {
      loadError =
        `sizeof(MIB_IF_ROW2) = ${rowSize}, attendu ${EXPECTED_ROW_SIZE} — ` +
        'declaration desalignee, module desactive pour ne pas produire de compteurs faux';
      return null;
    }

    // Le tableau des lignes est de longueur variable : on ne déclare que
    // l'en-tête et on décode chaque ligne par arithmétique de pointeur.
    const table = koffi.struct('MIB_IF_TABLE2', {
      NumEntries: 'uint32',
      _padding: 'uint32',
    });

    api = {
      koffi,
      row,
      table,
      rowSize,
      getIfTable2: iphlpapi.func('uint32 GetIfTable2(_Out_ void **Table)'),
      freeMibTable: iphlpapi.func('void FreeMibTable(void *Memory)'),
    };
    return api;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    api = null;
    return null;
  }
}

/** True si les compteurs natifs sont utilisables. */
export function isNativeNetAvailable(): boolean {
  return load() !== null;
}

/** Raison de l'indisponibilité, ou `null`. */
export function getNativeNetError(): string | null {
  load();
  return loadError;
}

/**
 * Relève les compteurs de toutes les interfaces actives, hors couches de
 * filtrage. `null` si la couche native est indisponible ou si l'appel échoue —
 * l'appelant doit alors se replier sur le script PowerShell.
 *
 * Les compteurs sont des `ULONG64` convertis en `number` : au-delà de 2^53
 * octets (9 pétaoctets) la précision se dégraderait, ce qui est hors de portée
 * d'un compteur d'interface remis à zéro à chaque redémarrage.
 */
export function readNetCounters(): NetAdapterCounters[] | null {
  const net = load();
  if (!net) return null;

  const out: unknown[] = [null];
  if (net.getIfTable2(out) !== 0) return null;
  const tablePtr = out[0];

  try {
    const header = net.koffi.decode(tablePtr, net.table) as { NumEntries: number };
    const rows: NetAdapterCounters[] = [];

    for (let i = 0; i < header.NumEntries; i++) {
      const r = net.koffi.decode(
        tablePtr,
        TABLE_HEADER_SIZE + i * net.rowSize,
        net.row,
      ) as unknown as {
        Alias: string;
        Description: string;
        OperStatus: number;
        InterfaceAndOperStatusFlags: number;
        InOctets: number | bigint;
        OutOctets: number | bigint;
      };

      if (r.OperStatus !== IF_OPER_STATUS_UP) continue;
      // Sans ce filtre, chaque carte serait comptée autant de fois qu'elle a
      // de couches de filtrage empilées (6 fois pour le Wi-Fi sur la machine
      // de test), toutes avec les mêmes compteurs.
      if (r.InterfaceAndOperStatusFlags & FLAG_FILTER_INTERFACE) continue;

      rows.push({
        name: r.Alias,
        description: r.Description,
        bytesReceived: Number(r.InOctets),
        bytesSent: Number(r.OutOctets),
      });
    }
    return rows;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    return null;
  } finally {
    // `GetIfTable2` alloue la table : ne pas la libérer fuirait à chaque tick.
    try {
      net.freeMibTable(tablePtr);
    } catch {
      /* rien à faire de plus */
    }
  }
}
