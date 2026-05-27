/**
 * Interface commune CalendarProvider — implémentée par outlookProvider
 * et googleProvider. Le `meetingsService` ne connaît que cette interface,
 * ce qui permet d'ajouter un 3ᵉ provider plus tard sans toucher au reste.
 */
import type {
  CalendarAccount,
  CalendarProviderId,
  Meeting,
  OAuthClientCredentials,
} from '../../../shared/types';
import type { OAuthTokens } from './oauth';

export interface CalendarProvider {
  /** Identifiant du provider. */
  readonly id: CalendarProviderId;

  /**
   * Démarre le flow OAuth dans le navigateur et retourne les tokens
   * et l'email du compte connecté (lu depuis l'API user info).
   */
  startAuth(
    credentials: OAuthClientCredentials,
  ): Promise<{ tokens: OAuthTokens; email: string }>;

  /**
   * Renouvelle l'access token expiré à partir du refresh token.
   * Si le provider retourne un nouveau refresh token, il est inclus.
   */
  refresh(
    credentials: OAuthClientCredentials,
    refreshToken: string,
  ): Promise<OAuthTokens>;

  /**
   * Liste les meetings dans une fenêtre [now, now + windowHours].
   * Le mapping vers `Meeting` est fait par le provider.
   */
  listUpcomingMeetings(args: {
    account: CalendarAccount;
    accessToken: string;
    windowHours: number;
  }): Promise<Meeting[]>;

  /**
   * Récupère la photo de profil du compte connecté, encodée en data URL
   * (`data:image/jpeg;base64,…`). Retourne null si le provider n'a pas
   * de photo pour ce compte (404), ou si la feature n'est pas supportée.
   */
  fetchSelfPhoto?(accessToken: string): Promise<string | null>;
}
