/**
 * Service du module Teams Presence.
 *
 * Responsabilités :
 *  - Polling Microsoft Graph `GET /me/presence` toutes les `pollMs` ms
 *    sur le compte Outlook désigné (par `outlookAccountId` ou fallback
 *    "premier compte Outlook trouvé").
 *  - Maintien d'un `TeamsState` cohérent : availability, activity, erreur
 *    typée, accountId, accountEmail.
 *  - Broadcast IPC `teams:change` à chaque transition d'état.
 *  - Handlers `teams:getState`, `teams:setPresence`, `teams:clearPresence`,
 *    `teams:reconnect`.
 *  - Stop le polling quand l'erreur est verrouillante (no-scope, no-license,
 *    no-account) — un nouveau tick ne servirait à rien tant que la config
 *    n'a pas changé.
 *  - Restart le polling quand `moduleConfig.meetings.accounts` ou
 *    `moduleConfig.teams.outlookAccountId/pollMs` changent.
 *
 * Couplage DND (P3) : non encore implémenté dans cette phase P1.
 *
 * Flag d'arrêt : `WINNOTCH_DISABLE_TEAMS=1` saute l'enregistrement.
 */
import { ipcMain } from 'electron';
import Store from 'electron-store';
import {
  DEFAULT_SETTINGS,
  IpcChannel,
  type CalendarAccount,
  type Settings,
  type TeamsActivity,
  type TeamsAvailability,
  type TeamsError,
  type TeamsState,
} from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import {
  clearUserPreferredPresence,
  GraphPresenceError,
  getPresence,
  pairFor,
  setUserPreferredPresence,
} from './graphPresence';
import { ensureAccessToken } from '../meetings/tokenHelpers';
import { outlookProvider } from '../meetings/outlookProvider';
import { getDefaultCredentials } from '../meetings/defaultCredentials';
import { reconnectOutlookAccount } from '../meetings/meetingsService';
import {
  settingsEvents,
  setDndFromExternal,
  type DndChangedPayload,
} from '../settings/settingsService';

const MIN_POLL_MS = 15_000;

/**
 * Fenêtre pendant laquelle un changement Graph détecté par le polling
 * est considéré comme l'écho d'une écriture locale récente. Plus large
 * que la cohérence Graph typique (~5-15 s) pour absorber les délais
 * Teams mobile / multi-clients.
 */
const SUPPRESSION_WINDOW_MS = 30_000;

/**
 * Trace de la dernière écriture Graph initiée par WinNotch (set ou clear).
 * Utilisée par le polling pour ignorer l'écho de notre propre write :
 * sans ça, le toggle DND déclencherait à chaque tick une boucle
 * Graph → settings.dnd → Graph.
 *
 *  - `availability === 'DoNotDisturb'` : on a écrit DND
 *  - `availability === null`           : on a clearé (revient à auto)
 *  - `null` (variable elle-même)       : pas d'écriture locale récente,
 *                                        la valeur lue de Graph fait foi
 */
let lastWrite: { availability: 'DoNotDisturb' | null; at: number } | null =
  null;

const store = new Store<Settings>({
  defaults: DEFAULT_SETTINGS,
  name: 'config',
});

let currentState: TeamsState = {
  availability: 'Unknown',
  activity: '',
  lastSyncAt: 0,
  loading: false,
  error: null,
  accountId: null,
  accountEmail: '',
};

let pollTimer: NodeJS.Timeout | null = null;
let tickInFlight: Promise<void> | null = null;

function broadcast(): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.TeamsChange, currentState);
}

function setState(patch: Partial<TeamsState>): void {
  currentState = { ...currentState, ...patch };
  broadcast();
}

/**
 * Récupère le `CalendarAccount` Outlook à utiliser pour Teams Presence.
 *
 * Stratégie :
 *  1. Si `moduleConfig.teams.outlookAccountId` est renseigné et existe
 *     toujours dans `meetings.accounts`, utiliser ce compte.
 *  2. Sinon, fallback : premier compte Outlook trouvé.
 *  3. Sinon, retourne `null` → état `no-account`.
 */
