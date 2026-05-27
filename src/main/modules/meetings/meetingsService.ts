/**
 * Service central du module Meetings.
 *
 * Responsabilités :
 *  - Connexion / déconnexion des comptes (Outlook + Google)
 *  - Lecture du settings pour récupérer la liste des comptes et les
 *    client credentials
 *  - Refresh automatique des access tokens expirés
 *  - Polling agrégé (5 min) → push `meetings:change` au renderer
 *  - 4 handlers IPC : connect, disconnect, list, refresh
 *
 * Les meetings sont triés par `start` (du plus proche au plus lointain).
 * La fenêtre d'agrégation est de 48 heures — couvre la card "next + à
 * venir aujourd'hui + demain matin", sans charger inutilement la suite.
 */
import { ipcMain } from 'electron';
import { randomUUID } from 'crypto';
import Store from 'electron-store';
import {
  DEFAULT_SETTINGS,
  IpcChannel,
  type CalendarAccount,
  type CalendarProviderId,
  type Meeting,
  type OAuthClientCredentials,
  type Settings,
} from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import { broadcastSettings } from '../settings/settingsService';
import type { CalendarProvider } from './calendarProvider';
import { outlookProvider } from './outlookProvider';
import { googleProvider } from './googleProvider';
import { decryptTokens, encryptTokens } from './tokenStore';
import { getDefaultCredentials, hasDefaultCredentials } from './defaultCredentials';
import type { OAuthTokens } from './oauth';

/** Intervalle de polling agrégé des meetings (ms). */
const POLL_INTERVAL_MS = 5 * 60 * 1000;
/** Fenêtre de lookahead (heures) — couvre largement les prochains RDV. */
const WINDOW_HOURS = 48;
/** TTL de la photo de profil avant re-fetch (30 jours). */
const SELF_PHOTO_TTL_MS = 30 * 24 * 3600 * 1000;
/** Couleurs des badges par provider. */
const PROVIDER_COLOR: Record<CalendarProviderId, string> = {
  outlook: '#0078d4',
  google: '#4285f4',
};

const store = new Store<Settings>({ defaults: DEFAULT_SETTINGS, name: 'config' });

/** Cache du dernier snapshot — sert au `list` synchrone et au diff broadcast. */
let cached: Meeting[] = [];
let pollTimer: NodeJS.Timeout | null = null;

const PROVIDERS: Record<CalendarProviderId, CalendarProvider> = {
  outlook: outlookProvider,
  google: googleProvider,
};

/* ───────────── Helpers settings ───────────── */

function getAccounts(): CalendarAccount[] {
  return store.get('moduleConfig').meetings.accounts;
}

function setAccounts(accounts: CalendarAccount[]): void {
  const cfg = store.get('moduleConfig');
  store.set('moduleConfig', {
    ...cfg,
    meetings: { ...cfg.meetings, accounts },
  });
  // Indispensable : settingsService n'observe pas le store, on doit
  // pousser explicitement la nouvelle photo au renderer pour que le
  // SettingsContext (et donc la MeetingsCard + la page Settings) voient
  // la nouvelle liste de comptes.
  broadcastSettings();
}

/**
 * Récupère les credentials OAuth pour un provider. Priorité :
 *  1. Credentials saisis par l'utilisateur dans les Settings
 *  2. Fallback : credentials embarqués au build via `.env.local`
 *  3. null si rien n'est configuré
 */
function getCredentials(
  provider: CalendarProviderId,
): OAuthClientCredentials | null {
  const userSet =
    store.get('moduleConfig').meetings.clientCredentials[provider];
  if (userSet && userSet.clientId) return userSet;
  return getDefaultCredentials(provider);
}

/* ───────────── Broadcast ───────────── */

function broadcast(meetings: Meeting[]): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.MeetingsChange, meetings);
}

/* ───────────── Connexion / déconnexion ───────────── */

