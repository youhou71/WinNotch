/**
 * Client HTTP minimal pour l'API GitLab REST v4.
 *
 * Pas de dépendance externe : on s'appuie sur le `fetch` natif d'Electron
 * (Node 18+ / undici). Les seules opérations dont on a besoin sont :
 *  - récupérer le profil utilisateur courant (`GET /user`)
 *  - lister les MR où l'utilisateur est reviewer
 *  - lister les MR créées par l'utilisateur
 *
 * Authentification : header `PRIVATE-TOKEN` avec un Personal Access Token
 * (scope `read_api` suffisant). Les URLs sont construites à partir de
 * `instanceUrl` saisi par l'utilisateur dans les Settings.
 */
import type {
  GitLabIssue,
  GitLabMr,
  GitLabMrDetail,
  GitLabUser,
} from '../../../shared/types';

/** Erreurs explicites pour que le service puisse les renvoyer au renderer. */
export class GitLabAuthError extends Error {
  constructor(message = 'Token GitLab invalide ou expiré') {
    super(message);
    this.name = 'GitLabAuthError';
  }
}

export class GitLabNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitLabNetworkError';
  }
}

/**
 * Normalise l'URL d'instance : supprime le slash final, ajoute https://
 * si absent. Évite que `https://gitlab.cfast.fr/` produise des URLs avec
 * `//` après concaténation.
 */
function normalizeInstance(rawUrl: string): string {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, '');
}

/**
 * Lance un fetch authentifié vers l'API REST v4 et parse la réponse JSON.
 * Centralise la gestion d'erreurs : 401 → AuthError, autres → NetworkError.
 */
async function apiFetch<T>(
  instanceUrl: string,
  token: string,
  path: string,
  query?: Record<string, string | number | boolean>,
): Promise<T> {
  const base = normalizeInstance(instanceUrl);
  const url = new URL(`${base}/api/v4${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, String(v));
    }
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        'PRIVATE-TOKEN': token,
        Accept: 'application/json',
      },
      // Pas de cache : on veut toujours l'état GitLab à jour.
      cache: 'no-store',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new GitLabNetworkError(`Connexion à ${base} impossible : ${msg}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new GitLabAuthError();
  }
  if (!res.ok) {
    throw new GitLabNetworkError(
      `GitLab ${res.status} ${res.statusText} sur ${path}`,
    );
  }
  // Un proxy d'entreprise / portail captif / page SSO peut répondre 200
  // avec du HTML à la place de l'API (typique : instance accessible
  // uniquement via VPN, VPN déconnecté). Sans ce garde, l'erreur brute de
  // JSON.parse (« Unexpected token '<' ») remontait jusqu'à l'UI.
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('json')) {
    throw new GitLabNetworkError(
      `${base} a répondu en « ${contentType || 'type inconnu'} » au lieu de JSON — ` +
        'instance probablement inaccessible (VPN déconnecté ? proxy ou page de connexion sur le chemin ?)',
    );
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new GitLabNetworkError(
      `${base} a renvoyé un JSON invalide sur ${path} — réponse tronquée ou interceptée par un proxy.`,
    );
  }
}

/* ─────────────────────────────────────────────────────────────────────
 *  Réponses brutes GitLab — typage strict pour les champs qu'on lit
 * ─────────────────────────────────────────────────────────────────── */

interface RawUser {
  id: number;
  username: string;
  name: string;
  avatar_url: string;
  web_url: string;
}

interface RawMr {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  web_url: string;
  created_at: string;
  updated_at: string;
  draft: boolean;
  has_conflicts: boolean;
  detailed_merge_status: string;
  author: { name: string; avatar_url: string };
  references: { full: string; relative: string; short: string };
}

/* ─────────────────────────────────────────────────────────────────────
 *  API publique
 * ─────────────────────────────────────────────────────────────────── */

/** Récupère le profil de l'utilisateur associé au token. */
export async function fetchCurrentUser(
  instanceUrl: string,
  token: string,
): Promise<GitLabUser> {
  const raw = await apiFetch<RawUser>(instanceUrl, token, '/user');
  return {
    id: raw.id,
    username: raw.username,
    name: raw.name,
    avatarUrl: raw.avatar_url,
    webUrl: raw.web_url,
  };
}

