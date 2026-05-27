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
  type CalendarInfo,
  type CalendarProviderId,
  type Meeting,
  type OAuthClientCredentials,
  type OutlookCategory,
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
/**
 * TTL du cache `account.calendars` — au-delà, l'agrégation re-fetch la
 * liste des calendriers en arrière-plan. 6 h est un bon compromis :
 * l'utilisateur peut ajouter un calendrier partagé côté provider et le
 * voir apparaître dans Settings au prochain ouvrir, sans payer un round-trip
 * réseau à chaque polling. Le bouton "Rafraîchir" dans Settings force
 * un refetch immédiat indépendamment du TTL.
 */
const CALENDARS_TTL_MS = 6 * 3600 * 1000;
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
 * Récupère (et persiste) la liste des calendriers du compte. Stratégie :
 *
 *  - `force === true` : skip le cache → refetch inconditionnel. Utilisé
 *    par l'IPC `meetings:listCalendars` (clic utilisateur sur Rafraîchir).
 *  - sinon : honore le TTL. Si `calendars` est déjà rempli et que le TTL
 *    n'est pas expiré, retourne l'account tel quel.
 *
 * Si c'est le premier fetch (selectedCalendarIds était `undefined`), on
 * coche par défaut tous les calendriers connus — c'est la sémantique
 * "inclusion" mais avec une initialisation pratique pour l'utilisateur
 * qui ne veut pas avoir à tout cocher manuellement. À partir de ce
 * moment, l'utilisateur peut décocher ce qu'il ne veut plus.
 *
 * En cas d'erreur réseau, on retourne le compte inchangé (et l'agrégation
 * fera son fallback en interrogeant uniquement le calendrier `primary`).
 */
async function ensureCalendars(
  account: CalendarAccount,
  accessToken: string,
  force = false,
): Promise<CalendarAccount> {
  const provider = PROVIDERS[account.provider];
  const now = Date.now();
  const fetchedAt = account.calendarsFetchedAt ?? 0;
  const stillFresh =
    account.calendars && now - fetchedAt < CALENDARS_TTL_MS;
  if (!force && stillFresh) return account;

  let calendars: CalendarInfo[];
  try {
    calendars = await provider.listCalendars(accessToken);
  } catch (err) {
    console.warn(
      `[meetings] listCalendars KO pour ${account.email}:`,
      err,
    );
    // Ne pas écraser un cache valide en cas d'échec — on garde l'ancien
    // état et on réessaiera au prochain tick.
    return account;
  }

  // Premier fetch : initialiser la liste blanche à "tous cochés". Si
  // l'utilisateur a déjà une sélection explicite, on la conserve mais
  // on filtre les IDs qui n'existent plus côté provider pour éviter
  // qu'ils trainent indéfiniment.
  let selectedCalendarIds: string[] | undefined;
  if (account.selectedCalendarIds === undefined) {
    selectedCalendarIds = calendars.map((c) => c.id);
  } else {
    const known = new Set(calendars.map((c) => c.id));
    selectedCalendarIds = account.selectedCalendarIds.filter((id) =>
      known.has(id),
    );
  }

  const updated: CalendarAccount = {
    ...account,
    calendars,
    calendarsFetchedAt: now,
    selectedCalendarIds,
  };
  setAccounts(
    getAccounts().map((a) => (a.id === account.id ? updated : a)),
  );
  return updated;
}

/**
 * Récupère (et persiste) la liste des catégories Outlook du compte.
 * Outlook only — pour Google, `provider.listCategories` est absente et
 * on retourne l'account inchangé sans erreur.
 *
 * Stratégie identique à `ensureCalendars` : TTL partagé (`CALENDARS_TTL_MS`)
 * pour éviter un round-trip réseau supplémentaire à chaque tick. En cas
 * d'erreur réseau, on garde l'ancien cache pour ne pas casser le filtrage
 * tant que la dernière liste connue est encore utilisable.
 */
