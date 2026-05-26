/**
 * Persistance chiffrée de l'historique du presse-papier.
 *
 * Pattern identique à `meetings/tokenStore.ts` : on chiffre le JSON
 * sérialisé via Electron `safeStorage` (DPAPI sur Windows) et on stocke
 * la valeur base64 dans le electron-store de WinNotch (clé dédiée
 * `clipboardHistory`, et `clipboardLastSeenAt` pour le timestamp du
 * dernier "vu" — pas sensible, stocké en clair).
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

const store = new Store<ClipboardStoreSchema>({
  defaults: {
    clipboardHistory: '',
    clipboardLastSeenAt: 0,
  },
  name: 'config', // même fichier que settings — `name:'config'` partage le store.
});

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
  return decrypt(store.get('clipboardHistory'));
}

export function saveHistory(entries: ClipboardEntry[]): void {
  store.set('clipboardHistory', encrypt(entries));
}

export function loadLastSeenAt(): number {
  return store.get('clipboardLastSeenAt');
}

export function saveLastSeenAt(ts: number): void {
  store.set('clipboardLastSeenAt', ts);
}