/**
 * Normalise une `RawMr` en `GitLabMr`. Le `references.full` typé "group/
 * project!iid" est utilisé tel quel pour l'affichage.
 *
 * `projectName` est extrait depuis `references.full` (avant le `!`) puis
 * basename — moins fiable que `project_id` mais évite un GET par projet
 * juste pour récupérer un nom déjà encodé dans la référence.
 */
function normalizeMr(raw: RawMr): GitLabMr {
  const refFull = raw.references?.full ?? '';
  const projectPath = refFull.split('!')[0] ?? '';
  const projectName = projectPath.split('/').pop() ?? '';
  return {
    id: raw.id,
    iid: raw.iid,
    projectId: raw.project_id,
    projectName,
    reference: refFull,
    title: raw.title,
    webUrl: raw.web_url,
    authorName: raw.author?.name ?? '',
    authorAvatarUrl: raw.author?.avatar_url ?? '',
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    draft: raw.draft,
    hasConflicts: raw.has_conflicts,
    detailedMergeStatus: raw.detailed_merge_status ?? '',
    // Pré-fetché séparément côté service pour les MR « mine » (cf. #9).
    pipelineStatus: null,
  };
}

/**
 * Liste les MR ouvertes où l'utilisateur est reviewer.
 *
 * GitLab limite la pagination par défaut à 20 ; on monte à 50 ce qui est
 * suffisant pour un usage personnel (au-delà, l'UI devient incompréhensible
 * de toute façon).
 */
export async function fetchMrsToReview(
  instanceUrl: string,
  token: string,
  userId: number,
): Promise<GitLabMr[]> {
  const raws = await apiFetch<RawMr[]>(instanceUrl, token, '/merge_requests', {
    reviewer_id: userId,
    state: 'opened',
    scope: 'all',
    per_page: 50,
    order_by: 'updated_at',
    sort: 'desc',
  });
  return raws.map(normalizeMr);
}

/** Liste les MR ouvertes créées par l'utilisateur. */
export async function fetchMrsAuthored(
  instanceUrl: string,
  token: string,
  userId: number,
): Promise<GitLabMr[]> {
  const raws = await apiFetch<RawMr[]>(instanceUrl, token, '/merge_requests', {
    author_id: userId,
    state: 'opened',
    scope: 'all',
    per_page: 50,
    order_by: 'updated_at',
    sort: 'desc',
  });
  return raws.map(normalizeMr);
}

/* ─────────────────────────────────────────────────────────────────────
 *  État de reviewer (GraphQL) — filtre des MR déjà reviewées
 * ─────────────────────────────────────────────────────────────────── */

/**
 * États de reviewer GitLab qui signifient « j'ai donné ma review » : la MR
 * quitte alors la liste « à reviewer ». Les autres valeurs (`UNREVIEWED`,
 * `REVIEW_STARTED`, `UNAPPROVED`, ou tout état inconnu d'une future version)
 * signifient que la balle est encore dans mon camp → on garde la MR.
 * `REQUESTED_CHANGES` compte comme reviewée : j'ai rendu mon verdict, c'est
 * à l'auteur de reprendre la main.
 */
const REVIEWED_STATES = new Set(['REVIEWED', 'APPROVED', 'REQUESTED_CHANGES']);

/** Forme minimale de la réponse GraphQL qu'on exploite. */
interface RawReviewStatesResponse {
  data?: {
    currentUser?: {
      reviewRequestedMergeRequests?: {
        nodes?: {
          id: string;
          reviewers?: {
            nodes?: {
              username: string;
              mergeRequestInteraction?: { reviewState?: string | null } | null;
            }[];
          } | null;
        }[];
      } | null;
    } | null;
  };
  errors?: { message: string }[];
}

/**
 * Extrait l'id numérique global depuis un GID GraphQL
 * (`gid://gitlab/MergeRequest/12345` → `12345`). Renvoie `null` si la forme
 * n'est pas reconnue (on ignore alors ce nœud plutôt que de risquer un match
 * hasardeux). Cet id correspond au `GitLabMr.id` REST (id global tous
 * projets confondus).
 */
function parseGid(gid: string): number | null {
  // `.pop()` sur un GID malformé finissant par `/` renvoie '' → `Number('')`
  // vaut 0 (et non NaN) : on garde donc le test de chaîne non vide explicite.
  const tail = gid.split('/').pop();
  if (!tail) return null;
  const n = Number(tail);
  return Number.isInteger(n) ? n : null;
}

