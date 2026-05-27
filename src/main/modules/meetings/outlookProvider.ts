/**
 * Provider Outlook / Microsoft 365 via Microsoft Graph.
 *
 * Endpoints :
 *  - Auth     : https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
 *  - Token    : https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 *  - Calendar : GET /me/calendarView?startDateTime=…&endDateTime=…
 *  - User     : GET /me  (pour récupérer l'email du compte connecté)
 *
 * Scope minimal : `Calendars.Read User.Read offline_access`.
 * `offline_access` est requis pour obtenir un refresh token.
 *
 * Le tenant par défaut est `common` (multi-tenant + comptes perso).
 * Pour restreindre à une org spécifique, l'utilisateur saisit son
 * tenant ID dans `OAuthClientCredentials.tenantId`.
 */
import type {
  Meeting,
  MeetingAttendee,
  OAuthClientCredentials,
} from '../../../shared/types';
import { startAuthFlow, refreshAccessToken, type OAuthTokens } from './oauth';
import type { CalendarProvider } from './calendarProvider';
import { detectKind, deriveTiming } from './meetingMapper';

const SCOPE = 'Calendars.Read User.Read offline_access';

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

  async startAuth(creds) {
    const tokens = await startAuthFlow({
      authUrl: authUrl(creds),
      tokenUrl: tokenUrl(creds),
      clientId: creds.clientId,
      // Microsoft accepte le clientSecret pour les confidential clients
      // mais pour les desktop apps en Authorization Code + PKCE on
      // **ne doit pas** envoyer de secret. Donc on ignore creds.clientSecret.
      scope: SCOPE,
      // `prompt=select_account` permet à l'utilisateur de choisir un
      // compte différent du SSO en cours, utile pour les multi-comptes.
      extraAuthParams: { prompt: 'select_account' },
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

  async listUpcomingMeetings({ account, accessToken, windowHours }) {
    const now = new Date();
    const end = new Date(now.getTime() + windowHours * 3600 * 1000);
    // `/me/calendarView` étale les événements récurrents en occurrences
    // individuelles — c'est ce qu'on veut pour la vue "prochains
    // rendez-vous". Il faut le header `Prefer: outlook.timezone="UTC"`
    // sinon les heures sont retournées dans la TZ utilisateur sans info
    // claire ; ici on demande UTC et on convertit côté UI.
    const url =
      `https://graph.microsoft.com/v1.0/me/calendarView` +
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
        };
      });
  },
};