async function connect(
  providerId: CalendarProviderId,
): Promise<{ ok: boolean; account?: CalendarAccount; error?: string }> {
  const creds = getCredentials(providerId);
  if (!creds || !creds.clientId) {
    return {
      ok: false,
      error:
        providerId === 'outlook'
          ? "Configure d'abord le clientId Azure dans les réglages Meetings."
          : "Configure d'abord le clientId/clientSecret Google dans les réglages Meetings.",
    };
  }
  try {
    const provider = PROVIDERS[providerId];
    const { tokens, email } = await provider.startAuth(creds);
    const account: CalendarAccount = {
      id: randomUUID(),
      provider: providerId,
      email,
      color: PROVIDER_COLOR[providerId],
      encryptedTokens: encryptTokens(tokens),
      expiresAt: tokens.expiresAt,
    };
    setAccounts([...getAccounts(), account]);
    // Refresh immédiat pour intégrer le nouveau compte dans le cache.
    void refresh();
    return { ok: true, account };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function disconnect(accountId: string): Promise<{ ok: boolean }> {
  setAccounts(getAccounts().filter((a) => a.id !== accountId));
  void refresh();
  return { ok: true };
}

/* ───────────── Refresh + agrégation ───────────── */

/**
 * Assure qu'un access token valide est disponible pour un compte.
 * Refresh si expiré. Met à jour la persistance si besoin.
 */
async function ensureAccessToken(account: CalendarAccount): Promise<{
  account: CalendarAccount;
  accessToken: string;
} | null> {
  const tokens = decryptTokens(account.encryptedTokens);
  if (!tokens) return null;

  // Si l'access token est encore valide pour > 60 s, on l'utilise tel quel.
  if (tokens.expiresAt - Date.now() > 60_000) {
    return { account, accessToken: tokens.accessToken };
  }

  // Sinon, refresh.
  if (!tokens.refreshToken) {
    console.warn(
      `[meetings] Pas de refresh token pour ${account.email} — reconnexion nécessaire.`,
    );
    return null;
  }
  const creds = getCredentials(account.provider);
  if (!creds) return null;

  try {
    const provider = PROVIDERS[account.provider];
    const newTokens: OAuthTokens = await provider.refresh(
      creds,
      tokens.refreshToken,
    );
    // Le provider peut retourner un nouveau refresh token. Le mapper
    // ne renvoie pas null pour le refresh token si l'ancien doit être
    // préservé (cf. refreshAccessToken dans oauth.ts).
    const updatedAccount: CalendarAccount = {
      ...account,
      encryptedTokens: encryptTokens(newTokens),
      expiresAt: newTokens.expiresAt,
    };
    setAccounts(
      getAccounts().map((a) => (a.id === account.id ? updatedAccount : a)),
    );
    return { account: updatedAccount, accessToken: newTokens.accessToken };
  } catch (err) {
    console.warn(
      `[meetings] refresh token KO pour ${account.email}:`,
      err,
    );
    return null;
  }
}

/**
 * Récupère (et persiste) la photo de profil du compte connecté si
 * absente ou TTL dépassé. N'échoue jamais : si l'API photo retourne
 * 404/403 ou si le provider ne supporte pas, on marque juste le
 * `selfPhotoFetchedAt` pour ne pas re-tenter à chaque tick.
 */
async function ensureSelfPhoto(
  account: CalendarAccount,
  accessToken: string,
): Promise<CalendarAccount> {
  const provider = PROVIDERS[account.provider];
  if (!provider.fetchSelfPhoto) return account;

  const now = Date.now();
  const fetchedAt = account.selfPhotoFetchedAt ?? 0;
  if (account.selfPhotoDataUrl && now - fetchedAt < SELF_PHOTO_TTL_MS) {
    return account;
  }

  let photoDataUrl: string | null = null;
  try {
    photoDataUrl = await provider.fetchSelfPhoto(accessToken);
  } catch (err) {
    console.warn(`[meetings] fetchSelfPhoto KO pour ${account.email}:`, err);
  }

  const updated: CalendarAccount = {
    ...account,
    selfPhotoDataUrl: photoDataUrl ?? undefined,
    selfPhotoFetchedAt: now,
  };
  setAccounts(
    getAccounts().map((a) => (a.id === account.id ? updated : a)),
  );
  return updated;
}

/**
 * Agrège les meetings de tous les comptes connectés. Une erreur sur un
 * compte n'empêche pas les autres de remonter leurs résultats.
 */
async function aggregate(): Promise<Meeting[]> {
  const accounts = getAccounts();
  if (accounts.length === 0) return [];

  const results = await Promise.allSettled(
    accounts.map(async (acc) => {
      const ready = await ensureAccessToken(acc);
      if (!ready) return [];
      const withPhoto = await ensureSelfPhoto(ready.account, ready.accessToken);
      const provider = PROVIDERS[withPhoto.provider];
      return provider.listUpcomingMeetings({
        account: withPhoto,
        accessToken: ready.accessToken,
        windowHours: WINDOW_HOURS,
      });
    }),
  );

  const meetings: Meeting[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') meetings.push(...r.value);
    else console.warn('[meetings] aggregate partial failure:', r.reason);
  }
  meetings.sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
  return meetings;
}

/** Re-aggrège + diff + broadcast. Idempotent — toujours sûr à appeler. */
async function refresh(): Promise<Meeting[]> {
  const next = await aggregate();
  const changed =
    next.length !== cached.length ||
    next.some((m, i) => m.id !== cached[i]?.id || m.start !== cached[i]?.start);
  cached = next;
  if (changed) broadcast(next);
  return next;
}

/* ───────────── Bootstrap IPC + polling ───────────── */

export function registerMeetingsIpc(): void {
  ipcMain.handle(IpcChannel.MeetingsConnect, (_e, provider: CalendarProviderId) =>
    connect(provider),
  );
  ipcMain.handle(IpcChannel.MeetingsDisconnect, (_e, id: string) =>
    disconnect(id),
  );
  ipcMain.handle(IpcChannel.MeetingsList, () => cached);
  ipcMain.handle(IpcChannel.MeetingsRefresh, () => refresh());
  ipcMain.handle(IpcChannel.MeetingsHasDefaults, () => ({
    outlook: hasDefaultCredentials('outlook'),
    google: hasDefaultCredentials('google'),
  }));
}

export function startMeetingsPolling(): void {
  if (pollTimer) return;
  // Premier refresh asynchrone — ne bloque pas le démarrage de l'app.
  void refresh();
  pollTimer = setInterval(() => {
    void refresh();
  }, POLL_INTERVAL_MS);
}

export function stopMeetingsPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
