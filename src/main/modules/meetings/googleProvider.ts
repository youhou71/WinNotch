/**
 * Provider Google Calendar.
 *
 * Endpoints :
 *  - Auth     : https://accounts.google.com/o/oauth2/v2/auth
 *  - Token    : https://oauth2.googleapis.com/token
 *  - Events   : GET /calendar/v3/calendars/primary/events?timeMin=…&timeMax=…
 *  - UserInfo : GET https://openidconnect.googleapis.com/v1/userinfo (avec scope openid email)
 *
 * Scope : `https://www.googleapis.com/auth/calendar.readonly openid email`.
 * `openid email` permet de récupérer l'email du compte via userinfo
 * sans demander Contacts.
 *
 * Spécificité Google : `access_type=offline` est requis pour obtenir un
 * refresh token. `prompt=consent` force un consentement explicite
 * (sinon le refresh token n'est délivré qu'à la première connexion).
 * Le clientSecret est obligatoire même pour un desktop client.
 */
import type {
  CalendarInfo,
  Meeting,
  MeetingAttendee,
  OAuthClientCredentials,
} from '../../../shared/types';
import { startAuthFlow, refreshAccessToken, type OAuthTokens } from './oauth';
import type { CalendarProvider } from './calendarProvider';
import { detectKind, deriveTiming } from './meetingMapper';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE =
  'openid email https://www.googleapis.com/auth/calendar.readonly';

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  status?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ uri?: string }> };
  organizer?: { email?: string; displayName?: string };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    organizer?: boolean;
  }>;
  htmlLink?: string;
}

/**
 * Construit la liste des participants triée organisateur en premier.
 * Google expose `organizer` à la fois au niveau event ET sur certains
 * `attendees[].organizer = true`. On combine les deux sources et dédup
 * sur l'email pour ne pas dupliquer l'organisateur.
 */
function mapAttendees(e: GoogleEvent): MeetingAttendee[] {
  const organizerEmail = e.organizer?.email?.toLowerCase() ?? '';

  // Filtrer les "resources" (salles) qu'on ne veut pas afficher comme
  // participants — Google n'a pas de flag explicite, on garde donc tout
  // ce qui ressemble à une adresse humaine.
  const raw = (e.attendees ?? [])
    .filter((a) => a.email)
    .map<MeetingAttendee>((a) => ({
      name: a.displayName ?? '',
      email: a.email ?? '',
      isOrganizer: !!a.organizer || a.email?.toLowerCase() === organizerEmail,
    }));

  // Si l'organizer n'apparaît pas dans la liste attendees, l'ajouter
  // explicitement en tête.
  if (
    organizerEmail &&
    !raw.some((a) => a.email.toLowerCase() === organizerEmail)
  ) {
    raw.unshift({
      name: e.organizer?.displayName ?? '',
      email: e.organizer?.email ?? '',
      isOrganizer: true,
    });
  }

  // Tri stable : organizers en premier, ordre d'origine préservé.
  return raw.sort((a, b) => Number(b.isOrganizer) - Number(a.isOrganizer));
}

async function fetchUserEmail(accessToken: string): Promise<string> {
  const res = await fetch(
    'https://openidconnect.googleapis.com/v1/userinfo',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  const json = (await res.json()) as { email?: string };
  return json.email ?? 'unknown@google';
}

export const googleProvider: CalendarProvider = {
  id: 'google',

  async startAuth(creds: OAuthClientCredentials) {
    if (!creds.clientSecret) {
      throw new Error(
        'Google OAuth requiert un clientSecret. Crée un OAuth Client de type "Desktop app" dans la console GCP.',
      );
    }
    const tokens = await startAuthFlow({
      authUrl: AUTH_URL,
      tokenUrl: TOKEN_URL,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      scope: SCOPE,
      extraAuthParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    });
    const email = await fetchUserEmail(tokens.accessToken);
    return { tokens, email };
  },

  async refresh(creds, refreshToken): Promise<OAuthTokens> {
    return refreshAccessToken(
      {
        tokenUrl: TOKEN_URL,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
      },
      refreshToken,
    );
  },

  async listCalendars(accessToken: string): Promise<CalendarInfo[]> {
    // `/users/me/calendarList` retourne tous les calendriers abonnés
    // (perso + partagés). On filtre ceux dont `selected` est false et
    // dont `hidden` est true côté Google pour ne pas embarquer les
    // calendriers explicitement masqués dans l'UI Google Calendar —
    // c'est rare mais ça évite du bruit pour l'utilisateur.
    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Google calendarList failed (${res.status}): ${txt}`);
    }
    const json = (await res.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        summaryOverride?: string;
        primary?: boolean;
        hidden?: boolean;
        backgroundColor?: string;
      }>;
    };
    return (json.items ?? [])
      .filter((c) => !c.hidden)
      .map<CalendarInfo>((c) => ({
        id: c.id,
        // summaryOverride est le nom personnalisé par l'utilisateur dans
        // Google Calendar — privilégier celui-là quand il existe.
        name: c.summaryOverride ?? c.summary ?? c.id,
        color: c.backgroundColor,
        isPrimary: c.primary === true,
      }));
  },

  async listUpcomingMeetings({ account, accessToken, windowHours, calendarId }) {
    const now = new Date();
    const end = new Date(now.getTime() + windowHours * 3600 * 1000);
    // singleEvents=true étale les récurrents en occurrences individuelles.
    // orderBy=startTime n'est valide que si singleEvents=true.
    const url =
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events` +
      `?singleEvents=true` +
      `&orderBy=startTime` +
      `&timeMin=${encodeURIComponent(now.toISOString())}` +
      `&timeMax=${encodeURIComponent(end.toISOString())}` +
      `&maxResults=50`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Google events failed (${res.status}): ${txt}`);
    }
    const json = (await res.json()) as { items?: GoogleEvent[] };
    return (json.items ?? [])
      .filter(
        (e) =>
          e.status !== 'cancelled' &&
          // Filtre les "all-day events" qui n'ont que `date` (pas `dateTime`)
          // — pas pertinents pour la card "prochain meeting".
          e.start?.dateTime &&
          e.end?.dateTime,
      )
      .map<Meeting>((e) => {
        const startIso = e.start!.dateTime!;
        const endIso = e.end!.dateTime!;
        const location =
          e.hangoutLink ??
          e.conferenceData?.entryPoints?.[0]?.uri ??
          e.location ??
          '';
        const timing = deriveTiming(startIso, endIso);
        return {
          id: e.id,
          accountId: account.id,
          provider: 'google',
          title: e.summary ?? 'Sans titre',
          location,
          kind: detectKind(location),
          start: startIso,
          end: endIso,
          ...timing,
          attendees: mapAttendees(e),
          webLink: e.htmlLink,
        };
      });
  },
};
