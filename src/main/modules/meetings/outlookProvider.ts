/**
 * Provider Outlook / Microsoft 365 via Microsoft Graph.
 *
 * Endpoints :
 *  - Auth     : https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
 *  - Token    : https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 *  - Calendar : GET /me/calendarView?startDateTime=…&endDateTime=…
 *  - User     : GET /me  (pour récupérer l'email du compte connecté)
 *
 * Scope minimal : `Calendars.Read Presence.ReadWrite User.Read offline_access`.
 * `offline_access` est requis pour obtenir un refresh token.
 * `Presence.ReadWrite` est utilisé par le module Teams (lecture + écriture
 * du statut de présence Teams). Les comptes existants connectés avec
 * l'ancien scope continuent de fonctionner pour Meetings, mais le premier
 * `GET /me/presence` renverra 403 jusqu'à ce que l'utilisateur reconnecte
 * son compte (re-consent).
 *
 * Le tenant par défaut est `common` (multi-tenant + comptes perso).
 * Pour restreindre à une org spécifique, l'utilisateur saisit son
 * tenant ID dans `OAuthClientCredentials.tenantId`.
 */
import type {
  CalendarInfo,
  Meeting,
  MeetingAttendee,
  OAuthClientCredentials,
  OutlookCategory,
} from '../../../shared/types';
import { startAuthFlow, refreshAccessToken, type OAuthTokens } from './oauth';
import type { CalendarProvider } from './calendarProvider';
import { detectKind, deriveTiming } from './meetingMapper';

const SCOPE = 'Calendars.Read Presence.ReadWrite User.Read offline_access';

function tenant(creds: OAuthClientCredentials): string {
  return creds.tenantId?.trim() || 'common';
}

function authUrl(creds: OAuthClientCredentials): string {
  return `https://login.microsoftonline.com/${tenant(creds)}/oauth2/v2.0/authorize`;
}

function tokenUrl(creds: OAuthClientCredentials): string {
  return `https://login.microsoftonline.com/${tenant(creds)}/oauth2/v2.0/token`;
}

interface GraphEmailAddress {
  name?: string;
  address?: string;
}

interface GraphEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  location?: { displayName?: string };
  onlineMeeting?: { joinUrl?: string };
  organizer?: { emailAddress?: GraphEmailAddress };
  attendees?: Array<{ emailAddress?: GraphEmailAddress }>;
  isCancelled?: boolean;
  webLink?: string;
  /** Catégories de couleur (noms) attachées par l'utilisateur. */
  categories?: string[];
}

/**
 * Construit la liste des participants triée organisateur en premier.
 * Dédupe sur l'email pour éviter l'organisateur en double quand Graph
 * l'inclut aussi dans la liste `attendees`.
 *
 * Injecte `photoDataUrl` sur l'attendee dont l'email matche celui du
 * compte connecté (V1 : sa propre photo uniquement).
 */
function mapAttendees(
  e: GraphEvent,
  selfEmail: string,
  selfPhotoDataUrl: string | undefined,
): MeetingAttendee[] {
  const organizerEmail = e.organizer?.emailAddress?.address?.toLowerCase() ?? '';
  const selfLower = selfEmail.toLowerCase();

  const decorate = (a: MeetingAttendee): MeetingAttendee => {
    if (
      selfPhotoDataUrl &&
      a.email &&
      a.email.toLowerCase() === selfLower
    ) {
      return { ...a, photoDataUrl: selfPhotoDataUrl };
    }
    return a;
  };

  const organizer: MeetingAttendee | null = e.organizer?.emailAddress
    ? decorate({
        name: e.organizer.emailAddress.name ?? '',
        email: e.organizer.emailAddress.address ?? '',
        isOrganizer: true,
      })
    : null;

  const others: MeetingAttendee[] = (e.attendees ?? [])
    .filter(
      (a) =>
        a.emailAddress?.address &&
        a.emailAddress.address.toLowerCase() !== organizerEmail,
    )
    .map((a) =>
      decorate({
        name: a.emailAddress?.name ?? '',
        email: a.emailAddress?.address ?? '',
        isOrganizer: false,
      }),
    );

  return organizer ? [organizer, ...others] : others;
}

async function fetchUserEmail(accessToken: string): Promise<string> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`/me failed: ${res.status}`);
  const json = (await res.json()) as { mail?: string; userPrincipalName?: string };
  return json.mail ?? json.userPrincipalName ?? 'unknown@outlook';
}

/**
 * Lit la photo de profil du compte connecté via /me/photo/$value.
 * Retourne une data URL (base64) ou null si pas de photo (404) ou
 * permission manquante (403). Pas d'exception levée pour ces cas
 * "normaux" — la photo est un bonus, son absence ne doit pas casser
 * le polling des meetings.
 */