function selectAccount(): CalendarAccount | null {
  const settings = store.get('moduleConfig');
  const desiredId = settings.teams.outlookAccountId;
  const outlookAccounts = settings.meetings.accounts.filter(
    (a) => a.provider === 'outlook',
  );
  if (desiredId) {
    const match = outlookAccounts.find((a) => a.id === desiredId);
    if (match) return match;
  }
  return outlookAccounts[0] ?? null;
}

/**
 * Récupère les credentials Outlook (user-defined OU embarqués).
 * Mirror de `meetingsService.getCredentials`, dupliqué localement pour
 * ne pas exporter une fonction privée de meetingsService.
 */
function getOutlookCredentials() {
  const userSet = store.get('moduleConfig').meetings.clientCredentials.outlook;
  if (userSet && userSet.clientId) return userSet;
  return getDefaultCredentials('outlook');
}

function setAccountInMeetings(updated: CalendarAccount): void {
  const cfg = store.get('moduleConfig');
  store.set('moduleConfig', {
    ...cfg,
    meetings: {
      ...cfg.meetings,
      accounts: cfg.meetings.accounts.map((a) =>
        a.id === updated.id ? updated : a,
      ),
    },
  });
}

/**
 * Exécute un tick de polling : sélection du compte, ensureAccessToken,
 * appel Graph, mise à jour de l'état. Gère les erreurs typées en
 * arrêtant le polling sur les cas verrouillants.
 */
async function doPoll(): Promise<void> {
  if (tickInFlight) return tickInFlight;
  const task = (async () => {
    console.log('[teams] poll tick start');
    const account = selectAccount();
    if (!account) {
      console.warn('[teams] poll: aucun compte Outlook trouvé → no-account, stop polling');
      setState({
        error: 'no-account',
        accountId: null,
        accountEmail: '',
        availability: 'Unknown',
        activity: '',
        loading: false,
      });
      stopPolling();
      return;
    }
    console.log(`[teams] poll: compte sélectionné ${account.email} (id=${account.id})`);

    const creds = getOutlookCredentials();
    if (!creds) {
      console.warn('[teams] poll: pas de credentials Outlook → no-account');
      setState({
        error: 'no-account',
        accountId: null,
        accountEmail: '',
        availability: 'Unknown',
        activity: '',
        loading: false,
      });
      stopPolling();
      return;
    }

    const ensured = await ensureAccessToken({
      account,
      provider: outlookProvider,
      credentials: creds,
      persistAccount: setAccountInMeetings,
    });
    if (!ensured) {
      console.warn(`[teams] poll: ensureAccessToken null pour ${account.email} → no-account`);
      setState({
        error: 'no-account',
        accountId: null,
        accountEmail: '',
        availability: 'Unknown',
        activity: '',
        loading: false,
      });
      stopPolling();
      return;
    }
    console.log(`[teams] poll: access token OK, appel GET /me/presence`);

    try {
      const { availability, activity } = await getPresence(
        ensured.accessToken,
      );
      console.log(`[teams] poll: réussi, availability=${availability} activity=${activity}`);
      setState({
        availability,
        activity,
        lastSyncAt: Date.now(),
        loading: false,
        error: null,
        accountId: ensured.account.id,
        accountEmail: ensured.account.email,
      });
      // P3 : si le couplage DND est activé, propager Teams → settings.dnd
      // avec filtre anti-écho pour ne pas re-déclencher notre propre write.
      syncDndFromTeams(availability);
    } catch (err) {
      if (err instanceof GraphPresenceError) {
        console.warn(`[teams] poll: GraphPresenceError ${err.kind} (status=${err.status}) — ${err.message}`);
        const verrouillante: TeamsError[] = ['no-scope', 'no-license'];
        setState({
          error: err.kind,
          loading: false,
          accountId: ensured.account.id,
          accountEmail: ensured.account.email,
        });
        if (verrouillante.includes(err.kind)) {
          stopPolling();
        }
        return;
      }
      // Erreur inattendue (non Graph) — on log et on classe en network.
      console.warn('[teams] erreur inattendue:', err);
      setState({
        error: 'network',
        loading: false,
        accountId: ensured.account.id,
        accountEmail: ensured.account.email,
      });
    }
  })();
  tickInFlight = task;
  try {
    await task;
  } finally {
    tickInFlight = null;
  }
}