async function ensureCategories(
  account: CalendarAccount,
  accessToken: string,
  force = false,
): Promise<CalendarAccount> {
  const provider = PROVIDERS[account.provider];
  if (!provider.listCategories) return account;

  const now = Date.now();
  const fetchedAt = account.categoriesFetchedAt ?? 0;
  const stillFresh =
    account.categories && now - fetchedAt < CALENDARS_TTL_MS;
  if (!force && stillFresh) return account;

  let categories: OutlookCategory[];
  try {
    categories = await provider.listCategories(accessToken);
  } catch (err) {
    console.warn(
      `[meetings] listCategories KO pour ${account.email}:`,
      err,
    );
    return account;
  }

  const updated: CalendarAccount = {
    ...account,
    categories,
    categoriesFetchedAt: now,
  };
  setAccounts(
    getAccounts().map((a) => (a.id === account.id ? updated : a)),
  );
  return updated;
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
 * Calcule la liste des IDs de calendriers à interroger pour un compte.
 *
 *  - Si `selectedCalendarIds` est défini : retourne cette liste filtrée
 *    pour ne garder que les IDs encore connus (au cas où un calendrier
 *    aurait été supprimé côté provider).
 *  - Sinon (premier passage, avant le tout premier `ensureCalendars`
 *    réussi) : retourne `['primary']` comme fallback. C'est un alias
 *    valide pour Google ; côté Outlook le ID littéral "primary" n'est
 *    pas reconnu, mais ce chemin n'est pris que dans la fenêtre étroite
 *    avant le premier fetch — `ensureCalendars` initialise l'état
 *    juste avant.
 */
function resolveCalendarIds(account: CalendarAccount): string[] {
  if (account.selectedCalendarIds && account.calendars) {
    const known = new Set(account.calendars.map((c) => c.id));
    return account.selectedCalendarIds.filter((id) => known.has(id));
  }
  if (account.calendars && account.calendars.length > 0) {
    const primary = account.calendars.find((c) => c.isPrimary);
    return primary ? [primary.id] : [account.calendars[0].id];
  }
  return ['primary'];
}

/**
 * Agrège les meetings de tous les comptes connectés. Une erreur sur un
 * compte n'empêche pas les autres de remonter leurs résultats. Idem
 * pour une erreur sur un calendrier précis : on continue à fetch les
 * autres.
 */
async function aggregate(): Promise<Meeting[]> {
  const accounts = getAccounts();
  if (accounts.length === 0) return [];

  const results = await Promise.allSettled(
    accounts.map(async (acc) => {
      const ready = await ensureAccessToken(acc);
      if (!ready) return [];
      const withPhoto = await ensureSelfPhoto(ready.account, ready.accessToken);
      const withCalendars = await ensureCalendars(
        withPhoto,
        ready.accessToken,
      );
      const withCategories = await ensureCategories(
        withCalendars,
        ready.accessToken,
      );
      const provider = PROVIDERS[withCategories.provider];
      const calendarIds = resolveCalendarIds(withCategories);
      if (calendarIds.length === 0) return [];

      // Sérialisation des appels par calendrier au sein d'un même compte.
      // Microsoft Graph applique une limite "MailboxConcurrency" (~4 req
      // simultanées par mailbox) qui renvoie HTTP 429 ApplicationThrottled
      // au-delà — observé dès qu'un utilisateur a 5+ calendriers connectés.
      // Les comptes restent en parallèle entre eux (Promise.allSettled
      // englobant), seule la boucle interne au compte est séquentielle.
      // Une erreur sur un calendrier ne casse pas les autres.
      const out: Meeting[] = [];
      for (const calendarId of calendarIds) {
        try {
          const part = await provider.listUpcomingMeetings({
            account: withCategories,
            accessToken: ready.accessToken,
            windowHours: WINDOW_HOURS,
            calendarId,
          });
          out.push(...part);
        } catch (err) {
          console.warn(
            `[meetings] calendar partial failure on ${withCategories.email}:`,
            err,
          );
        }
      }

      // Filtre par catégorie Outlook (liste noire). Sémantique :
      //  - un event SANS catégorie est toujours conservé,
      //  - un event AVEC catégorie est masqué si au moins l'une de ses
      //    catégories est dans `excludedCategories` (compare en lower-case
      //    pour tolérer une casse différente entre Outlook et l'UI).
      // Pour Google, `categories` est undefined sur tous les events et
      // `excludedCategories` reste vide en pratique, donc no-op.
      const excluded = withCategories.excludedCategories ?? [];
      if (excluded.length === 0) return out;
      const excludedSet = new Set(excluded.map((s) => s.toLowerCase()));
      return out.filter((m) => {
        if (!m.categories || m.categories.length === 0) return true;
        return !m.categories.some((c) => excludedSet.has(c.toLowerCase()));
      });
    }),
  );

  // Dédup par id+start : un même événement peut apparaître dans
  // plusieurs calendriers (ex. organisateur + invité partagé) — le couple
  // (id, start) suffit car Graph/Google renvoient des IDs uniques par
  // calendrier mais identiques entre vues. La première occurrence gagne.
  const meetings: Meeting[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.status !== 'fulfilled') {
      console.warn('[meetings] aggregate partial failure:', r.reason);
      continue;
    }
    for (const m of r.value) {
      const key = `${m.id}|${m.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      meetings.push(m);
    }
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

/* ───────────── Gestion des calendriers ───────────── */

/**
 * Force un refetch des calendriers d'un compte et retourne la liste à
 * jour. Utilisé par l'IPC `meetings:listCalendars` (clic Rafraîchir
 * dans Settings, ou ouverture de la section).
 */
async function listCalendars(
  accountId: string,
): Promise<CalendarInfo[] | null> {
  const acc = getAccounts().find((a) => a.id === accountId);
  if (!acc) return null;
  const ready = await ensureAccessToken(acc);
  if (!ready) return null;
  const updated = await ensureCalendars(ready.account, ready.accessToken, true);
  return updated.calendars ?? null;
}

/**
 * Force un refetch des catégories Outlook d'un compte et retourne la
 * liste à jour. Retourne `null` pour un compte non-Outlook (Google n'a
 * pas d'équivalent), ou en cas d'erreur réseau.
 */
async function listCategories(
  accountId: string,
): Promise<OutlookCategory[] | null> {
  const acc = getAccounts().find((a) => a.id === accountId);
  if (!acc) return null;
  const provider = PROVIDERS[acc.provider];
  if (!provider.listCategories) return null;
  const ready = await ensureAccessToken(acc);
  if (!ready) return null;
  const updated = await ensureCategories(
    ready.account,
    ready.accessToken,
    true,
  );
  return updated.categories ?? null;
}

/**
 * Met à jour la liste noire des catégories Outlook d'un compte. `null`
 * = reset (plus aucune exclusion). Refresh immédiat pour répercuter
 * sans attendre le tick.
 */
async function setExcludedCategories(
  accountId: string,
  names: string[] | null,
): Promise<{ ok: boolean }> {
  const accounts = getAccounts();
  const idx = accounts.findIndex((a) => a.id === accountId);
  if (idx === -1) return { ok: false };
  const cleaned =
    names === null
      ? undefined
      : Array.from(new Set(names))
          .filter((s) => typeof s === 'string' && s.trim().length > 0);
  const updated: CalendarAccount = {
    ...accounts[idx],
    excludedCategories: cleaned,
  };
  const next = accounts.slice();
  next[idx] = updated;
  setAccounts(next);
  void refresh();
  return { ok: true };
}

/**
 * Met à jour la liste blanche des calendriers d'un compte. Si `ids` est
 * null, on remet le champ à `undefined` (fallback "tous les calendriers
 * connus"). Déclenche un refresh immédiat pour que l'utilisateur voie
 * la nouvelle liste de meetings sans attendre le prochain tick.
 */
async function setSelectedCalendars(
  accountId: string,
  ids: string[] | null,
): Promise<{ ok: boolean }> {
  const accounts = getAccounts();
  const idx = accounts.findIndex((a) => a.id === accountId);
  if (idx === -1) return { ok: false };
  // Dédup et préserve l'ordre. Pas de filtrage par calendrier connu ici :
  // le caller envoie ce qu'il veut, le filtrage final est fait dans
  // `resolveCalendarIds` au moment de la requête.
  const cleaned =
    ids === null
      ? undefined
      : Array.from(new Set(ids)).filter((s) => typeof s === 'string' && s);
  const updated: CalendarAccount = {
    ...accounts[idx],
    selectedCalendarIds: cleaned,
  };
  const next = accounts.slice();
  next[idx] = updated;
  setAccounts(next);
  void refresh();
  return { ok: true };
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
  ipcMain.handle(IpcChannel.MeetingsListCalendars, (_e, accountId: string) =>
    listCalendars(accountId),
  );
  ipcMain.handle(
    IpcChannel.MeetingsSetSelectedCalendars,
    (_e, accountId: string, ids: string[] | null) =>
      setSelectedCalendars(accountId, ids),
  );
  ipcMain.handle(IpcChannel.MeetingsListCategories, (_e, accountId: string) =>
    listCategories(accountId),
  );
  ipcMain.handle(
    IpcChannel.MeetingsSetExcludedCategories,
    (_e, accountId: string, names: string[] | null) =>
      setExcludedCategories(accountId, names),
  );
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
