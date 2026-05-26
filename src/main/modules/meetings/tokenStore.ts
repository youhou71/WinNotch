/**
 * Chiffrement/déchiffrement des refresh tokens via Electron `safeStorage`.
 *
 * `safeStorage` utilise DPAPI sur Windows (clé liée au compte utilisateur
 * + machine). Le payload chiffré est sérialisé en base64 pour pouvoir
 * être stocké en string dans electron-store.
 *
 * Si `safeStorage.isEncryptionAvailable()` retourne `false` (cas rare,
 * ex. premier lancement avant que le KeyChain/Credentials Manager soit
 * disponible), on bascule en clair avec un warning loggé.
 */
import { safeStorage } from 'electron';
import type { OAuthTokens } from './oauth';

interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
}

function isAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** Sérialise + chiffre les tokens en string base64. */
export function encryptTokens(tokens: OAuthTokens): string {
  const stored: StoredTokens = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
  };
  const plain = JSON.stringify(stored);
  if (!isAvailable()) {
    console.warn(
      '[meetings] safeStorage indisponible — tokens persistés en clair (base64). Risque de fuite si quelqu\'un lit le fichier de config.',
    );
    // Marqueur `plain:` pour différencier au déchiffrement.
    return 'plain:' + Buffer.from(plain, 'utf8').toString('base64');
  }
  const encrypted = safeStorage.encryptString(plain);
  return 'enc:' + encrypted.toString('base64');
}

/** Inverse — retourne null si le déchiffrement échoue. */
export function decryptTokens(payload: string): OAuthTokens | null {
  try {
    if (payload.startsWith('plain:')) {
      const json = Buffer.from(payload.slice(6), 'base64').toString('utf8');
      return JSON.parse(json) as OAuthTokens;
    }
    if (payload.startsWith('enc:')) {
      const buf = Buffer.from(payload.slice(4), 'base64');
      const plain = safeStorage.decryptString(buf);
      return JSON.parse(plain) as OAuthTokens;
    }
    return null;
  } catch (err) {
    console.warn('[meetings] decryptTokens a échoué:', err);
    return null;
  }
}