function startPolling(): void {
  if (pollTimer) return;
  const cfg = store.get('moduleConfig').teams;
  const ms = Math.max(MIN_POLL_MS, cfg.pollMs || 30_000);
  pollTimer = setInterval(() => {
    void doPoll();
  }, ms);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function restartPolling(): void {
  stopPolling();
  void doPoll();
  startPolling();
}

/* ───────────── Couplage DND ↔ Teams (P3) ───────────── */

/**
 * Détermine si une lecture Graph est l'écho d'une écriture locale récente.
 * Évite la boucle "j'écris DoNotDisturb → je lis DoNotDisturb au tick
 * suivant → je crois que Teams a changé → je re-trigger un set/clear".
 *
 * Considéré comme écho si :
 *  - une écriture a eu lieu dans les SUPPRESSION_WINDOW_MS dernières ms
 *  - ET la valeur lue correspond à la valeur écrite :
 *     * lastWrite='DoNotDisturb' + lu=DoNotDisturb → écho de set
 *     * lastWrite=null (clear) + lu=anything-but-DND → écho de clear
 */
function isEchoOfLocalWrite(availability: TeamsAvailability): boolean {
  if (!lastWrite) return false;
  if (Date.now() - lastWrite.at >= SUPPRESSION_WINDOW_MS) return false;
  if (lastWrite.availability === 'DoNotDisturb') {
    return availability === 'DoNotDisturb';
  }
  // lastWrite.availability === null → on attendait un statut autre que DND.
  return availability !== 'DoNotDisturb';
}

/**
 * Propage le statut Teams lu par le polling vers `settings.dnd`. Honore
 * le toggle `dndCouplingEnabled` et le filtre anti-écho.
 *
 * N'écrit jamais via `toggleDnd` (qui ré-émettrait `dnd:changed` →
 * boucle) — utilise `setDndFromExternal` qui patch silencieusement.
 */
function syncDndFromTeams(availability: TeamsAvailability): void {
  const cfg = store.get('moduleConfig').teams;
  if (!cfg.dndCouplingEnabled) return;
  if (isEchoOfLocalWrite(availability)) {
    console.log(
      `[teams] sync dnd: écho de notre write (lastWrite=${lastWrite?.availability}) ignoré`,
    );
    return;
  }
  const derivedDnd = availability === 'DoNotDisturb';
  const currentDnd = store.get('dnd');
  if (derivedDnd !== currentDnd) {
    console.log(
      `[teams] sync dnd: Teams=${availability} → settings.dnd ${currentDnd}→${derivedDnd}`,
    );
    setDndFromExternal(derivedDnd);
  }
}

/**
 * Listener `dnd:changed` (source=user) : pousse le nouveau DND vers Teams
 * via Graph. Honore le toggle `dndCouplingEnabled`.
 *
 * Filtre `source==='user'` indispensable : `setDndFromExternal` ne devrait
 * jamais émettre, mais en défense ceinture-bretelles on bloque aussi ici
 * les sources non-user.
 */
async function onDndChanged(payload: DndChangedPayload): Promise<void> {
  if (payload.source !== 'user') return;
  const cfg = store.get('moduleConfig').teams;
  if (!cfg.dndCouplingEnabled) return;

  const account = selectAccount();
  const creds = getOutlookCredentials();
  if (!account || !creds) return;

  const ensured = await ensureAccessToken({
    account,
    provider: outlookProvider,
    credentials: creds,
    persistAccount: setAccountInMeetings,
  });
  if (!ensured) return;

  try {
    if (payload.value) {
      console.log('[teams] dnd ON → set Teams DoNotDisturb');
      await setUserPreferredPresence(
        ensured.accessToken,
        'DoNotDisturb',
        pairFor('DoNotDisturb'),
        'PT8H',
      );
      lastWrite = { availability: 'DoNotDisturb', at: Date.now() };
      // Mise à jour optimiste du state local pour que la UI réagisse
      // sans attendre le prochain tick de polling.
      setState({
        availability: 'DoNotDisturb',
        activity: pairFor('DoNotDisturb'),
        loading: false,
        error: null,
        lastSyncAt: Date.now(),
      });
    } else {
      console.log('[teams] dnd OFF → clear Teams preferred presence');
      await clearUserPreferredPresence(ensured.accessToken);
      lastWrite = { availability: null, at: Date.now() };
      // Re-lecture immédiate du statut auto pour mettre à jour la UI
      // (sinon on resterait sur "DoNotDisturb" jusqu'au prochain tick).
      try {
        const { availability, activity } = await getPresence(
          ensured.accessToken,
        );
        setState({
          availability,
          activity,
          loading: false,
          error: null,
          lastSyncAt: Date.now(),
        });
      } catch {
        /* la prochaine itération du polling se chargera de la mise à jour */
      }
    }
  } catch (err) {
    if (err instanceof GraphPresenceError) {
      console.warn(
        `[teams] dnd sync vers Teams a échoué (${err.kind}):`,
        err.message,
      );
      setState({ error: err.kind, loading: false });
    } else {
      console.warn('[teams] dnd sync vers Teams a échoué (inattendu):', err);
      setState({ error: 'network', loading: false });
    }
  }
}

/** Wrapper pour `settingsEvents.on('dnd:changed', ...)`. */
const dndChangedListener = (payload: DndChangedPayload) => {
  void onDndChanged(payload);
};

/**
 * Réécoute les changements de moduleConfig pour redémarrer le polling
 * quand l'utilisateur :
 *  - reconnecte un compte Outlook (ajout dans `meetings.accounts`)
 *  - change le compte choisi (`teams.outlookAccountId`)
 *  - change la fréquence de polling (`teams.pollMs`)
 */
function subscribeConfigChanges(): void {
  store.onDidChange('moduleConfig', (newVal, oldVal) => {
    if (!newVal || !oldVal) return;
    const meetingsChanged =
      newVal.meetings.accounts !== oldVal.meetings.accounts;
    const teamsChanged =
      newVal.teams.outlookAccountId !== oldVal.teams.outlookAccountId ||
      newVal.teams.pollMs !== oldVal.teams.pollMs;
    if (meetingsChanged || teamsChanged) {
      restartPolling();
    }
  });
}

/* ───────────── IPC handlers ───────────── */

async function handleSetPresence(
  availability: TeamsAvailability,
  activity: TeamsActivity,
): Promise<TeamsState> {
  if (availability === 'Unknown') {
    // Garde-fou : `Unknown` n'est pas un statut valide côté Graph.
    return currentState;
  }
  const account = selectAccount();
  const creds = getOutlookCredentials();
  if (!account || !creds) {
    setState({ error: 'no-account', loading: false });
    return currentState;
  }
  setState({ loading: true });
  const ensured = await ensureAccessToken({
    account,
    provider: outlookProvider,
    credentials: creds,
    persistAccount: setAccountInMeetings,
  });
  if (!ensured) {
    setState({ error: 'no-account', loading: false });
    return currentState;
  }
  try {
    const finalActivity = activity || pairFor(availability);
    await setUserPreferredPresence(
      ensured.accessToken,
      availability,
      finalActivity,
    );
    setState({
      availability,
      activity: finalActivity,
      loading: false,
      error: null,
      lastSyncAt: Date.now(),
      accountId: ensured.account.id,
      accountEmail: ensured.account.email,
    });
  } catch (err) {
    if (err instanceof GraphPresenceError) {
      setState({ error: err.kind, loading: false });
    } else {
      console.warn('[teams] setPresence error:', err);
      setState({ error: 'network', loading: false });
    }
  }
  return currentState;
}

async function handleClearPresence(): Promise<TeamsState> {
  const account = selectAccount();
  const creds = getOutlookCredentials();
  if (!account || !creds) {
    setState({ error: 'no-account', loading: false });
    return currentState;
  }
  setState({ loading: true });
  const ensured = await ensureAccessToken({
    account,
    provider: outlookProvider,
    credentials: creds,
    persistAccount: setAccountInMeetings,
  });
  if (!ensured) {
    setState({ error: 'no-account', loading: false });
    return currentState;
  }
  try {
    await clearUserPreferredPresence(ensured.accessToken);
    // Re-fetch le statut auto immédiatement pour ne pas attendre le tick.
    const { availability, activity } = await getPresence(ensured.accessToken);
    setState({
      availability,
      activity,
      loading: false,
      error: null,
      lastSyncAt: Date.now(),
    });
  } catch (err) {
    if (err instanceof GraphPresenceError) {
      setState({ error: err.kind, loading: false });
    } else {
      console.warn('[teams] clearPresence error:', err);
      setState({ error: 'network', loading: false });
    }
  }
  return currentState;
}

async function handleReconnect(): Promise<{ ok: boolean; error?: string }> {
  // On essaie de relancer le flow OAuth en mode `prompt=consent` pour
  // ré-élever les scopes du compte Outlook lié. Si on a un accountId
  // valide, on patch in-place ; sinon (cas no-account), on tombe en
  // erreur — l'utilisateur doit aller dans Meetings d'abord.
  const account = selectAccount();
  if (!account) {
    return {
      ok: false,
      error: 'Connecte un compte Outlook dans Settings → Meetings d\'abord.',
    };
  }
  const result = await reconnectOutlookAccount(account.id);
  if (result.ok) {
    // Reset l'état d'erreur et redémarre le polling.
    setState({ error: null, loading: false });
    restartPolling();
  }
  return result;
}

export function registerTeamsIpc(): void {
  console.log('[teams] registerTeamsIpc');
  ipcMain.handle(IpcChannel.TeamsGetState, () => currentState);
  ipcMain.handle(
    IpcChannel.TeamsSetPresence,
    (_e, availability: TeamsAvailability, activity: TeamsActivity) =>
      handleSetPresence(availability, activity),
  );
  ipcMain.handle(IpcChannel.TeamsClearPresence, () => handleClearPresence());
  ipcMain.handle(IpcChannel.TeamsReconnect, () => handleReconnect());

  subscribeConfigChanges();

  // Branche le couplage DND ↔ Teams (P3). Le listener est conditionné
  // côté handler par `dndCouplingEnabled` : on s'abonne en permanence et
  // on filtre dans `onDndChanged`, plutôt que d'abonner/désabonner à
  // chaque toggle du couplage (plus simple, et le coût d'un event ignoré
  // est négligeable).
  settingsEvents.on('dnd:changed', dndChangedListener);

  // Démarrage : un premier poll immédiat + le timer.
  const cfg = store.get('moduleConfig').teams;
  console.log(
    `[teams] config initiale : pollMs=${cfg.pollMs} outlookAccountId=${cfg.outlookAccountId} dndCouplingEnabled=${cfg.dndCouplingEnabled}`,
  );
  const accounts = store.get('moduleConfig').meetings.accounts;
  console.log(
    `[teams] comptes Meetings au démarrage : ${accounts.length} total, ${accounts.filter((a) => a.provider === 'outlook').length} Outlook`,
  );
  void doPoll();
  startPolling();
}

export function stopTeams(): void {
  stopPolling();
  // Désabonne le listener DND pour éviter qu'une bascule DND tente d'écrire
  // dans Graph alors que le service est arrêté (cas de l'app qui ferme).
  // On ne fait PAS de clearUserPreferredPresence : l'utilisateur garde le
  // statut Teams qu'il avait au moment de la fermeture.
  settingsEvents.off('dnd:changed', dndChangedListener);
}
