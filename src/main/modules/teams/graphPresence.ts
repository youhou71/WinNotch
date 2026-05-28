/**
 * Wrappers HTTP purs autour de Microsoft Graph `/me/presence`.
 *
 * Trois opérations exposées :
 *  - `getPresence`               : lecture du statut courant (polling).
 *  - `setUserPreferredPresence`  : statut manuel persistant (sticky).
 *  - `clearUserPreferredPresence`: retour au statut automatique de Teams.
 *
 * Le parser d'erreur traduit les réponses Graph en `TeamsError` typés :
 *  - `403 + /permission|scope|privilege/i` → `no-scope` (Presence.ReadWrite
 *    manquant — l'utilisateur doit reconnecter son compte).
 *  - `403 + /licen[cs]e|teams/i`           → `no-license` (compte sans
 *    licence Teams M365).
 *  - tout le reste                          → `network` (erreur transitoire).
 *
 * Pas de SDK Graph (msgraph-sdk) : pour 3 endpoints simples, un `fetch`
 * direct est plus léger et plus lisible que la chaîne d'abstraction du SDK.
 */
import type {
  TeamsActivity,
  TeamsAvailability,
  TeamsError,
} from '../../../shared/types';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Erreur typée levée par chaque fonction du module. Le service consommateur
 * mappe `.kind` directement sur `TeamsState.error` pour piloter l'UI.
 */
export class GraphPresenceError extends Error {
  constructor(
    public readonly kind: TeamsError,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GraphPresenceError';
  }
}

/**
 * Parse une réponse Graph en erreur (404, 403, 429, 5xx, etc.) et lève
 * un `GraphPresenceError` typé. Doit être appelé uniquement sur des
 * réponses `!res.ok`.
 */
async function parseGraphError(res: Response): Promise<never> {
  const body = await res.text().catch(() => '');
  let message = body;
  try {
    const json = JSON.parse(body) as {
      error?: { code?: string; message?: string };
    };
    if (json.error?.message) message = json.error.message;
  } catch {
    /* body n'est pas du JSON, on garde la string brute */
  }

  // 403 : on essaie de distinguer scope manquant vs licence absente.
  // Graph ne renvoie pas un code stable pour ces cas, on s'appuie sur
  // le wording — c'est fragile mais c'est l'état de l'art.
  if (res.status === 403) {
    if (/licen[cs]e|teams/i.test(message)) {
      throw new GraphPresenceError(
        'no-license',
        res.status,
        `Compte sans licence Teams : ${message}`,
      );
    }
    if (/permission|scope|privilege|insufficient/i.test(message)) {
      throw new GraphPresenceError(
        'no-scope',
        res.status,
        `Scope Presence.ReadWrite manquant : ${message}`,
      );
    }
  }

  // 401 : token invalide / expiré → côté service, le refresh aura déjà
  // eu lieu via `ensureAccessToken`, donc un 401 ici reste anormal.
  // On classe en `network` (erreur transitoire) pour ne pas verrouiller
  // le polling — un nouveau tick ré-essaiera.
  throw new GraphPresenceError(
    'network',
    res.status,
    `Graph error ${res.status}: ${message || res.statusText}`,
  );
}

/**
 * `GET /me/presence` — retourne le statut de présence courant.
 */
export async function getPresence(
  accessToken: string,
): Promise<{ availability: TeamsAvailability; activity: TeamsActivity }> {
  const res = await fetch(`${GRAPH_BASE}/me/presence`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return parseGraphError(res);
  const json = (await res.json()) as {
    availability?: string;
    activity?: string;
  };
  return {
    availability: (json.availability ?? 'Unknown') as TeamsAvailability,
    activity: json.activity ?? '',
  };
}

/**
 * `POST /me/presence/setUserPreferredPresence` — statut manuel sticky.
 *
 * Combinaisons autorisées par Graph (à respecter sinon 400) :
 *  - Available/Available
 *  - Busy/Busy
 *  - DoNotDisturb/DoNotDisturb
 *  - BeRightBack/BeRightBack
 *  - Away/Away
 *  - Offline/OffWork
 *
 * `expirationDuration` au format ISO8601 (`PT8H`). Au-delà, Teams revient
 * automatiquement au statut calculé.
 */
export async function setUserPreferredPresence(
  accessToken: string,
  availability: TeamsAvailability,
  activity: TeamsActivity,
  expirationDuration: string = 'PT8H',
): Promise<void> {
  const res = await fetch(
    `${GRAPH_BASE}/me/presence/setUserPreferredPresence`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ availability, activity, expirationDuration }),
    },
  );
  if (!res.ok) return parseGraphError(res);
}

/**
 * `POST /me/presence/clearUserPreferredPresence` — Teams revient à son
 * statut automatique (calculé selon réunions, activité, etc.).
 */
export async function clearUserPreferredPresence(
  accessToken: string,
): Promise<void> {
  const res = await fetch(
    `${GRAPH_BASE}/me/presence/clearUserPreferredPresence`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) return parseGraphError(res);
}

/**
 * Table des combinaisons (availability, activity) autorisées par Graph
 * pour `setUserPreferredPresence`. Le service utilise ce mapping pour
 * dériver une activity valide depuis l'availability choisie par l'UI.
 */
export function pairFor(
  availability: TeamsAvailability,
): TeamsActivity {
  switch (availability) {
    case 'Available':
      return 'Available';
    case 'Busy':
      return 'Busy';
    case 'DoNotDisturb':
      return 'DoNotDisturb';
    case 'BeRightBack':
      return 'BeRightBack';
    case 'Away':
      return 'Away';
    case 'Offline':
      return 'OffWork';
    default:
      // `Unknown` ne devrait jamais être envoyé à Graph : le service
      // filtre côté handler IPC. Fallback défensif sur Available.
      return 'Available';
  }
}
