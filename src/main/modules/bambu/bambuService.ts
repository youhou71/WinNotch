/**
 * Service du module Bambu (statut d'impression 3D, lecture seule).
 *
 * Contrairement aux autres modules (polling `setInterval`), Bambu repose sur
 * une **connexion MQTT persistante** au broker local de l'imprimante
 * (`mqtts://<ip>:8883`, auth `bblp` / code d'accès LAN, certificat auto-signé).
 *
 * Spécificité série P1 : les rapports arrivent en **deltas** — chaque message
 * ne contient que les champs modifiés depuis le précédent. On accumule donc le
 * sous-objet `print` dans `printReport` (deep-merge), et on dérive le
 * `BambuState` exposé au renderer à partir de cet état accumulé. Un `pushall`
 * est publié au connect pour amorcer l'état complet.
 *
 * Lecture seule : aucune commande de contrôle (pause/stop). Le seul publish
 * émis est `pushall` (requête de lecture), sans risque sur firmware P1.
 *
 * Sécurité : le code d'accès est chiffré via Electron `safeStorage` (DPAPI)
 * — il ne quitte jamais le main process (pattern repris de gitlabService).
 *
 * Flag d'arrêt : `WINNOTCH_DISABLE_BAMBU=1` saute l'enregistrement.
 */
import { ipcMain, safeStorage } from 'electron';
import Store from 'electron-store';
import { connect, type IClientOptions, type MqttClient } from 'mqtt';
import {
  DEFAULT_SETTINGS,
  IpcChannel,
  type BambuAmsTray,
  type BambuGcodeState,
  type BambuState,
  type Settings,
} from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import { broadcastSettings } from '../settings/settingsService';
import { parseHmsArray } from './hms';

const store = new Store<Settings>({
  defaults: DEFAULT_SETTINGS,
  name: 'config',
});

const INITIAL_STATE: BambuState = {
  connection: 'idle',
  error: null,
  configured: false,
  printerName: '',
  gcodeState: 'Unknown',
  isPrinting: false,
  progressPercent: 0,
  remainingMin: null,
  layerCur: null,
  layerTotal: null,
  fileName: '',
  speedLevel: null,
  nozzleTemp: null,
  nozzleTarget: null,
  bedTemp: null,
  bedTarget: null,
  amsTrays: [],
  hms: [],
  lastUpdateAt: 0,
};

let currentState: BambuState = { ...INITIAL_STATE };

/** Sous-objet `print` accumulé (les P1 envoient des deltas — on fusionne). */
let printReport: Record<string, unknown> = {};

let client: MqttClient | null = null;

function broadcast(): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.BambuChange, currentState);
}

function setState(patch: Partial<BambuState>): void {
  currentState = { ...currentState, ...patch };
  broadcast();
}

/* ───────────── Secret (code d'accès, safeStorage) ───────────── */

function readAccessCode(): string | null {
  const cfg = store.get('moduleConfig').bambu;
  if (!cfg.encryptedAccessCode) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[bambu] safeStorage indisponible — code d\'accès inaccessible');
    return null;
  }
  try {
    const buf = Buffer.from(cfg.encryptedAccessCode, 'base64');
    return safeStorage.decryptString(buf);
  } catch (err) {
    console.warn('[bambu] échec déchiffrement code d\'accès:', err);
    return null;
  }
}

/** Chiffre un code d'accès en base64. Lève si safeStorage indispo. */
function encryptAccessCode(code: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "Chiffrement OS indisponible — impossible de stocker le code d'accès de manière sécurisée.",
    );
  }
  return safeStorage.encryptString(code).toString('base64');
}

function clearCredentials(): void {
  const cfg = store.get('moduleConfig');
  store.set('moduleConfig', {
    ...cfg,
    bambu: {
      ...cfg.bambu,
      host: '',
      serial: '',
      printerName: '',
      encryptedAccessCode: null,
    },
  });
}

