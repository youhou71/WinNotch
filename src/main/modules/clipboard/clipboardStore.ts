/**
 * Persistance chiffrée de l'historique du presse-papier.
 *
 * Pattern identique à `meetings/tokenStore.ts` : on chiffre le JSON
 * sérialisé via Electron `safeStorage` (DPAPI sur Windows) et on stocke
 * la valeur base64 dans un electron-store DÉDIÉ (`clipboard-history.json`),
 * plus `clipboardLastSeenAt` pour le timestamp du dernier "vu" — pas
 * sensible, stocké en clair.
 *
 * Pourquoi un fichier dédié (audit perf P9) : l'historique chiffré pèse
 * vite des centaines de Ko ; logé dans `config.json`, il gonflait le
 * fichier que CHAQUE `store.get()` de TOUS les services relit en
 * synchrone à chaque tick (settings, audio, system, gitlocal…). Une
 * migration one-shot rapatrie les anciennes clés depuis `config.json`.
 *
 * Écriture débouncée (audit perf P9) : chaque copie re-chiffrait (DPAPI
 * synchrone) et réécrivait TOUT l'historique immédiatement. On coalesce à
 * 2 s — `flushHistory()` est appelé à l'arrêt du module pour ne rien
 * perdre à la fermeture de l'app.
 *
 * Si `safeStorage.isEncryptionAvailable()` retourne false (premier
 * lancement avant que le KeyChain/Credentials Manager soit prêt, ou
 * machine sans support DPAPI), fallback en clair base64 avec warning.
 * Les images ne passent JAMAIS par ici — elles vivent en PNG sur disque
 * (cf. `imageStore.ts`).
 */
import { safeStorage } from 'electron';
import Store from 'electron-store';
import type { ClipboardEntry } from '../../../shared/types';

interface ClipboardStoreSchema {
  /** Payload chiffré ou plain base64. */
  clipboardHistory: string;
  /** Unix ms du dernier "markSeen". */
  clipboardLastSeenAt: number;
}

const SAVE_DEBOUNCE_MS = 2000;

const store = new Store<ClipboardStoreSchema>({
  defaults: {
    clipboardHistory: '',
    clipboardLastSeenAt: 0,
  },
  name: 'clipboard-history',
});

/**
 * Migration one-shot : rapatrie l'historique depuis `config.json` (où il
 * vivait avant l'audit perf P9) puis supprime les anciennes clés pour
 * dégonfler le fichier. Idempotent : une fois les clés absentes, no-op.
 */
let migrated = false;
function migrateFromConfigIfNeeded(): void {
  if (migrated) return;
  migrated = true;
  try {
    const legacy = new Store<Record<string, unknown>>({ name: 'config' });
    const oldHistory = legacy.get('clipboardHistory') as string | undefined;
    const oldSeenAt = legacy.get('clipboardLastSeenAt') as number | undefined;
    if (typeof oldHistory === 'string' && oldHistory && !store.get('clipboardHistory')) {
      store.set('clipboardHistory', oldHistory);
    }
    if (typeof oldSeenAt === 'number' && oldSeenAt && !store.get('clipboardLastSeenAt')) {
      store.set('clipboardLastSeenAt', oldSeenAt);
    }
    if (oldHistory !== undefined) legacy.delete('clipboardHistory' as never);
    if (oldSeenAt !== undefined) legacy.delete('clipboardLastSeenAt' as never);
    if (oldHistory !== undefined || oldSeenAt !== undefined) {
      console.log('[clipboard] historique migré de config.json vers clipboard-history.json');
    }
  } catch (err) {
    console.warn('[clipboard] migration depuis config.json échouée (non bloquant):', err);
  }
}

function isAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encrypt(entries: ClipboardEntry[]): string {
  const plain = JSON.stringify(entries);
  if (!isAvailable()) {
    console.warn(
      '[clipboard] safeStorage indisponible — historique persisté en clair (base64). Risque de fuite si quelqu\'un lit le fichier de config.',
    );
    return 'plain:' + Buffer.from(plain, 'utf8').toString('base64');
  }
  const encrypted = safeStorage.encryptString(plain);
  return 'enc:' + encrypted.toString('base64');
}

function decrypt(payload: string): ClipboardEntry[] {
  if (!payload) return [];
  try {
    if (payload.startsWith('plain:')) {
      const json = Buffer.from(payload.slice(6), 'base64').toString('utf8');
      return JSON.parse(json) as ClipboardEntry[];
    }
    if (payload.startsWith('enc:')) {
      const buf = Buffer.from(payload.slice(4), 'base64');
      const plain = safeStorage.decryptString(buf);
      return JSON.parse(plain) as ClipboardEntry[];
    }
    return [];
  } catch (err) {
    console.warn('[clipboard] décryptage de l\'historique échoué — on repart vide:', err);
    return [];
  }
}

export function loadHistory(): ClipboardEntry[] {
  migrateFromConfigIfNeeded();
  return decrypt(store.get('clipboardHistory'));
}

/* ───────────── Écriture débouncée ───────────── */

let pendingEntries: ClipboardEntry[] | null = null;
let saveTimer: NodeJS.Timeout | null = null;

/**
 * Programme la persistance (chiffrement DPAPI + écriture du fichier
 * complet) au plus une fois toutes les SAVE_DEBOUNCE_MS. Une rafale de
 * copies ne coûte qu'une écriture ; seule la dernière version compte.
 */
export function saveHistory(entries: ClipboardEntry[]): void {
  pendingEntries = entries;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushHistory();
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Écrit immédiatement la version en attente, s'il y en a une. Appelé par
 * le débounce, et par `stopClipboard()` à la fermeture de l'app pour ne
 * pas perdre les dernières copies.
 */
export function flushHistory(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (pendingEntries === null) return;
  const entries = pendingEntries;
  pendingEntries = null;
  store.set('clipboardHistory', encrypt(entries));
}

export function loadLastSeenAt(): number {
  migrateFromConfigIfNeeded();
  return store.get('clipboardLastSeenAt');
}

export function saveLastSeenAt(ts: number): void {
  store.set('clipboardLastSeenAt', ts);
}
