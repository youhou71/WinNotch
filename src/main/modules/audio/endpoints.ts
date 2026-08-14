/**
 * Lecture des **endpoints audio de sortie** dans le registre Windows.
 *
 * Complète `devices.ts` (SoundVolumeView) sur deux points, sans créer le
 * moindre processus — tout passe par le PowerShell résident partagé :
 *
 *  1. **Le type réel du périphérique.** Windows stocke le *form factor*
 *     déclaré par le pilote dans
 *     `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\
 *      <guid>\Properties`, valeur `{1da5d803-…},0` (PKEY_AudioEndpoint_FormFactor
 *     de l'API MMDevice). C'est une donnée du système, là où la
 *     classification par nom de `devices.ts` reste une supposition
 *     ("realtek" → haut-parleurs) qui se trompe dès qu'un fabricant nomme
 *     ses appareils autrement.
 *  2. **La détection d'un changement de matériel sans spawn.** La liste des
 *     endpoints *actifs* (`DeviceState & 1`) change quand on branche un
 *     casque, connecte un appareil Bluetooth ou pose le PC sur son dock.
 *     `audioService` s'en sert comme déclencheur pour n'appeler
 *     SoundVolumeView (1 process) que lorsqu'il y a réellement quelque
 *     chose de nouveau à apprendre.
 *
 * Ce que le registre ne dit **pas** : quelle sortie est celle par défaut.
 * Vérifié : aucune valeur ne la marque (les clés
 * `…\LowRegistry\Audio\PolicyConfig\PropertyStore` ne portent que les
 * préférences *par application*). C'est la raison d'être du garde-fou
 * `fullCheckMs` côté service — SVV reste seul juge du périphérique par
 * défaut.
 *
 * Contrainte d'écriture du script : il doit tourner en
 * `ConstrainedLanguage` (mode imposé par AppLocker/WDAC aux scripts sous
 * `%LOCALAPPDATA%`, donc à l'app installée). D'où l'usage exclusif de
 * cmdlets et de tables de hachage — ni `[pscustomobject]`, ni appel de
 * méthode .NET, ni accès à `$_.PSObject.Properties`.
 *
 * Deuxième contrainte, apprise en conditions réelles : **ne jamais émettre
 * d'erreur PowerShell**. `persistent-loop.ps1` exécute le script dans un
 * `try/catch` et renvoie `ok:false` sur la moindre exception. Or
 * `Get-ItemPropertyValue` lève une erreur **terminante** quand la valeur
 * demandée n'existe pas — que `-ErrorAction SilentlyContinue` ne couvre
 * pas — et plusieurs de ces valeurs sont optionnelles par nature (`,39`
 * n'est renseignée que sur les endpoints faisant pont vers un autre
 * appareil, typiquement Bluetooth). Un seul endpoint sans cette valeur
 * faisait donc échouer toute la lecture. On lit désormais la clé entière
 * avec `Get-ItemProperty` et on accède aux valeurs **par nom** : une
 * propriété absente vaut `$null`, sans erreur — et c'est au passage un
 * appel de cmdlet par endpoint au lieu de cinq.
 */
import { runPersistentPowershell } from '../shell/persistentPowershell';
import type { AudioDevice } from '../../../shared/types';

/**
 * Généreux au regard du coût réel de cette lecture (mesuré ~330 ms au
 * premier appel, ~80 ms à chaud pour 20 endpoints) : le premier appel de la
 * boucle paie l'autoload de ses modules, plusieurs secondes avec un EDR.
 *
 * Expirer ici n'abat **pas** le process résident partagé — l'expiration est
 * souple depuis (cf. `persistentPowershell.ts`) : la requête est abandonnée
 * seule, et seuls plusieurs abandons consécutifs sans aucune réponse font
 * conclure que la boucle est bloquée. Inutile donc de gonfler ce délai : le
 * garder court fait au contraire réagir ce filet plus vite le jour où la
 * boucle est réellement gelée.
 */
const TIMEOUT_MS = 10_000;

/** Clé de registre des endpoints de rendu (sorties). */
const RENDER_KEY =
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render';