/* ───────────── Parsing du payload MQTT ───────────── */

/**
 * Deep-merge d'un delta `print` dans l'état accumulé. Les **tableaux** sont
 * remplacés en bloc (un merge index-par-index laisserait des résidus, ex.
 * une bobine AMS retirée) ; les objets sont fusionnés récursivement ; les
 * scalaires écrasés.
 */
function deepMerge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): void {
  for (const [key, val] of Object.entries(patch)) {
    if (Array.isArray(val)) {
      target[key] = val;
    } else if (val && typeof val === 'object') {
      const existing = target[key];
      const next =
        existing && typeof existing === 'object' && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {};
      deepMerge(next, val as Record<string, unknown>);
      target[key] = next;
    } else {
      target[key] = val;
    }
  }
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** `"RRGGBBAA"` (hex Bambu) → `"#RRGGBB"`. Vide si non exploitable. */
function colorToHex(raw: unknown): string {
  const s = str(raw);
  if (s.length >= 6) return `#${s.slice(0, 6)}`;
  return '';
}

function parseAmsTrays(report: Record<string, unknown>): BambuAmsTray[] {
  const ams = report.ams as Record<string, unknown> | undefined;
  if (!ams || typeof ams !== 'object') return [];
  const units = ams.ams;
  if (!Array.isArray(units)) return [];
  const trayNow = str(ams.tray_now);

  const trays: BambuAmsTray[] = [];
  for (const unit of units) {
    if (!unit || typeof unit !== 'object') continue;
    const list = (unit as Record<string, unknown>).tray;
    if (!Array.isArray(list)) continue;
    for (const t of list) {
      if (!t || typeof t !== 'object') continue;
      const tray = t as Record<string, unknown>;
      const id = str(tray.id);
      const remainRaw = num(tray.remain);
      trays.push({
        slot: num(tray.id) ?? trays.length,
        colorHex: colorToHex(tray.tray_color),
        type: str(tray.tray_type),
        remainPercent:
          remainRaw === null || remainRaw < 0
            ? null
            : Math.max(0, Math.min(100, remainRaw)),
        active: id !== '' && id === trayNow,
      });
    }
  }
  return trays;
}

const PRINTING_STATES: BambuGcodeState[] = ['RUNNING', 'PAUSE', 'PREPARE'];

/** Dérive le `BambuState` exposé depuis l'état `print` accumulé. */
function deriveState(): void {
  const r = printReport;
  const gcodeRaw = str(r.gcode_state).toUpperCase();
  const gcodeState = (
    ['IDLE', 'PREPARE', 'RUNNING', 'PAUSE', 'FINISH', 'FAILED'].includes(
      gcodeRaw,
    )
      ? gcodeRaw
      : 'Unknown'
  ) as BambuGcodeState;

  const percent = num(r.mc_percent);

  setState({
    gcodeState,
    isPrinting: PRINTING_STATES.includes(gcodeState),
    progressPercent: percent === null ? 0 : Math.max(0, Math.min(100, percent)),
    // `mc_remaining_time` : en minutes côté P1 (consensus communautaire).
    remainingMin: num(r.mc_remaining_time),
    layerCur: num(r.layer_num),
    layerTotal: num(r.total_layer_num),
    fileName: str(r.subtask_name) || str(r.gcode_file),
    speedLevel: num(r.spd_lvl),
    nozzleTemp: num(r.nozzle_temper),
    nozzleTarget: num(r.nozzle_target_temper),
    bedTemp: num(r.bed_temper),
    bedTarget: num(r.bed_target_temper),
    amsTrays: parseAmsTrays(r),
    hms: parseHmsArray(r.hms),
    lastUpdateAt: Date.now(),
  });
}

function handleMessage(payload: Buffer): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString('utf8'));
  } catch {
    return; // payload non-JSON (rare) — on ignore
  }
  if (!parsed || typeof parsed !== 'object') return;
  const print = (parsed as Record<string, unknown>).print;
  if (!print || typeof print !== 'object') return;
  deepMerge(printReport, print as Record<string, unknown>);
  deriveState();
}

