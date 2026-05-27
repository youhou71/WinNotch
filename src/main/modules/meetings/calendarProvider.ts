/**
 * Interface commune CalendarProvider — implémentée par outlookProvider
 * et googleProvider. Le `meetingsService` ne connaît que cette interface,
 * ce qui permet d'ajouter un 3ᵉ provider plus tard sans toucher au reste.
 */
import type {
  CalendarAccount,
  CalendarInfo,
  CalendarProviderId,
  Meeting,
  OAuthClientCredentials,
  OutlookCategory,
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
   * Liste les calendriers disponibles sur le compte (perso + partagés).
   * Le `isPrimary` est positionné quand le provider distingue le
   * calendrier principal — on s'en sert pour cocher par défaut une
   * sélection minimale au premier connect.
   */
  listCalendars(accessToken: string): Promise<CalendarInfo[]>;

  /**
   * Liste les meetings d'un calendrier précis dans une fenêtre
   * [now, now + windowHours]. Le mapping vers `Meeting` est fait par le
   * provider. Le service appelle cette méthode une fois par calendrier
   * sélectionné — la concurrence est gérée côté service.
   */
  listUpcomingMeetings(args: {
    account: CalendarAccount;
    accessToken: string;
    windowHours: number;
    calendarId: string;
  }): Promise<Meeting[]>;

  /**
   * Récupère la photo de profil du compte connecté, encodée en data URL
   * (`data:image/jpeg;base64,…`). Retourne null si le provider n'a pas
   * de photo pour ce compte (404), ou si la feature n'est pas supportée.
   */
  fetchSelfPhoto?(accessToken: string): Promise<string | null>;

  /**
   * Liste les "catégories de couleur" définies par l'utilisateur côté
   * provider. Optionnel : Outlook expose `/me/outlook/masterCategories`,
   * Google n'a pas d'équivalent — la méthode n'est pas implémentée pour
   * Google et le service teste sa présence avant l'appel.
   */
  listCategories?(accessToken: string): Promise<OutlookCategory[]>;
}