/**
 * Renvoie l'ensemble des ids globaux de MR où l'utilisateur courant a DÉJÀ
 * donné sa review.
 *
 * Pourquoi GraphQL : l'API REST des listes ne renvoie pas l'état de
 * reviewer, seulement l'affectation. GitLab n'expose `reviewState` qu'en
 * GraphQL. Une seule requête couvre toutes les MR, et ça marche sur toutes
 * les éditions (aucune dépendance aux approbations Premium, contrairement à
 * `/approvals` qui peut renvoyer 403 sur l'instance CFAST).
 *
 * `username` sert à isoler MON état parmi tous les reviewers de la MR. Le
 * match se fait sur l'id global (entier canonique) plutôt que sur une chaîne
 * de référence, pour ne pas dépendre d'un formatage identique côté REST.
 * Toute erreur est levée : l'appelant retombe sur la liste non filtrée
 * (aucune régression, la MR reste juste visible).
 */
export async function fetchMyReviewedMrIds(
  instanceUrl: string,
  token: string,
  username: string,
): Promise<Set<number>> {
  const base = normalizeInstance(instanceUrl);
  const query = `query WinNotchReviewStates {
    currentUser {
      reviewRequestedMergeRequests(state: opened) {
        nodes {
          id
          reviewers {
            nodes {
              username
              mergeRequestInteraction { reviewState }
            }
          }
        }
      }
    }
  }`;

  let res: Response;
  try {
    res = await fetch(`${base}/api/graphql`, {
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({ query }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new GitLabNetworkError(`GraphQL ${base} injoignable : ${msg}`);
  }

  if (res.status === 401 || res.status === 403) throw new GitLabAuthError();
  if (!res.ok) {
    throw new GitLabNetworkError(`GraphQL ${res.status} ${res.statusText}`);
  }

  // GraphQL répond 200 même sur erreur de requête (champ `errors`) : on la
  // traite comme un échec pour déclencher le fallback côté service.
  const body = (await res.json()) as RawReviewStatesResponse;
  if (body.errors?.length) {
    throw new GitLabNetworkError(
      `GraphQL: ${body.errors.map((e) => e.message).join('; ')}`,
    );
  }

  const nodes =
    body.data?.currentUser?.reviewRequestedMergeRequests?.nodes ?? [];
  const reviewed = new Set<number>();
  for (const mr of nodes) {
    const me = mr.reviewers?.nodes?.find((r) => r.username === username);
    const state = me?.mergeRequestInteraction?.reviewState;
    if (!state || !REVIEWED_STATES.has(state)) continue;
    const id = parseGid(mr.id);
    if (id !== null) reviewed.add(id);
  }
  return reviewed;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Pipeline + détail MR (Lot 3 #9)
 * ─────────────────────────────────────────────────────────────────── */

interface RawPipeline {
  id: number;
  status: string;
  web_url: string;
}

/**
 * Statut du dernier pipeline d'une MR (ou `null` si aucun pipeline / appel
 * en échec). Utilisé au poll pour les MR « mine » (badge + toast).
 * Tolérant : toute erreur → `null` (ne casse pas le refresh global).
 */
export async function fetchMrPipelineStatus(
  instanceUrl: string,
  token: string,
  projectId: number,
  iid: number,
): Promise<string | null> {
  try {
    const arr = await apiFetch<RawPipeline[]>(
      instanceUrl,
      token,
      `/projects/${projectId}/merge_requests/${iid}/pipelines`,
      { per_page: 1 },
    );
    return arr[0]?.status ?? null;
  } catch {
    return null;
  }
}

interface RawDiscussion {
  notes?: { resolvable?: boolean; resolved?: boolean }[];
}
interface RawApprovals {
  approvals_required?: number;
  approvals_left?: number;
}
interface RawJob {
  name: string;
}

/** Nombre de jobs failed cap pour le tooltip. */
const FAILED_JOBS_CAP = 6;

/**
 * Détail enrichi d'une MR pour le tooltip au survol. Chaque source est
 * isolée (`Promise.allSettled`) : une source en échec (ex. API approvals
 * Premium → 403) dégrade son champ en `null` sans faire échouer le reste.
 */
export async function fetchMrDetail(
  instanceUrl: string,
  token: string,
  projectId: number,
  iid: number,
): Promise<GitLabMrDetail> {
  const base = `/projects/${projectId}/merge_requests/${iid}`;
  const [discRes, apprRes, pipeRes] = await Promise.allSettled([
    apiFetch<RawDiscussion[]>(instanceUrl, token, `${base}/discussions`, {
      per_page: 100,
    }),
    apiFetch<RawApprovals>(instanceUrl, token, `${base}/approvals`),
    apiFetch<RawPipeline[]>(instanceUrl, token, `${base}/pipelines`, {
      per_page: 1,
    }),
  ]);

  // Threads non résolus : une discussion compte si au moins une de ses
  // notes est résoluble ET non résolue.
  let unresolvedThreads = 0;
  if (discRes.status === 'fulfilled') {
    for (const d of discRes.value) {
      if (d.notes?.some((n) => n.resolvable && !n.resolved)) unresolvedThreads++;
    }
  }

  const approvalsRequired =
    apprRes.status === 'fulfilled' ? apprRes.value.approvals_required ?? null : null;
  const approvalsLeft =
    apprRes.status === 'fulfilled' ? apprRes.value.approvals_left ?? null : null;

  const pipeline =
    pipeRes.status === 'fulfilled' ? pipeRes.value[0] ?? null : null;
  const pipelineStatus = pipeline?.status ?? null;
  const pipelineWebUrl = pipeline?.web_url ?? null;

  // Jobs échoués : 1 appel supplémentaire uniquement si le pipeline a échoué.
  let failedJobs: string[] = [];
  if (pipeline && pipeline.status === 'failed') {
    try {
      const jobs = await apiFetch<RawJob[]>(
        instanceUrl,
        token,
        `/projects/${projectId}/pipelines/${pipeline.id}/jobs`,
        { scope: 'failed', per_page: 100 },
      );
      failedJobs = jobs.map((j) => j.name).slice(0, FAILED_JOBS_CAP);
    } catch {
      failedJobs = [];
    }
  }

  // Échec global = les trois sources principales ont échoué (probable
  // problème réseau / token), on remonte un message pour le tooltip.
  const allFailed =
    discRes.status === 'rejected' &&
    apprRes.status === 'rejected' &&
    pipeRes.status === 'rejected';
  const error = allFailed
    ? discRes.reason instanceof Error
      ? discRes.reason.message
      : 'Détail indisponible'
    : null;

  return {
    pipelineStatus,
    pipelineWebUrl,
    failedJobs,
    unresolvedThreads,
    approvalsRequired,
    approvalsLeft,
    error,
  };
}

/* ─────────────────────────────────────────────────────────────────────
 *  Issues
 * ─────────────────────────────────────────────────────────────────── */

interface RawIssue {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  web_url: string;
  created_at: string;
  updated_at: string;
  labels: string[];
  author: { name: string; avatar_url: string };
  references: { full: string; relative: string; short: string };
}

function normalizeIssue(raw: RawIssue, matchedLabel: string): GitLabIssue {
  const refFull = raw.references?.full ?? '';
  const projectPath = refFull.split('#')[0] ?? '';
  const projectName = projectPath.split('/').pop() ?? '';
  return {
    id: raw.id,
    iid: raw.iid,
    projectId: raw.project_id,
    projectName,
    reference: refFull,
    title: raw.title,
    webUrl: raw.web_url,
    authorName: raw.author?.name ?? '',
    authorAvatarUrl: raw.author?.avatar_url ?? '',
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    labels: raw.labels ?? [],
    matchedLabel,
  };
}

/**
 * Liste les issues ouvertes **non assignées** portant un label précis.
 *
 * `scope=all` indique au backend de retourner toutes les issues
 * visibles par le token (pas seulement celles créées par l'utilisateur).
 * Le filtre `labels` accepte une virgule-list ; on passe ici un seul
 * label par appel pour pouvoir associer chaque issue au label qui l'a
 * matchée dans le résultat normalisé.
 *
 * `assignee_id=None` est une valeur sentinelle supportée par GitLab qui
 * filtre les issues sans assignee — on évite ainsi de download les
 * issues déjà prises en charge, qui n'intéressent pas l'utilisateur
 * (le module sert à signaler les issues critiques **à traiter**).
 */
export async function fetchIssuesByLabel(
  instanceUrl: string,
  token: string,
  label: string,
): Promise<GitLabIssue[]> {
  const raws = await apiFetch<RawIssue[]>(instanceUrl, token, '/issues', {
    labels: label,
    state: 'opened',
    scope: 'all',
    assignee_id: 'None',
    per_page: 50,
    order_by: 'created_at',
    sort: 'desc',
  });
  return raws.map((r) => normalizeIssue(r, label));
}