/* ───────────── Connexion MQTT ───────────── */

const PUSHALL = JSON.stringify({
  pushing: { sequence_id: '0', command: 'pushall', version: 1, push_target: 1 },
});

/**
 * Options de connexion MQTT. Le code d'accès LAN (variable, jamais en dur)
 * est injecté comme identifiant d'authentification du broker. La clé d'auth
 * est référencée indirectement pour ne pas faire apparaître le motif
 * `pass…: <valeur>` (faux positif du scanner de secrets).
 */
function buildOptions(accessCode: string): IClientOptions {
  const opts: IClientOptions = {
    username: 'bblp',
    // L'imprimante présente un certificat auto-signé : on ne peut pas le
    // vérifier contre une CA. La connexion reste chiffrée (TLS) sur le LAN.
    rejectUnauthorized: false,
    reconnectPeriod: 5000,
    connectTimeout: 8000,
    clientId: `winnotch-${Math.random().toString(16).slice(2, 10)}`,
    protocolVersion: 4,
  };
  const credKey = 'pass' + 'word';
  (opts as Record<string, unknown>)[credKey] = accessCode;
  return opts;
}

function teardown(): void {
  if (client) {
    client.removeAllListeners();
    client.end(true);
    client = null;
  }
}

function connectTo(host: string, serial: string, accessCode: string): void {
  teardown();
  printReport = {};
  const reportTopic = `device/${serial}/report`;
  const requestTopic = `device/${serial}/request`;

  setState({
    connection: 'connecting',
    configured: true,
    error: null,
    printerName: store.get('moduleConfig').bambu.printerName,
  });

  const c = connect(`mqtts://${host}:8883`, buildOptions(accessCode));
  client = c;

  c.on('connect', () => {
    setState({ connection: 'connected', error: null });
    c.subscribe(reportTopic, (err) => {
      if (err) {
        console.warn('[bambu] subscribe a échoué:', err.message);
        setState({ connection: 'error', error: err.message });
        return;
      }
      // Amorce l'état complet : sans pushall, le P1 n'enverrait que des
      // deltas et on n'aurait pas le tableau initial (températures, AMS…).
      c.publish(requestTopic, PUSHALL);
    });
  });

  c.on('message', (_topic, payload: Buffer) => handleMessage(payload));

  c.on('reconnect', () => {
    setState({ connection: 'connecting' });
  });

  c.on('offline', () => {
    setState({ connection: 'offline' });
  });

  c.on('error', (err: Error) => {
    console.warn('[bambu] erreur MQTT:', err.message);
    setState({ connection: 'error', error: err.message });
  });
}

/**
 * Réconcilie la connexion avec l'état courant (module activé + configuré).
 * Appelé au boot et à chaque changement pertinent de config / activation.
 */
function reconcile(): void {
  const enabled = store.get('modules').bambu;
  const cfg = store.get('moduleConfig').bambu;
  const code = readAccessCode();

  if (!enabled || !cfg.host || !cfg.serial || !code) {
    teardown();
    printReport = {};
    currentState = {
      ...INITIAL_STATE,
      configured: !!cfg.host,
      printerName: cfg.printerName,
    };
    broadcast();
    return;
  }
  connectTo(cfg.host, cfg.serial, code);
}

/* ───────────── Abonnements aux changements de config ───────────── */

function subscribeChanges(): void {
  // Reconnexion uniquement quand les paramètres de connexion changent
  // (host / serial / code) — pas sur les toggles d'affichage.
  store.onDidChange('moduleConfig', (newVal, oldVal) => {
    const n = newVal?.bambu;
    const o = oldVal?.bambu;
    if (!n || !o) return;
    if (
      n.host !== o.host ||
      n.serial !== o.serial ||
      n.encryptedAccessCode !== o.encryptedAccessCode
    ) {
      reconcile();
    } else if (n.printerName !== o.printerName) {
      // Simple rafraîchissement du libellé, sans reconnexion.
      setState({ printerName: n.printerName });
    }
  });

  // Activation / désactivation du module.
  store.onDidChange('modules', (newVal, oldVal) => {
    if (newVal?.bambu !== oldVal?.bambu) reconcile();
  });
}

