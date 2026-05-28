/**
 * Helpers de gestion des tokens OAuth des `CalendarAccount` (Outlook +
 * Google), extraits de `meetingsService` pour permettre leur réutilisation
 * par d'autres modules qui partagent les mêmes comptes (ex. teams).
 *
 * Garantie : `ensureAccessToken` est la seule porte d'entrée pour obtenir
 * un `accessToken` valide depuis un `CalendarAccount` persisté. Refresh
 * automatique si expiré, persistance immédiate des nouveaux tokens via
 * le callback `persistAccount` fourni par l'appelant (qui sait comment
 * écrire dans son propre slice du store).
 */
import type {
  CalendarAccount,
  OAuthClientCredentials,
} from '../../../shared/types';
import { decryptTokens, encryptTokens } from './tokenStore';
import type { CalendarProvider } from './calendarProvider';
import type { OAuthTokens } from './oauth';

/** Marge sous laquelle on considère le token comme expiré (ms). */
const REFRESH_MARGIN_MS = 60_000;

/**
 * Résultat d'un appel à `ensureAccessToken`. `account` est le compte
 * éventuellement mis à jour (nouveaux tokens chiffrés, nouveau `expiresAt`),
 * que l'appelant doit propager dans son store via `persistAccount`.
 */
export interface EnsuredToken {
  account: CalendarAccount;
  accessToken: string;
}

export interface EnsureAccessTokenArgs {
  account: CalendarAccount;
  /** Provider Calendar associé au compte (outlookProvider / googleProvider). */
  provider: CalendarProvider;
  /** Credentials OAuth (clientId / tenantId / clientSecret) pour le refresh. */
  credentials: OAuthClientCredentials;
  /**
   * Callback appelé quand les tokens ont été rafraîchis. L'appelant
   * persiste le compte mis à jour dans son store (synchronisé) ou
   * met à jour un cache. Pas appelé si le token existant est encore
   * valide.
   */
  persistAccount: (updated: CalendarAccount) => void;
}

/**
 * Assure qu'un access token valide est disponible pour un compte.
 *
 * - Si l'access token est encore valide pour > 60 s, le retourne tel quel.
 * - Sinon, tente un refresh via le provider et persiste le nouveau compte
 *   avec `persistAccount` avant de retourner les tokens frais.
 *
 * Retourne `null` si :
 *  - les tokens chiffrés du compte sont illisibles (DPAPI corrompu),
 *  - aucun refresh token n'est disponible (compte déconnecté à reconnecter),
 *  - le refresh échoue côté provider (refresh token mort, scope retiré).
 */
export async function ensureAccessToken(
  args: EnsureAccessTokenArgs,
): Promise<EnsuredToken | null> {
  const { account, provider, credentials, persistAccount } = args;

  const tokens = decryptTokens(account.encryptedTokens);
  if (!tokens) return null;

  if (tokens.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return { account, accessToken: tokens.accessToken };
  }

  if (!tokens.refreshToken) {
    console.warn(
      `[tokenHelpers] Pas de refresh token pour ${account.email} — reconnexion nécessaire.`,
    );
    return null;
  }

  try {
    const newTokens: OAuthTokens = await provider.refresh(
      credentials,
      tokens.refreshToken,
    );
    const updatedAccount: CalendarAccount = {
      ...account,
      encryptedTokens: encryptTokens(newTokens),
      expiresAt: newTokens.expiresAt,
    };
    persistAccount(updatedAccount);
    return { account: updatedAccount, accessToken: newTokens.accessToken };
  } catch (err) {
    console.warn(
      `[tokenHelpers] refresh token KO pour ${account.email}:`,
      err,
    );
    return null;
  }
}