async function fetchSelfPhotoOutlook(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export const outlookProvider: CalendarProvider = {
  id: 'outlook',

  async startAuth(creds, opts) {
    const tokens = await startAuthFlow({
      authUrl: authUrl(creds),
      tokenUrl: tokenUrl(creds),
      clientId: creds.clientId,
      // Microsoft accepte le clientSecret pour les confidential clients
      // mais pour les desktop apps en Authorization Code + PKCE on
      // **ne doit pas** envoyer de secret. Donc on ignore creds.clientSecret.
      scope: SCOPE,
      // `prompt=consent` force le consentement (ré-élève les scopes
      // d'un compte existant). Sinon `prompt=select_account` pour le
      // multi-comptes au connect initial.
      extraAuthParams: {
        prompt: opts?.promptConsent ? 'consent' : 'select_account',
      },
    });
    const email = await fetchUserEmail(tokens.accessToken);
    return { tokens, email };
  },

  async refresh(creds, refreshToken): Promise<OAuthTokens> {
    return refreshAccessToken(
      {
        tokenUrl: tokenUrl(creds),
        clientId: creds.clientId,
      },
      refreshToken,
    );
  },

  async fetchSelfPhoto(accessToken) {
    return fetchSelfPhotoOutlook(accessToken);
  },

  async listCalendars(accessToken: string): Promise<CalendarInfo[]> {
    // `/me/calendars` retourne le calendrier personnel ET les calendriers
    // partagés / d'équipe ajoutés par l'utilisateur. Pas de pagination
    // configurable (top n'est pas garanti par Graph pour cet endpoint) —
    // on prend tout d'un coup, en pratique on a < 50 calendriers.
    const res = await fetch('https://graph.microsoft.com/v1.0/me/calendars', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Graph /me/calendars failed (${res.status}): ${txt}`);
    }
    const json = (await res.json()) as {
      value: Array<{
        id: string;
        name?: string;
        isDefaultCalendar?: boolean;
        hexColor?: string;
      }>;
    };
    return json.value.map<CalendarInfo>((c) => ({
      id: c.id,
      name: c.name ?? 'Calendrier',
      // Outlook expose `hexColor` quand l'utilisateur a personnalisé la
      // couleur ; sinon une string vide → on filtre.
      color: c.hexColor && c.hexColor.length > 0 ? c.hexColor : undefined,
      isPrimary: c.isDefaultCalendar === true,
    }));
  },

  async listUpcomingMeetings({ account, accessToken, windowHours, calendarId }) {
    const now = new Date();
    const end = new Date(now.getTime() + windowHours * 3600 * 1000);
    // `/me/calendars/{id}/calendarView` étale les événements récurrents
    // en occurrences individuelles — c'est ce qu'on veut pour la vue
    // "prochains rendez-vous". Il faut le header `Prefer:
    // outlook.timezone="UTC"` sinon les heures sont retournées dans la
    // TZ utilisateur sans info claire ; ici on demande UTC et on
    // convertit côté UI.
    const url =
      `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView` +
      `?startDateTime=${now.toISOString()}` +
      `&endDateTime=${end.toISOString()}` +
      `&$orderby=start/dateTime` +
      `&$top=50`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Graph calendarView failed (${res.status}): ${txt}`);
    }
    const json = (await res.json()) as { value: GraphEvent[] };
    return json.value
      .filter((e) => !e.isCancelled && e.start?.dateTime && e.end?.dateTime)
      .map<Meeting>((e) => {
        // Microsoft Graph renvoie `2024-05-23T14:00:00.0000000` sans 'Z'
        // mais en UTC grâce au header Prefer. On ajoute le 'Z' pour
        // que le Date constructeur l'interprète correctement.
        const startIso =
          e.start!.dateTime.includes('Z') || e.start!.dateTime.includes('+')
            ? e.start!.dateTime
            : e.start!.dateTime + 'Z';
        const endIso =
          e.end!.dateTime.includes('Z') || e.end!.dateTime.includes('+')
            ? e.end!.dateTime
            : e.end!.dateTime + 'Z';
        const location =
          e.onlineMeeting?.joinUrl ?? e.location?.displayName ?? '';
        const timing = deriveTiming(startIso, endIso);
        return {
          id: e.id,
          accountId: account.id,
          provider: 'outlook',
          title: e.subject ?? 'Sans titre',
          location,
          kind: detectKind(location),
          start: startIso,
          end: endIso,
          ...timing,
          attendees: mapAttendees(e, account.email, account.selfPhotoDataUrl),
          webLink: e.webLink,
          categories: e.categories,
        };
      });
  },

  async listCategories(accessToken: string): Promise<OutlookCategory[]> {
    // `/me/outlook/masterCategories` retourne les catégories définies
    // par l'utilisateur côté Outlook (nom + preset de couleur). C'est
    // un endpoint Graph dédié — il n'y a pas pagination significative
    // (utilisateurs ont typiquement <30 catégories).
    const res = await fetch(
      'https://graph.microsoft.com/v1.0/me/outlook/masterCategories',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Graph masterCategories failed (${res.status}): ${txt}`);
    }
    const json = (await res.json()) as {
      value: Array<{ id: string; displayName?: string; color?: string }>;
    };
    return json.value
      .filter((c) => !!c.displayName)
      .map<OutlookCategory>((c) => ({
        name: c.displayName!,
        // `color` est l'un de `preset0`…`preset24` ou `none`. On garde
        // tel quel, l'UI mappe en hex via une table.
        preset: c.color,
      }));
  },
};
