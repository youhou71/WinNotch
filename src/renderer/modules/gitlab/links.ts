/**
 * Liens « ouvrir dans GitLab » des sections du `<GitLabPanel>`.
 *
 * Chaque section du panel a une page GitLab équivalente : le lien reproduit,
 * en paramètres d'URL du filtered search, le filtre que `gitlabClient.ts`
 * applique en API. But : voir la même liste, en grand, avec les actions de
 * masse que WinNotch n'expose pas.
 *
 * Portée (cf. `moduleConfig.gitlab.linkGroup`) :
 *  - `linkGroup` renseigné → listes du groupe (`/groups/<g>/-/…`), ce qui
 *    correspond à l'usage réel (un seul groupe de travail) ;
 *  - vide → tableau de bord global (`/dashboard/…`), qui est la portée
 *    exacte de l'API (`scope=all`).
 *
 * Exception assumée : « mes issues » pointe toujours sur
 * `/dashboard/work_items`. C'est la seule page qui agrège les quatre types
 * de work items que la section liste (issue, incident, tâche, cas de test) ;
 * son équivalent group-scoped n'existe pas sur toutes les versions de
 * GitLab, alors que le tableau de bord, lui, est présent partout.
 */

/** Sections du panel ayant un lien GitLab. */
export type GitLabSectionKey =
  | 'watchedIssues'
  | 'myWorkItems'
  | 'toReview'
  | 'mine';

/**
 * Normalise l'URL d'instance saisie dans les réglages : ajoute `https://`
 * si absent, retire le slash final. Même logique que `normalizeInstance`
 * côté main — dupliquée plutôt qu'importée, le renderer n'ayant pas accès
 * aux modules `src/main`.
 */
function normalizeInstance(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return withScheme.replace(/\/+$/, '');
}

/**
 * Nettoie un chemin de groupe saisi à la main : tolère une URL complète
 * collée depuis le navigateur (`https://gitlab.cfast.fr/groups/app/-/issues`
 * → `app`), les slashes superflus et le préfixe `groups/`.
 *
 * Exportée pour être appliquée aussi à la saisie dans les réglages : ce qui
 * est persisté est déjà propre, la normalisation ici n'est qu'un filet.
 */
export function normalizeGroupPath(raw: string): string {
  return raw
    .trim()
    // Origine d'une URL collée.
    .replace(/^https?:\/\/[^/]+/i, '')
    // Tout ce qui suit le séparateur GitLab `/-/` (`app/-/issues` → `app`).
    .replace(/\/-\/.*$/, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/^groups\//i, '')
    .replace(/^\/+|\/+$/g, '');
}

/** Encode un chemin de groupe segment par segment (les `/` restent des `/`). */
function encodeGroupPath(group: string): string {
  return group
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

interface LinkContext {
  /** `moduleConfig.gitlab.url` — brute, telle que saisie. */
  instanceUrl: string;
  /** Username du compte connecté (`state.user.username`), `null` si absent. */
  username: string | null;
  /** `moduleConfig.gitlab.linkGroup` — brut. */
  linkGroup: string;
  /** `moduleConfig.gitlab.watchedLabels`. */
  watchedLabels: string[];
}

/**
 * Base des listes classiques (MR, issues) : groupe si configuré, sinon
 * tableau de bord. `kind` est le segment final (`merge_requests`, `issues`).
 */
function listBase(base: string, group: string, kind: string): string {
  return group
    ? `${base}/groups/${encodeGroupPath(group)}/-/${kind}`
    : `${base}/dashboard/${kind}`;
}

/**
 * URL de la page GitLab correspondant à une section, ou `null` si elle ne
 * peut pas être construite (instance non renseignée, ou compte inconnu pour
 * les sections filtrées sur l'utilisateur courant).
 */
export function sectionUrl(
  section: GitLabSectionKey,
  ctx: LinkContext,
): string | null {
  const base = normalizeInstance(ctx.instanceUrl);
  if (!base) return null;
  const group = normalizeGroupPath(ctx.linkGroup);
  const me = ctx.username?.trim() || null;

  const params = new URLSearchParams();
  params.set('state', 'opened');

  switch (section) {
    case 'watchedIssues': {
      // Pendant de `fetchIssuesByLabel` : ouvertes, sans assigné, portant un
      // label surveillé. `assignee_id=None` est la sentinelle GitLab pour
      // « aucun assigné », côté web comme côté API.
      params.set('assignee_id', 'None');
      params.set('sort', 'created_desc');
      const labels = ctx.watchedLabels.map((l) => l.trim()).filter(Boolean);
      if (labels.length === 1) {
        params.append('label_name[]', labels[0]);
      } else if (labels.length > 1) {
        // Le module interroge chaque label séparément — donc en OU. Un
        // `label_name[]` répété serait interprété en ET par GitLab et ne
        // remonterait rien : c'est `or[label_name][]` qu'il faut ici.
        for (const label of labels) params.append('or[label_name][]', label);
      }
      return `${listBase(base, group, 'issues')}?${params.toString()}`;
    }

    case 'myWorkItems': {
      if (!me) return null;
      params.set('sort', 'updated_desc');
      params.append('assignee_username[]', me);
      return `${base}/dashboard/work_items?${params.toString()}`;
    }

    case 'toReview':
    case 'mine': {
      if (!me) return null;
      params.set('sort', 'updated_desc');
      // `reviewer_username` / `author_username` collent aux filtres API
      // (`reviewer_id` / `author_id`) des deux sections.
      params.set(
        section === 'toReview' ? 'reviewer_username' : 'author_username',
        me,
      );
      // Ignoré par les listes historiques, respecté par la liste GraphQL des
      // groupes : évite une pagination à 20 sur une grosse liste.
      params.set('first_page_size', '100');
      return `${listBase(base, group, 'merge_requests')}?${params.toString()}`;
    }
  }
}