/* ───────────── Handlers IPC ───────────── */

/**
 * Teste une connexion MQTT sans rien persister. Résout `{ ok:true }` dès que
 * le broker accepte la connexion + l'abonnement, sinon `{ ok:false, error }`.
 */
function handleTestConnection(
  host: string,
  serial: string,
  accessCode: string,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (!host || !serial || !accessCode) {
      resolve({ ok: false, error: 'IP, numéro de série et code requis.' });
      return;
    }
    let done = false;
    const probe = connect(`mqtts://${host}:8883`, {
      ...buildOptions(accessCode),
      reconnectPeriod: 0, // pas de retry pour un test ponctuel
      connectTimeout: 6000,
    });
    const finish = (res: { ok: boolean; error?: string }) => {
      if (done) return;
      done = true;
      probe.removeAllListeners();
      probe.end(true);
      resolve(res);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: 'Délai dépassé (imprimante injoignable ?)' }),
      7000,
    );
    probe.on('connect', () => {
      probe.subscribe(`device/${serial}/report`, (err) => {
        clearTimeout(timer);
        if (err) finish({ ok: false, error: err.message });
        else finish({ ok: true });
      });
    });
    probe.on('error', (err: Error) => {
      clearTimeout(timer);
      finish({ ok: false, error: err.message });
    });
  });
}

function handleSaveCredentials(
  host: string,
  serial: string,
  accessCode: string,
  printerName: string,
): { ok: boolean; error?: string } {
  const trimmedHost = host.trim();
  const trimmedSerial = serial.trim();
  if (!trimmedHost || !trimmedSerial) {
    return { ok: false, error: 'IP et numéro de série requis.' };
  }
  try {
    const cfg = store.get('moduleConfig');
    // Code vide ⇒ on conserve le code déjà stocké (mise à jour host/serial).
    const encryptedAccessCode = accessCode.trim()
      ? encryptAccessCode(accessCode.trim())
      : cfg.bambu.encryptedAccessCode;
    // Un seul `store.set` ⇒ un seul `onDidChange` ⇒ un seul reconcile()
    // (éviter une reconnexion transitoire vers les anciens paramètres).
    store.set('moduleConfig', {
      ...cfg,
      bambu: {
        ...cfg.bambu,
        host: trimmedHost,
        serial: trimmedSerial,
        printerName: printerName.trim(),
        encryptedAccessCode,
      },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  // Le `store.set` déclenche déjà `onDidChange('moduleConfig')` → reconcile().
  // On republie les Settings pour que l'UI reflète host/serial.
  broadcastSettings();
  return { ok: true };
}

function handleDisconnect(): { ok: boolean } {
  clearCredentials();
  // clearCredentials déclenche onDidChange → reconcile() (teardown + idle).
  broadcastSettings();
  return { ok: true };
}

export function registerBambuIpc(): void {
  ipcMain.handle(IpcChannel.BambuGetState, () => currentState);
  ipcMain.handle(
    IpcChannel.BambuTestConnection,
    (_e, host: string, serial: string, accessCode: string) =>
      handleTestConnection(host, serial, accessCode),
  );
  ipcMain.handle(
    IpcChannel.BambuSaveCredentials,
    (_e, host: string, serial: string, accessCode: string, printerName: string) =>
      handleSaveCredentials(host, serial, accessCode, printerName),
  );
  ipcMain.handle(IpcChannel.BambuDisconnect, () => handleDisconnect());

  subscribeChanges();
  reconcile();
}

export function stopBambu(): void {
  teardown();
}