/** PKEY_AudioEndpoint_FormFactor — catégorie déclarée par le pilote. */
const PKEY_FORM_FACTOR = '{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},0';
/** PKEY_Device_FriendlyName — nom du rôle ("Casque", "Haut-parleurs"). */
const PKEY_FRIENDLY_NAME = '{a45c254e-df1c-4efd-8020-67d146a850e0},2';
/** PKEY_Device_EnumeratorName — bus d'énumération ("USB", "BTHENUM"…). */
const PKEY_ENUMERATOR = '{a45c254e-df1c-4efd-8020-67d146a850e0},24';
/** Identifiant d'instance du device — porte "BTHENUM" pour un appareil BT. */
const PKEY_INSTANCE_ID = '{b3f8fa53-0004-438e-9003-51a46e139bfc},2';
/**
 * Identifiant d'instance du device *raccordé*, renseigné quand l'endpoint
 * est un pont (ex. « Intel Smart Sound pour audio Bluetooth » dont le
 * périphérique réel est une enceinte BT).
 */
const PKEY_ATTACHED_ID = '{b3f8fa53-0004-438e-9003-51a46e139bfc},39';

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$out = @()
foreach ($k in Get-ChildItem -Path '${RENDER_KEY}' -ErrorAction SilentlyContinue) {
  $dev = Get-ItemProperty -Path $k.PSPath -ErrorAction SilentlyContinue
  if ($null -eq $dev) { continue }
  $state = $dev.DeviceState
  if ($null -eq $state) { continue }
  # DEVICE_STATE_ACTIVE = 0x1. Windows ajoute parfois des bits hauts
  # (0x10000001 observé sur des sorties HDMI) : on teste donc le bit, pas
  # l'égalité. Les états DISABLED (2), NOTPRESENT (4) et UNPLUGGED (8)
  # n'ont pas ce bit et sont écartés — ce sont eux qui rendent la liste
  # sensible au branchement d'un casque.
  if (($state -band 1) -ne 1) { continue }
  # Lecture de la clé entière puis accès par nom : une valeur absente vaut
  # $null au lieu de lever une erreur terminante (cf. en-tête du module).
  $p = Get-ItemProperty -Path (Join-Path $k.PSPath 'Properties') -ErrorAction SilentlyContinue
  if ($null -eq $p) { continue }
  $row = @{ id = $k.PSChildName }
  $row['ff'] = $p.'${PKEY_FORM_FACTOR}'
  $row['name'] = $p.'${PKEY_FRIENDLY_NAME}'
  $row['bus'] = $p.'${PKEY_ENUMERATOR}'
  $row['inst'] = $p.'${PKEY_INSTANCE_ID}'
  $row['att'] = $p.'${PKEY_ATTACHED_ID}'
  $out += $row
}
ConvertTo-Json @($out) -Compress -Depth 3
`;

/** Une sortie active telle que décrite par le registre. */
export interface AudioEndpointInfo {
  /** GUID de l'endpoint, sans accolades retirées (`{35e0c1b9-…}`). */
  guid: string;
  /** Catégorie déduite du form factor, ou `null` si absent/inconnu. */
  type: AudioDevice['type'] | null;
  /** Nom de rôle du registre ("Casque", "Haut-parleurs"). Peut être vide. */
  name: string;
  /** Raccordé en Bluetooth. */
  bluetooth: boolean;
}

interface RawRow {
  id?: string;
  ff?: number | string;
  name?: string;
  bus?: string;
  inst?: string;
  att?: string;
}

/**
 * Traduction de `EndpointFormFactor` (MMDevice API) vers nos catégories.
 * Les valeurs non listées (0 RemoteNetworkDevice, 2 LineLevel,
 * 7 UnknownDigitalPassthrough, 8 SPDIF, 10 UnknownFormFactor…) tombent en
 * `other` : mieux vaut une icône générique qu'une icône fausse.
 */
function typeFromFormFactor(ff: number): AudioDevice['type'] | null {
  switch (ff) {
    case 1: // Speakers
      return 'speakers';
    case 3: // Headphones
      return 'headphones';
    case 5: // Headset (casque + micro)
      return 'headset';
    case 9: // DigitalAudioDisplayDevice (HDMI / DisplayPort)
      return 'display';
    case 0:
    case 2:
    case 4:
    case 6:
    case 7:
    case 8:
    case 10:
      return 'other';
    default:
      return null;
  }
}

/** Un des identifiants du device trahit-il un raccordement Bluetooth ? */
function looksBluetooth(row: RawRow): boolean {
  const haystack = `${row.bus ?? ''} ${row.inst ?? ''} ${row.att ?? ''}`.toUpperCase();
  return haystack.includes('BTHENUM') || haystack.includes('BLUETOOTH');
}

/**
 * Dernier message d'échec déjà journalisé. La lecture est répétée à la
 * cadence de surveillance (5 s par défaut) : sans déduplication, un
 * environnement où elle échoue durablement (PowerShell résident abandonné en
 * ConstrainedLanguage) noierait la console. Remis à `null` au premier succès,
 * pour qu'un incident ultérieur soit de nouveau visible.
 */
let lastWarning: string | null = null;

function warnOnce(message: string): void {
  if (lastWarning === message) return;
  lastWarning = message;
  console.warn(`[audio/endpoints] ${message}`);
}

/**
 * Lit les endpoints de sortie actifs. Retourne une liste vide si le script
 * échoue (PowerShell résident indisponible, coupe-circuit ouvert, poste
 * verrouillé…) : l'appelant retombe alors sur la classification par nom,
 * sans jamais se retrouver bloqué.
 */
export async function listActiveEndpoints(): Promise<AudioEndpointInfo[]> {
  if (process.env.WINNOTCH_DISABLE_AUDIO_REGISTRY === '1') return [];
  const { stdout, error } = await runPersistentPowershell(SCRIPT, TIMEOUT_MS);
  if (error) {
    warnOnce(`lecture registre en échec: ${error}`);
    return [];
  }
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  let rows: RawRow[];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    // `ConvertTo-Json` sur un tableau d'un seul élément peut sortir un objet
    // seul selon la version de PowerShell, malgré le `@()`.
    rows = Array.isArray(parsed) ? (parsed as RawRow[]) : [parsed as RawRow];
  } catch {
    warnOnce('sortie PowerShell inexploitable.');
    return [];
  }
  lastWarning = null;
  const out: AudioEndpointInfo[] = [];
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id) continue;
    const ff = typeof row.ff === 'number' ? row.ff : Number.parseInt(String(row.ff ?? ''), 10);
    out.push({
      guid: row.id.toLowerCase(),
      type: Number.isFinite(ff) ? typeFromFormFactor(ff) : null,
      name: typeof row.name === 'string' ? row.name : '',
      bluetooth: looksBluetooth(row),
    });
  }
  return out;
}

/**
 * Signature compacte d'un jeu d'endpoints : change dès qu'une sortie
 * apparaît, disparaît ou change de nature. `audioService` la compare d'un
 * tick au suivant pour décider s'il vaut la peine de dépenser un spawn SVV.
 */
export function endpointsSignature(endpoints: AudioEndpointInfo[]): string {
  return endpoints
    .map((e) => `${e.guid}:${e.type ?? '?'}:${e.bluetooth ? 'bt' : '-'}`)
    .sort()
    .join('|');
}

/**
 * Extrait le GUID d'endpoint d'un identifiant SoundVolumeView.
 *
 * SVV expose `Item ID` sous la forme `{0.0.0.00000000}.{35e0c1b9-…}` : le
 * **second** GUID est la clé du registre. Le "Command-Line Friendly ID"
 * (`<Nom>\Device\Render\…`) n'en contient aucun, d'où la nécessité de
 * garder l'`Item ID` à part pour faire la jointure.
 */
export function endpointGuidFromItemId(itemId: string | undefined): string | null {
  if (!itemId) return null;
  const matches = itemId.match(/\{[0-9a-fA-F-]{36}\}/g);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1].toLowerCase();
}
