/**
 * Types partagés entre le main process, le preload et le renderer.
 *
 * Ces définitions sont la source de vérité du contrat IPC : tout ajout d'un
 * nouveau canal IPC ou d'un nouveau payload doit passer par ce fichier pour
 * rester typé de bout en bout (main ↔ preload ↔ renderer).
 */

/** État visuel global du Notch. */
export type NotchMode = 'collapsed' | 'expanded';

/**
 * Périphérique de sortie audio détecté sur Windows.
 *
 * `id` correspond au "Command-Line Friendly ID" exposé par SoundVolumeView
 * (forme `<DeviceName>\Device\Render\<GUID>`), réutilisable directement avec
 * la commande `/SetDefault` du même binaire.
 */
export interface AudioDevice {
  id: string;
  name: string;
  /** Catégorie déduite du nom du device — purement cosmétique (icône). */
  type: 'speakers' | 'headphones' | 'display' | 'other';
  /** True si Windows considère ce device comme la sortie par défaut. */
  isDefault: boolean;
}

/**
 * Snapshot complet de l'état audio système exposé au renderer.
 *
 * Émis à la demande (handler `audio:getState`) ET en push (event
 * `audio:change`) toutes les 2 s pour refléter les changements externes
 * (touches de volume Windows, branchement d'un casque, etc.).
 */
export interface AudioState {
  level: number;
  muted: boolean;
  devices: AudioDevice[];
  currentDeviceId: string | null;
}

/**
 * État courant de la lecture musicale système (SMTC).
 *
 * `playing === false` ET `title === ''` signale "rien ne joue" → la chip
 * doit être masquée dans le notch collapsed.
 *
 * `thumbnail` est un data URL `data:image/png;base64,…` prêt à être passé
 * dans un `<img src="…">`. La conversion Buffer → data URL est faite côté
 * main avant push IPC pour éviter de transporter des Buffers à chaque
 * frame de progress.
 *
 * Le state fait office d'**anchor** pour l'interpolation côté renderer :
 * il expose `position` (s) + `duration` (s) + `updatedAt` (ms timestamp)
 * et le renderer calcule lui-même la position courante via
 * `requestAnimationFrame` à 60 Hz. Ça évite de spammer l'IPC tout en
 * gardant un scrubber fluide ; le main ne re-push qu'en cas de seek,
 * play/pause, ou changement de piste (cf. musicService.update).
 */
export interface MusicState {
  playing: boolean;
  title: string;
  artist: string;
  album: string;
  /** App source détectée par SMTC, ex. "Spotify.exe", "Microsoft.ZuneMusic". */
  source: string;
  /** Pochette base64 prête pour <img src>. Null si non fournie par l'app. */
  thumbnail: string | null;
  /** Position en secondes au moment de `updatedAt`. 0 si pas de timeline. */
  position: number;
  /** Durée totale en secondes. 0 si l'app n'expose pas la timeline. */
  duration: number;
  /** Timestamp (`Date.now()`) de la lecture SMTC qui a produit `position`. */
  updatedAt: number;
}

/**
 * Une tâche utilisateur — éphémère, locale, sans intégration externe en
 * Phase 3. La date `createdAt` permettra l'auto-clear après N jours
 * (future option utilisateur).
 */
export interface Task {
  id: string;
  text: string;
  done: boolean;
  /** Timestamp Unix de création (ms). */
  createdAt: number;
}

/**
 * Identifiants des modules que l'utilisateur peut activer/désactiver
 * depuis les réglages. Note : `audio` n'est pas dans la liste car il est
 * implicite (toujours actif — le footer audio est toujours rendu).
 */
export type ModuleId =
  | 'music'
  | 'meetings'
  | 'gitlab'
  | 'gitlocal'
  | 'claude'
  | 'tasks'
  | 'messages'
  | 'clipboard';

/** Densité visuelle du dashboard étendu. */
export type Density = 'dense' | 'normal' | 'airy';

/**
 * Identifiants des modules qui rendent une tuile dans le dashboard étendu.
 * Sous-ensemble strict de `ModuleId` : `messages` et `clipboard` n'ont
 * pas de card (page dédiée pour clipboard, pas encore implémenté pour
 * messages).
 */
export type DashTileId =
  | 'music'
  | 'meetings'
  | 'gitlab'
  | 'gitlocal'
  | 'claude'
  | 'tasks';

/**
 * Une tuile du dashboard. `cols` est la largeur en colonnes sur une
 * grille de 12 : tant que la somme des `cols` consécutifs ≤ 12, les
 * tuiles s'alignent sur la même rangée ; sinon elles wrap.
 */
export interface DashTile {
  id: DashTileId;
  /** Largeur en colonnes sur 12. Borné [1, 12]. */
  cols: number;
}

/**
 * Configuration spécifique à chaque module. Beaucoup de champs sont des
 * placeholders en attendant que les modules correspondants soient câblés
 * (gitlab, claude, meetings, messages restent en stub Phase 3).
 */
export interface ModuleConfig {
  music: {
    /** Masque la chip et la card quand aucune lecture n'est détectée. */
    hideWhenStopped: boolean;
    /** Afficher la chip dans le notch collapsed (vs. expanded only). */
    collapsed: boolean;
  };
  meetings: {
    /** Seuil sous lequel le prochain meeting est qualifié d'imminent (minutes). */
    imminentMin: number;
    /** Cacher les meetings auxquels on a déjà participé aujourd'hui. */
    hideJoinedToday: boolean;
    /** Nombre max de prochains rendez-vous à afficher dans la card. */
    maxUpcoming: number;
    /** Comptes calendrier connectés (Outlook / Google). */
    accounts: CalendarAccount[];
    /**
     * Credentials d'app OAuth à fournir par l'utilisateur (cf. setup
     * Azure AD App Registration / GCP OAuth Client). Stockés en clair :
     * ce ne sont pas des secrets de chiffrement, juste les identifiants
     * de l'app cliente qui sont distribués avec l'installeur dans un
     * vrai produit.
     */
    clientCredentials: {
      outlook: OAuthClientCredentials | null;
      google: OAuthClientCredentials | null;
    };
    collapsed: boolean;
  };
  gitlocal: {
    /**
     * Dossiers racines scannés récursivement à la recherche de `.git`.
     * Chemins absolus Windows (ex. `C:\\Projets`). Vide = module inactif.
     */
    rootDirs: string[];
    /**
     * Profondeur max du scan en partant de chaque rootDir.
     * 1 = uniquement les enfants directs ; 3 (défaut) couvre la plupart
     * des arborescences `<racine>/<organisation>/<repo>`. Plafonné à 6
     * dans l'UI pour éviter un scan catastrophique sur la racine d'un disque.
     */
    scanDepth: number;
    /**
     * Noms de dossier ignorés pendant le scan (comparaison case-insensitive
     * sur le basename). `.git` est ignoré par construction — pas besoin
     * de l'ajouter ici.
     */
    ignorePatterns: string[];
    /**
     * Fréquence de polling en secondes. Minimum 15 s pour ne pas saturer
     * le disque ; défaut 60 s.
     */
    pollSec: number;
    /**
     * Afficher la chip dans le notch rétracté quand au moins un repo est
     * "dirty" (uncommitted > 0 OU ahead > 0).
     */
    collapsed: boolean;
  };
  gitlab: {
    /** URL de l'instance GitLab (ex: "https://gitlab.cfast.fr"). */
    url: string;
    /**
     * Personal Access Token chiffré via Electron `safeStorage`
     * (DPAPI sous Windows) puis encodé en base64. `null` tant qu'aucun
     * token valide n'a été enregistré.
     */
    encryptedToken: string | null;
    /** Profil GitLab du compte connecté (rempli après test de connexion). */
    account: GitLabUser | null;
    /** Types de notifications souhaitées. */
    notify: {
      mr: boolean;
      pipelines: boolean;
      comments: boolean;
      /** Toast pour les nouvelles issues correspondant à `watchedLabels`. */
      watchedIssues: boolean;
    };
    /**
     * Liste de labels GitLab à surveiller (ex: ["Severity::Critique",
     * "Severity::Bloquant"]). Une issue ouverte matchant au moins un de
     * ces labels apparaîtra dans `state.watchedIssues` et déclenchera
     * un toast à sa création (si `notify.watchedIssues === true`).
     *
     * Saisis tels quels — l'API GitLab compare littéralement (les `::`
     * font partie du nom du label, ce n'est pas une syntaxe spéciale).
     */
    watchedLabels: string[];
    /** Filtrer uniquement les MR/issues assignées à l'utilisateur. */
    assignedOnly: boolean;
    /** Fréquence de polling en secondes. */
    pollSec: number;
    collapsed: boolean;
  };
  claude: {
    /** Notifier la fin d'une session Claude qui était en cours. */
    notifyCompletion: boolean;
    /** Notifier les erreurs des sessions Claude. */
    notifyError: boolean;
    /** Workspaces à surveiller (file watcher sur ~/.claude/projects/X). */
    workspaces: string[];
    /**
     * Affiche la card Claude dans le dashboard étendu. Désactivable pour
     * un mode "notifications seulement" : la card disparaît, mais les
     * toasts (notifyCompletion / notifyError) continuent à être émis et
     * la chip dans le notch rétracté reste contrôlée par `collapsed`.
     */
    showCard: boolean;
    collapsed: boolean;
  };
  tasks: {
    /** Auto-supprime les tâches done plus vieilles que N jours. 0 = jamais. */
    autoClearDays: number;
    /** Critère de tri par défaut. */
    sortBy: 'created' | 'alpha';
    collapsed: boolean;
  };
  messages: {
    /** Afficher l'aperçu du message dans la card. */
    showPreview: boolean;
    /** Marquer automatiquement comme lu à l'ouverture du notch. */
    markReadOnOpen: boolean;
    collapsed: boolean;
  };
  clipboard: {
    /**
     * Nombre maximal d'entrées non-épinglées conservées dans l'historique.
     * Les épinglées ne comptent pas dans la limite.
     */
    maxItems: number;
    /** Afficher la chip Clipboard dans le notch rétracté. */
    collapsed: boolean;
    /**
     * Active l'unfurl HTTP (récupération du titre + favicon) pour les
     * URLs. Désactivable pour les utilisateurs sensibles à la confidentialité
     * (chaque URL copiée déclenche alors un GET sur le site cible).
     */
    enableUnfurl: boolean;
    /**
     * Masque automatiquement (UI ••••) les entrées qui ressemblent à des
     * secrets (token=…, password=…, longues chaînes base64/hex sans contexte).
     * La détection reste heuristique : l'utilisateur peut révéler en un clic.
     */
    maskSensitive: boolean;
  };
}

/**
 * Réglages utilisateur persistés via electron-store
 * (`%APPDATA%/winnotch/config.json` par défaut).
 *
 * Au démarrage, electron-store applique `DEFAULT_SETTINGS` pour les
 * champs absents — utile pour les évolutions de schéma : ajouter un
 * champ dans la maquette ne casse pas une installation existante.
 */
export interface Settings {
  /** Mode "Ne pas déranger" : masque chips droite + bloque toasts. */
  dnd: boolean;
  /** Liste des tâches utilisateur. */
  tasks: Task[];
  /** Densité visuelle (espacements et tailles internes). */
  density: Density;
  /** Activation par module. False masque la chip + la card. */
  modules: Record<ModuleId, boolean>;
  /** Configurations détaillées par module. */
  moduleConfig: ModuleConfig;
  /**
   * Si `true`, WinNotch démarre automatiquement avec Windows
   * (entrée dans `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
   * gérée par `app.setLoginItemSettings`).
   */
  autoStart: boolean;
  /**
   * Ordre + largeur des tuiles dans le dashboard étendu. L'ordre du
   * tableau dicte le rendu ; `cols` (1..12) dicte la largeur. Les
   * tuiles s'enchaînent ; tant que la somme des `cols` reste ≤ 12,
   * elles partagent une rangée. Les tuiles dont le module est désactivé
   * (`settings.modules[id] === false`) ne sont pas rendues mais
   * conservent leur slot dans le layout pour la réactivation.
   */
  dashboardLayout: DashTile[];
}

/** Snapshot par défaut quand le store est vide. */
export const DEFAULT_SETTINGS: Settings = {
  dnd: false,
  tasks: [],
  density: 'airy',
  autoStart: false,
  modules: {
    music: true,
    meetings: true,
    gitlab: true,
    gitlocal: true,
    claude: true,
    tasks: true,
    messages: true,
    clipboard: true,
  },
  moduleConfig: {
    music: {
      hideWhenStopped: true,
      collapsed: true,
    },
    meetings: {
      imminentMin: 5,
      hideJoinedToday: false,
      maxUpcoming: 5,
      accounts: [],
      clientCredentials: { outlook: null, google: null },
      collapsed: true,
    },
    gitlab: {
      url: '',
      encryptedToken: null,
      account: null,
      notify: { mr: true, pipelines: false, comments: false, watchedIssues: true },
      watchedLabels: [],
      assignedOnly: false,
      pollSec: 120,
      collapsed: true,
    },
    gitlocal: {
      rootDirs: [],
      scanDepth: 3,
      ignorePatterns: ['node_modules', 'dist', 'out', 'bin', 'obj', '.next', '.vs'],
      pollSec: 60,
      collapsed: true,
    },
    claude: {
      notifyCompletion: true,
      notifyError: true,
      workspaces: [],
      showCard: true,
      collapsed: true,
    },
    tasks: {
      autoClearDays: 0,
      sortBy: 'created',
      collapsed: true,
    },
    messages: {
      showPreview: true,
      markReadOnOpen: false,
      collapsed: true,
    },
    clipboard: {
      maxItems: 50,
      collapsed: true,
      enableUnfurl: true,
      maskSensitive: true,
    },
  },
  // Layout par défaut — reproduit l'agencement historique :
  //   ┌── tasks (4) ─┬─── meetings (8) ───┐
  //   ├──────── music (12) ────────────────┤
  //   ├── gitlab (6) ─┬───── claude (6) ───┤
  //   └──────── gitlocal (12) ──────────────┘
  // L'utilisateur peut réordonner et redimensionner via Settings → Disposition.
  dashboardLayout: [
    { id: 'tasks', cols: 4 },
    { id: 'meetings', cols: 8 },
    { id: 'music', cols: 12 },
    { id: 'gitlab', cols: 6 },
    { id: 'claude', cols: 6 },
    { id: 'gitlocal', cols: 12 },
  ],
};

/**
 * Payload d'un toast éphémère (notification pill sous le notch).
 *
 * Les couleurs sont des valeurs CSS valides (var(--xxx) ou hex direct)
 * pour rester libres sur l'apparence sans modifier le contrat IPC.
 */
export interface Toast {
  /** Classe Font Awesome complète, ex. "fa-solid fa-check". */
  icon: string;
  /** Couleur CSS de l'icône, ex. "#34d399" ou "var(--accent)". */
  iconColor: string;
  /** Nom court à gauche (mono 11 px), ex. "Notch", "cfast-web". */
  name: string;
  /** Message principal à droite (texte gris). */
  message: string;
  /**
   * Marqueur unique optionnel pour réinitialiser l'animation à chaque
   * push. Si omis, généré côté renderer (Date.now()).
   */
  id?: number;
  /**
   * Si true, le toast est affiché même quand `dnd` est actif.
   * Utilisé par le toggle DND lui-même qui DOIT confirmer la bascule.
   */
  systemException?: boolean;
}

/**
 * Modes détectés par la search bar.
 *
 * Préfixés (l'utilisateur les déclenche en tapant un caractère initial) :
 *  - `task`         (`-` …)
 *  - `claude`       (`> …`)
 *  - `vscode`       (`/ …`)
 *  - `visualstudio` (`vs …`)
 *  - `help`         (`? …`) — vue d'aide listant tout ce qu'on peut faire
 *
 * Contenu live (détection automatique du contenu collé/tapé sans préfixe) :
 *  - `url`, `json`, `color`, `jwt`, `path` — chaque type déclenche une
 *    vue plein dashboard avec preview et actions adaptées. Voir
 *    `shared/clipboardDetectors.ts` pour la logique de détection.
 */
export type SearchMode =
  | 'claude'
  | 'vscode'
  | 'visualstudio'
  | 'task'
  | 'help'
  | 'url'
  | 'json'
  | 'color'
  | 'jwt'
  | 'path';

/* ─────────────────────────────────────────────────────────────────────
 *  CLAUDE CODE
 * ─────────────────────────────────────────────────────────────────── */

/** Statut courant d'une session Claude Code, dérivé de la mtime du fichier. */
export type ClaudeSessionStatus = 'working' | 'waiting' | 'idle' | 'done';

/**
 * Une session Claude Code détectée sur disque (fichier .jsonl dans
 * `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`).
 *
 * Les valeurs sont dérivées du dernier event JSONL + de la mtime du
 * fichier. Pas de tracking de processus — on observe juste les
 * fichiers que Claude Code écrit.
 */
export interface ClaudeSession {
  id: string;
  /** Nom court du projet (basename de `cwd`). */
  project: string;
  /** Working directory complet de la session. */
  cwd: string;
  /** Branche git active (vide si Claude n'a pas pu la lire). */
  branch: string;
  /** Slug du plan en cours, si Claude Code en a un. */
  slug: string;
  /** Statut dérivé de la mtime et du dernier event. */
  status: ClaudeSessionStatus;
  /** Texte court résumant la dernière action (tronqué à ~80 chars). */
  currentText: string;
  /** Total cumulé des output_tokens sur tous les events de la session. */
  tokens: number;
  /** Date ISO du dernier event. */
  lastActivity: string;
  /** Modèle utilisé sur le dernier event (claude-opus-4-7, etc.). */
  model: string;
  /**
   * True si Claude attend une réponse explicite de l'utilisateur — typique
   * des tools `AskUserQuestion`, `ExitPlanMode`. Permet d'émettre un toast
   * spécifique ("En attente de ta réponse") différent du toast de fin de
   * session ("Session terminée").
   */
  waitingForInput: boolean;
  /**
   * True si le dernier tour assistant (depuis le dernier message utilisateur
   * humain) contient au moins un `tool_use` d'exécution — Bash, Read, Edit,
   * Write, Grep, etc. — autre que les user-input tools.
   *
   * Utilisé pour filtrer le toast "Session terminée" : un tour purement
   * conversationnel (récap, explication, réponse simple) n'émet plus de
   * notification, seuls les tours productifs déclenchent un toast à leur
   * `end_turn`.
   */
  lastTurnHadWork: boolean;
}

/* ─────────────────────────────────────────────────────────────────────
 *  GITLAB
 * ─────────────────────────────────────────────────────────────────── */

/**
 * Profil utilisateur GitLab récupéré via `GET /user`.
 * Stocké dans `moduleConfig.gitlab.account` après un test de connexion
 * réussi : sert d'identité pour filtrer les MR (`reviewer_id`, `author_id`).
 */
export interface GitLabUser {
  id: number;
  username: string;
  name: string;
  avatarUrl: string;
  webUrl: string;
}

/**
 * Merge Request normalisée depuis l'API REST v4 (`GET /merge_requests`).
 *
 * Les champs sont déjà aplatis depuis la réponse GitLab : on n'expose pas
 * `references.full` brut mais une seule string `reference` (ex.
 * "group/subgroup/project!42").
 */
export interface GitLabMr {
  /** ID global GitLab (unique tous projets confondus). */
  id: number;
  /** IID = numéro de la MR au sein du projet (visible dans l'URL). */
  iid: number;
  projectId: number;
  /** Nom court du projet (ex: "winnotch"). */
  projectName: string;
  /** Référence absolue "group/project!iid" pour l'affichage. */
  reference: string;
  title: string;
  webUrl: string;
  authorName: string;
  authorAvatarUrl: string;
  /** ISO 8601, sert au tri et au calcul d'âge. */
  createdAt: string;
  updatedAt: string;
  draft: boolean;
  hasConflicts: boolean;
  /**
   * Statut détaillé GitLab (`checking`, `mergeable`, `ci_must_pass`,
   * `discussions_not_resolved`, etc.). Permet d'afficher un badge plus
   * fin que le simple `merge_status`.
   */
  detailedMergeStatus: string;
}

/**
 * Issue GitLab normalisée. Même forme que `GitLabMr` mais
 * référence `#iid` et porte la liste des labels appliqués.
 */
export interface GitLabIssue {
  id: number;
  iid: number;
  projectId: number;
  projectName: string;
  /** Référence "group/project#iid". */
  reference: string;
  title: string;
  webUrl: string;
  authorName: string;
  authorAvatarUrl: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  /**
   * Label parmi `moduleConfig.gitlab.watchedLabels` qui a déclenché la
   * détection. Sert à colorer le badge dans l'UI et à choisir l'icône.
   */
  matchedLabel: string;
}

/**
 * Snapshot complet exposé au renderer via `gitlab:getState` + push
 * `gitlab:change`.
 *
 * `configured` permet à l'UI de masquer la chip + la card tant que
 * l'utilisateur n'a pas saisi d'URL ni de PAT, sans devoir checker
 * les Settings séparément.
 */
export interface GitLabState {
  /** True si URL + token valide stockés ET au moins un fetch réussi. */
  configured: boolean;
  user: GitLabUser | null;
  /** MR où l'utilisateur est reviewer (state=opened), tri par updatedAt DESC. */
  toReview: GitLabMr[];
  /** MR créées par l'utilisateur (state=opened), tri par updatedAt DESC. */
  mine: GitLabMr[];
  /**
   * Issues ouvertes correspondant à au moins un des
   * `moduleConfig.gitlab.watchedLabels`. Tri par createdAt DESC.
   */
  watchedIssues: GitLabIssue[];
  /** ISO du dernier fetch réussi. `null` si jamais réussi. */
  lastFetchAt: string | null;
  /** Message d'erreur du dernier fetch raté (ex: 401, network down). */
  lastError: string | null;
}

/* ─────────────────────────────────────────────────────────────────────
 *  GIT LOCAL
 * ─────────────────────────────────────────────────────────────────── */

/**
 * Statut normalisé d'un repo git local détecté par le scan.
 *
 * `isDirty` = uncommitted > 0 OU ahead > 0 : le repo a des modifs locales
 * qui ne sont pas encore sur l'origine (rappel passif).
 */
export interface GitLocalRepo {
  /** Chemin absolu du repo. Clé unique stable. */
  path: string;
  /** Nom affiché (basename du dossier). */
  name: string;
  /** Branche active. Vide pour un detached HEAD. */
  branch: string;
  /** Commits ahead de l'upstream. 0 si pas d'upstream. */
  ahead: number;
  /** Commits behind l'upstream. 0 si pas d'upstream. */
  behind: number;
  /** Nombre de fichiers modifiés / ajoutés / supprimés / staged. */
  uncommitted: number;
  /** True si uncommitted > 0 OU ahead > 0 (au moins un signal "à pousser"). */
  isDirty: boolean;
  /** True si la branche locale n'a pas d'upstream configuré. */
  noUpstream: boolean;
  /**
   * Erreur de scan pour ce repo (corruption .git, accès refusé, etc.).
   * `null` si la lecture s'est bien passée.
   */
  error: string | null;
}

/**
 * Snapshot complet exposé au renderer via `gitlocal:getState` + push
 * `gitlocal:change`.
 *
 * `configured` = au moins un dossier racine renseigné. Si `false`, l'UI
 * affiche un placeholder d'invite à configurer.
 */
export interface GitLocalState {
  /** True si au moins un rootDir est configuré dans les Settings. */
  configured: boolean;
  /** Snapshot des repos détectés (tri par isDirty DESC, name ASC). */
  repos: GitLocalRepo[];
  /** ISO 8601 du dernier scan terminé. `null` tant qu'aucun scan n'a fini. */
  lastScanAt: string | null;
  /**
   * Erreur globale du dernier scan (ex: `git` introuvable dans le PATH).
   * Les erreurs par repo restent dans `repos[].error`.
   */
  lastError: string | null;
}

/* ─────────────────────────────────────────────────────────────────────
 *  UPDATER (electron-updater)
 * ─────────────────────────────────────────────────────────────────── */

/**
 * États possibles du flux de mise à jour, dérivés des événements
 * `autoUpdater` d'electron-updater :
 *
 *  - `idle`         : aucun check en cours, aucune update détectée
 *  - `checking`     : vérification de version en cours auprès du provider
 *  - `no-update`    : version installée == dernière disponible
 *  - `available`    : update détectée, en attente de l'action user (download)
 *  - `downloading`  : téléchargement en cours, `downloadPercent` mis à jour
 *  - `downloaded`   : téléchargement terminé, prêt à installer (redémarrage)
 *  - `error`        : échec du check ou du download, `error` rempli
 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'no-update'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

/**
 * Snapshot exposé au renderer via `updater:getState` + push
 * `updater:change`. Sert à afficher l'état dans la page Settings et
 * à conditionner les toasts.
 */
export interface UpdateState {
  status: UpdateStatus;
  /** Version courante installée de WinNotch (lue depuis `app.getVersion()`). */
  currentVersion: string;
  /** Dernière version disponible, remplie une fois `available` ou +. */
  latestVersion: string | null;
  /** Pourcentage [0..100], rempli uniquement pendant `downloading`. */
  downloadPercent: number | null;
  /** Message d'erreur du dernier check / download échoué. */
  error: string | null;
}

/* ─────────────────────────────────────────────────────────────────────
 *  MEETINGS
 * ─────────────────────────────────────────────────────────────────── */

/** Identifie l'origine d'un calendrier connecté. */
export type CalendarProviderId = 'outlook' | 'google';

/**
 * Compte calendrier connecté.
 *
 * Les `tokens` sont chiffrés via Electron `safeStorage` avant d'être
 * persistés. Le champ est typé `string` car le payload chiffré est
 * sérialisé en base64.
 */
export interface CalendarAccount {
  id: string;
  provider: CalendarProviderId;
  /** Email du compte connecté, affiché dans les Settings. */
  email: string;
  /** Couleur d'affichage de l'avatar/badge. */
  color: string;
  /** Tokens OAuth chiffrés (safeStorage). Format opaque côté renderer. */
  encryptedTokens: string;
  /** Date d'expiration de l'access token (Unix ms). */
  expiresAt: number;
  /**
   * Photo de profil de l'utilisateur connecté (data URL). Récupérée
   * via /me/photo (Graph) ou équivalent. Sert à enrichir les avatars
   * du module Meetings quand cet utilisateur est listé comme participant
   * d'un RDV.
   */
  selfPhotoDataUrl?: string;
  /** Timestamp Unix ms du dernier fetch réussi (ou tentative). Sert au TTL. */
  selfPhotoFetchedAt?: number;
}

/** Type de localisation/visio détecté à partir de la chaîne `location`. */
export type MeetingKind = 'meet' | 'teams' | 'zoom' | 'room' | 'other';

/** Participant d'un rendez-vous normalisé. */
export interface MeetingAttendee {
  /** Nom d'affichage tel que renvoyé par le provider. Peut être vide. */
  name: string;
  /** Adresse email. Peut être vide si le provider ne l'expose pas. */
  email: string;
  /** True si ce participant est l'organisateur du RDV. */
  isOrganizer: boolean;
  /**
   * Data URL de la photo de profil. Présent uniquement quand cet
   * attendee correspond à un CalendarAccount connecté (V1 : sa propre
   * photo uniquement, pas celle des autres participants).
   */
  photoDataUrl?: string;
}

/** Rendez-vous normalisé renvoyé par n'importe quel provider. */
export interface Meeting {
  /** ID stable du provider (utile pour dédupliquer si plusieurs comptes). */
  id: string;
  /** Compte d'origine. */
  accountId: string;
  provider: CalendarProviderId;
  title: string;
  /** Lieu / lien de visio brut renvoyé par le provider. */
  location: string;
  /** Type d'événement déduit (utilisé pour l'icône). */
  kind: MeetingKind;
  /** Début ISO 8601 (avec timezone). */
  start: string;
  /** Fin ISO 8601. */
  end: string;
  /** Durée en minutes calculée à partir de start/end. */
  durationMin: number;
  /**
   * Participants triés organisateur en premier. Les initiales pour
   * l'affichage en avatar sont calculées côté UI à partir de `name`.
   */
  attendees: MeetingAttendee[];
  /** True si l'événement est en cours (start <= now < end). */
  ongoing: boolean;
  /** Minutes jusqu'au début (négatif si en cours ou passé). */
  minutesUntil: number;
  /**
   * URL pour ouvrir le RDV dans le calendrier web du provider (Outlook
   * web / Google Calendar). Sert au bouton "Ouvrir" quand aucune visio
   * n'est attachée.
   */
  webLink?: string;
}

/**
 * Credentials d'app OAuth fournis par l'utilisateur.
 * - Outlook (Microsoft Graph) : clientId suffit (Authorization Code + PKCE
 *   pour les apps publiques desktop).
 * - Google : clientId + clientSecret (les desktop apps Google exigent le
 *   secret même s'il n'est pas réellement secret pour un client public).
 */
export interface OAuthClientCredentials {
  clientId: string;
  /** Optionnel — requis pour Google, ignoré pour Outlook. */
  clientSecret?: string;
  /** Optionnel — tenant Azure AD (par défaut "common"). */
  tenantId?: string;
}

/**
 * Résultat normalisé renvoyé par les backends de recherche
 * (VS Code workspaces, Visual Studio solutions). Une forme unique
 * permet à un seul composant `SearchResultsPanel` de tout afficher.
 */
export interface SearchResult {
  /** Type discriminant — utilisé pour choisir l'icône et l'action d'ouverture. */
  kind: 'vscode-folder' | 'vscode-workspace' | 'vs-solution';
  /** Nom affiché en titre (basename du chemin par défaut). */
  name: string;
  /** Chemin absolu Windows. */
  path: string;
  /** Sous-titre : "Workspace", "il y a 2 j", etc. */
  meta: string;
}

/* ─────────────────────────────────────────────────────────────────────
 *  CLIPBOARD
 * ─────────────────────────────────────────────────────────────────── */

/**
 * Type détecté pour une entrée du presse-papier.
 *
 * Le pipeline de détection (cf. `main/modules/clipboard/detectors/index.ts`)
 * essaie chaque détecteur dans cet ordre et retourne au premier match :
 * `image` > `jwt` > `url` > `json` > `color` > `path` > `text` (fallback).
 *
 * L'ordre est important : un JWT peut contenir des points qui pourraient
 * être confondus avec une URL, donc JWT passe en premier ; un JSON court
 * peut contenir `#fff` mais n'est pas une couleur globale, etc.
 */
export type ClipboardEntryType =
  | 'image'
  | 'jwt'
  | 'url'
  | 'json'
  | 'color'
  | 'path'
  | 'text';

/**
 * Une entrée de l'historique du presse-papier.
 *
 * Pour `type === 'image'`, `text` vaut `null` et `imagePath` pointe vers
 * un PNG stocké sur disque (cf. `imageStore.ts`). Pour tous les autres
 * types, `text` contient le contenu original (chiffré au repos via
 * safeStorage) et `imagePath` vaut `null`.
 *
 * `meta` est typé `Record<string, unknown>` côté contrat IPC mais chaque
 * détecteur peuple les champs attendus :
 *  - url   : `{ title?: string; favicon?: string; unfurledAt?: number }`
 *  - color : `{ format: 'hex' | 'rgb' | 'hsl'; r,g,b: number; a?: number }`
 *  - jwt   : `{ header: object; payload: object; expIso?: string }`
 *  - json  : `{ pretty: string; isArray: boolean; length: number }`
 *  - image : `{ width: number; height: number; bytes: number }`
 *  - path  : `{ isDir?: boolean; exists?: boolean }`
 *  - text  : `{}`
 */
export interface ClipboardEntry {
  id: string;
  type: ClipboardEntryType;
  /**
   * Aperçu court (≤120 chars) calculé par le détecteur pour l'affichage
   * sans avoir à manipuler le `text` original (utile aussi pour la chip
   * rétractée qui n'a pas la place).
   */
  preview: string;
  /** Contenu original. `null` uniquement pour les images. */
  text: string | null;
  /** Chemin absolu vers le PNG persisté, `null` sauf pour les images. */
  imagePath: string | null;
  /** Unix ms de la copie. */
  copiedAt: number;
  pinned: boolean;
  /**
   * True si l'entrée ressemble à un secret (token=…, longue chaîne
   * base64/hex…). L'UI masque le contenu jusqu'au clic "Révéler".
   */
  sensitive: boolean;
  /** Métadonnées spécifiques au type (cf. ClipboardEntry doc). */
  meta: Record<string, unknown>;
}

/**
 * Snapshot complet exposé au renderer via `clipboard:getState` + push
 * `clipboard:change`.
 *
 * Les entrées sont déjà triées : épinglées en tête (par `copiedAt` DESC),
 * puis non-épinglées (par `copiedAt` DESC).
 */
export interface ClipboardState {
  entries: ClipboardEntry[];
  /**
   * Unix ms de la dernière fois où l'utilisateur a ouvert la card Clipboard.
   * Sert au badge "non vu" sur la chip (nombre d'entries dont
   * `copiedAt > lastSeenAt`).
   */
  lastSeenAt: number;
}

/**
 * Données d'unfurl d'une URL (titre + favicon).
 *
 * Renseignées lazily quand le renderer affiche un item URL pour la
 * première fois. Cache mémoire main avec TTL 24 h (cf. `urlUnfurl.ts`).
 */
export interface UrlUnfurl {
  url: string;
  title: string | null;
  /** Data URL ou URL absolue du favicon. `null` si non récupéré. */
  favicon: string | null;
  /** Unix ms du fetch réussi. */
  fetchedAt: number;
}

/**
 * Catalogue centralisé des canaux IPC.
 *
 * Utiliser cet objet plutôt que des chaînes en dur partout dans le code
 * évite les fautes de frappe silencieuses (le typage TypeScript ne couvre
 * pas les strings passées à `ipcRenderer.invoke`).
 */
export const IpcChannel = {
  /** Renderer → main : active/désactive la capture des événements souris. */
  MouseCapture: 'mouse:capture',
  /** Main → renderer : notifie le passage en mode Peek (Alt maintenu). */
  PeekChange: 'peek:change',

  /** Renderer → main (invoke) : retourne l'AudioState courant. */
  AudioGetState: 'audio:getState',
  /** Renderer → main (invoke) : règle le volume système 0-100. */
  AudioSetVolume: 'audio:setVolume',
  /** Renderer → main (invoke) : active/coupe le son. */
  AudioSetMuted: 'audio:setMuted',
  /** Renderer → main (invoke) : change le périphérique de sortie par défaut. */
  AudioSetDevice: 'audio:setDevice',
  /** Main → renderer : push d'un nouvel AudioState (polling 2 s). */
  AudioChange: 'audio:change',

  /** Renderer → main (invoke) : retourne le MusicState courant. */
  MusicGetState: 'music:getState',
  /** Renderer → main (invoke) : toggle play/pause (touche VK_MEDIA_PLAY_PAUSE). */
  MusicPlayPause: 'music:playPause',
  /** Renderer → main (invoke) : passe à la piste suivante. */
  MusicNext: 'music:next',
  /** Renderer → main (invoke) : revient à la piste précédente. */
  MusicPrevious: 'music:previous',
  /** Main → renderer : push d'un nouvel MusicState (sur événement SMTC). */
  MusicChange: 'music:change',

  /** Renderer → main (invoke) : retourne l'intégralité des Settings. */
  SettingsGetAll: 'settings:getAll',
  /** Renderer → main (invoke) : bascule l'état DND, retourne le nouveau Settings. */
  SettingsToggleDnd: 'settings:toggleDnd',
  /** Renderer → main (invoke) : ajoute une tâche, retourne le nouveau Settings. */
  SettingsAddTask: 'settings:addTask',
  /** Renderer → main (invoke) : bascule done sur une tâche, retourne le nouveau Settings. */
  SettingsToggleTask: 'settings:toggleTask',
  /** Renderer → main (invoke) : supprime une tâche, retourne le nouveau Settings. */
  SettingsRemoveTask: 'settings:removeTask',
  /** Renderer → main (invoke) : supprime toutes les tâches done, retourne le nouveau Settings. */
  SettingsClearDoneTasks: 'settings:clearDoneTasks',
  /** Renderer → main (invoke) : active/désactive un module, retourne le nouveau Settings. */
  SettingsSetModule: 'settings:setModule',
  /** Renderer → main (invoke) : règle la densité visuelle, retourne le nouveau Settings. */
  SettingsSetDensity: 'settings:setDensity',
  /** Renderer → main (invoke) : patch partiel d'une moduleConfig, retourne le nouveau Settings. */
  SettingsPatchModuleConfig: 'settings:patchModuleConfig',
  /** Renderer → main (invoke) : active/désactive le démarrage automatique avec Windows. */
  SettingsSetAutoStart: 'settings:setAutoStart',
  /**
   * Renderer → main (invoke) : remplace `dashboardLayout` complet
   * (ordre + largeur des tuiles). Validation côté main (cols 1..12,
   * DashTileId valide, pas de doublons).
   */
  SettingsSetDashboardLayout: 'settings:setDashboardLayout',
  /** Main → renderer : push de Settings (ex. toggle DND via raccourci global). */
  SettingsChange: 'settings:change',

  /** Renderer → main : lance Claude CLI dans un nouveau terminal avec prompt. */
  ShellLaunchClaude: 'shell:launchClaude',
  /**
   * Renderer → main (invoke) : ouvre une URL dans le navigateur par défaut
   * via `shell.openExternal`. Refuse tout schéma autre que http(s) côté main.
   */
  ShellOpenExternal: 'shell:openExternal',
  /**
   * Renderer → main (invoke) : ouvre l'Explorer Windows sur un chemin
   * arbitraire (typiquement saisi via la search bar en mode détection).
   * Le main valide le format Windows + vérifie l'existence avant d'appeler
   * `shell.showItemInFolder` pour éviter une fuite (chemin réseau aléatoire).
   */
  ShellOpenPath: 'shell:openPath',
  /** Main → renderer : bascule le mode collapsed/expanded (raccourci global). */
  ShellToggleNotch: 'shell:toggleNotch',
  /** Main → renderer : force la rétraction (clic outside via window blur). */
  ShellRequestCollapse: 'shell:requestCollapse',
  /** Main → renderer : notifie qu'une fenêtre fullscreen apparaît/disparaît sur l'écran principal. */
  ShellFullscreenChange: 'shell:fullscreenChange',
  /** Renderer → main : informe du nouveau mode (collapsed/expanded) — sert à enregistrer Esc en global shortcut seulement quand expanded. */
  ShellModeChanged: 'shell:modeChanged',
  /** Renderer → main : quitte WinNotch proprement (déclenche before-quit + window-all-closed). */
  ShellQuit: 'shell:quit',

  /** Renderer → main (invoke) : liste les workspaces VS Code récents. */
  SearchListVsCode: 'search:listVsCode',
  /** Renderer → main (invoke) : liste les solutions Visual Studio détectées. */
  SearchListVs: 'search:listVs',
  /** Renderer → main (invoke) : ouvre un workspace VS Code (`code <path>`). */
  SearchOpenVsCode: 'search:openVsCode',
  /** Renderer → main (invoke) : ouvre une solution Visual Studio (`start <path>`). */
  SearchOpenVs: 'search:openVs',

  /** Renderer → main (invoke) : démarre le flow OAuth pour un provider. Retourne le compte créé. */
  MeetingsConnect: 'meetings:connect',
  /** Renderer → main (invoke) : déconnecte un compte (oubli des tokens). */
  MeetingsDisconnect: 'meetings:disconnect',
  /** Renderer → main (invoke) : liste agrégée des prochains meetings (cache). */
  MeetingsList: 'meetings:list',
  /** Renderer → main (invoke) : force un refresh immédiat (skip cache). */
  MeetingsRefresh: 'meetings:refresh',
  /** Renderer → main (invoke) : indique si des credentials par défaut sont embarqués. */
  MeetingsHasDefaults: 'meetings:hasDefaults',
  /** Main → renderer : push de la nouvelle liste de meetings (polling 5 min). */
  MeetingsChange: 'meetings:change',

  /** Renderer → main (invoke) : liste les sessions Claude détectées. */
  ClaudeList: 'claude:list',
  /** Main → renderer : push de la nouvelle liste de sessions (file watcher). */
  ClaudeChange: 'claude:change',

  /** Renderer → main (invoke) : retourne le GitLabState courant. */
  GitLabGetState: 'gitlab:getState',
  /**
   * Renderer → main (invoke) : valide une paire URL + PAT sans la
   * persister. Sert au bouton "Tester la connexion" des Settings.
   */
  GitLabTestConnection: 'gitlab:testConnection',
  /**
   * Renderer → main (invoke) : valide la paire URL + PAT, et si OK
   * chiffre + persiste le PAT et déclenche un fetch immédiat.
   */
  GitLabSaveCredentials: 'gitlab:saveCredentials',
  /** Renderer → main (invoke) : supprime les credentials et stoppe le polling. */
  GitLabClearCredentials: 'gitlab:clearCredentials',
  /** Renderer → main (invoke) : force un refresh immédiat (skip l'attente du tick). */
  GitLabRefresh: 'gitlab:refresh',
  /** Main → renderer : push d'un nouveau GitLabState (polling ou save). */
  GitLabChange: 'gitlab:change',

  /** Renderer → main (invoke) : retourne le GitLocalState courant. */
  GitLocalGetState: 'gitlocal:getState',
  /**
   * Renderer → main (invoke) : force un rescan + statuts immédiat (skip
   * l'attente du tick de polling). Retourne le nouveau snapshot.
   */
  GitLocalRefresh: 'gitlocal:refresh',
  /**
   * Renderer → main (invoke) : ouvre un repo. Détecte d'abord la présence
   * d'un `.sln`/`.slnx` à la racine → Visual Studio via association de
   * fichier. Sinon → VS Code (`code <path>`).
   */
  GitLocalOpenRepo: 'gitlocal:openRepo',
  /** Main → renderer : push d'un nouveau GitLocalState (polling ou refresh). */
  GitLocalChange: 'gitlocal:change',

  /** Renderer → main (invoke) : retourne le ClipboardState courant. */
  ClipboardGetState: 'clipboard:getState',
  /** Renderer → main (invoke) : épingle une entrée (hors limite maxItems). */
  ClipboardPin: 'clipboard:pin',
  /** Renderer → main (invoke) : retire l'épingle d'une entrée. */
  ClipboardUnpin: 'clipboard:unpin',
  /** Renderer → main (invoke) : recopie l'entrée dans le presse-papier système. */
  ClipboardCopyAgain: 'clipboard:copyAgain',
  /** Renderer → main (invoke) : supprime une entrée. */
  ClipboardRemove: 'clipboard:remove',
  /** Renderer → main (invoke) : vide tout l'historique (sauf épinglés selon param). */
  ClipboardClear: 'clipboard:clear',
  /** Renderer → main (invoke) : met à jour `lastSeenAt` pour effacer le badge "non vu". */
  ClipboardMarkSeen: 'clipboard:markSeen',
  /**
   * Renderer → main (invoke) : récupère titre/favicon d'une entrée URL.
   * Lazy : déclenché par le premier affichage de l'item.
   */
  ClipboardUnfurl: 'clipboard:unfurl',
  /**
   * Renderer → main (invoke) : ouvre le PNG d'une entrée image dans une
   * boîte de dialogue de sauvegarde (`showSaveDialog` + copie du fichier).
   */
  ClipboardSaveImage: 'clipboard:saveImage',
  /**
   * Renderer → main (invoke) : retourne le PNG d'une entrée image en
   * data URL (`data:image/png;base64,…`). Utilisé par les composants
   * d'affichage qui ne peuvent pas charger `file://` directement dans
   * <img src> (contextIsolation Electron).
   */
  ClipboardGetImageDataUrl: 'clipboard:getImageDataUrl',
  /**
   * Renderer → main (invoke) : ouvre l'Explorer sur le chemin Windows
   * détecté pour une entrée de type `path`. Sécurité : le main vérifie
   * que le chemin existe avant l'appel à `shell.showItemInFolder`.
   */
  ClipboardOpenPath: 'clipboard:openPath',
  /** Main → renderer : push d'un nouveau ClipboardState. */
  ClipboardChange: 'clipboard:change',
  /**
   * Main → renderer : demande d'afficher la card Clipboard avec focus
   * sur la recherche (déclenché par le raccourci global Ctrl+Shift+V).
   */
  ClipboardFocusCard: 'clipboard:focusCard',

  /** Renderer → main (invoke) : retourne l'UpdateState courant. */
  UpdaterGetState: 'updater:getState',
  /** Renderer → main (invoke) : déclenche un check immédiat auprès du provider. */
  UpdaterCheckNow: 'updater:checkNow',
  /** Renderer → main (invoke) : lance le download de l'update détectée. */
  UpdaterDownload: 'updater:download',
  /** Renderer → main (invoke) : quitte WinNotch et installe l'update téléchargée. */
  UpdaterQuitAndInstall: 'updater:quitAndInstall',
  /** Main → renderer : push d'un nouvel UpdateState (event autoUpdater). */
  UpdaterChange: 'updater:change',
} as const;

export type IpcChannelValue = (typeof IpcChannel)[keyof typeof IpcChannel];

/**
 * Surface API exposée au renderer via contextBridge.
 *
 * Le renderer y accède sous `window.notch.*`. Toutes les méthodes traversent
 * le tunnel IPC ; aucune d'entre elles n'expose un objet Node brut.
 */
export interface NotchApi {
  shell: {
    /** Demande au main process d'activer/désactiver la capture souris. */
    setMouseCapture: (capture: boolean) => void;
    /**
     * S'abonne aux changements d'état du mode Peek (Alt maintenu).
     * Retourne une fonction de désabonnement.
     */
    onPeek: (cb: (on: boolean) => void) => () => void;
    /**
     * Lance `claude <prompt>` dans un nouveau terminal Windows détaché.
     * Le main process gère le spawn ; le renderer ne voit que le résultat.
     */
    launchClaude: (prompt: string) => Promise<{ ok: boolean; error?: string }>;
    /**
     * Ouvre une URL externe (http/https) dans le navigateur par défaut
     * de l'OS. Le main rejette les autres schémas (file://, etc.).
     */
    openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
    /**
     * Ouvre l'Explorer Windows sur un chemin local ou UNC. Le main
     * valide le format (regex) puis vérifie l'existence avant l'appel
     * à `shell.showItemInFolder`. Retourne `{ ok: false }` avec erreur
     * si le format est invalide ou le chemin n'existe pas.
     */
    openPath: (path: string) => Promise<{ ok: boolean; error?: string }>;
    /**
     * Notifie le main du nouveau mode (collapsed/expanded). Le main
     * enregistre Escape comme global shortcut **uniquement** quand le
     * notch est expanded — permet de le fermer même sans focus système,
     * tout en gardant Esc libre pour les autres apps en mode collapsed.
     */
    notifyModeChanged: (mode: NotchMode) => void;
    /** S'abonne aux requêtes de toggle (raccourci global Ctrl+Shift+Space). */
    onToggle: (cb: () => void) => () => void;
    /** S'abonne aux requêtes de collapse (blur de la fenêtre). */
    onRequestCollapse: (cb: () => void) => () => void;
    /**
     * S'abonne au passage en mode fullscreen d'une app sur l'écran
     * principal. true = quelque chose est fullscreen, false = retour normal.
     */
    onFullscreenChange: (cb: (fullscreen: boolean) => void) => () => void;
    /**
     * Demande au main process de quitter l'application. Déclenche le flux
     * `before-quit` + `window-all-closed` normal — pas de retour côté
     * renderer car l'app est en train de mourir.
     */
    quit: () => void;
  };
  search: {
    /** Renvoie les workspaces VS Code récents (lu depuis state.vscdb). */
    listVsCode: () => Promise<SearchResult[]>;
    /** Renvoie les solutions Visual Studio scannées (cache 60 s). */
    listVs: () => Promise<SearchResult[]>;
    /** Ouvre un workspace VS Code (CLI `code`). */
    openVsCode: (path: string, kind: SearchResult['kind']) => Promise<{ ok: boolean; error?: string }>;
    /** Ouvre une solution Visual Studio (association de fichier .sln/.slnx). */
    openVs: (path: string) => Promise<{ ok: boolean; error?: string }>;
  };
  claude: {
    /** Liste agrégée des sessions Claude Code actuellement détectées. */
    list: () => Promise<ClaudeSession[]>;
    /** S'abonne au push de la liste de sessions (file watcher). */
    onChange: (cb: (sessions: ClaudeSession[]) => void) => () => void;
  };
  updater: {
    /** Snapshot complet de l'état d'update (status, versions, progression). */
    getState: () => Promise<UpdateState>;
    /** Déclenche un check immédiat. La réponse arrive via `onChange`. */
    checkNow: () => Promise<UpdateState>;
    /**
     * Lance le download de la version détectée (à appeler uniquement
     * quand `status === 'available'`). La progression arrive via `onChange`.
     */
    download: () => Promise<{ ok: boolean; error?: string }>;
    /**
     * Quitte WinNotch et installe l'update téléchargée (à appeler uniquement
     * quand `status === 'downloaded'`). L'app sera redémarrée par le
     * setup NSIS.
     */
    quitAndInstall: () => Promise<{ ok: boolean; error?: string }>;
    /** S'abonne aux changements d'UpdateState. */
    onChange: (cb: (state: UpdateState) => void) => () => void;
  };
  gitlab: {
    /** Snapshot complet de l'état GitLab (MR + profil + erreur). */
    getState: () => Promise<GitLabState>;
    /**
     * Valide une paire (URL, PAT) auprès de l'instance GitLab en
     * appelant `GET /user`. Ne modifie pas le store. Retourne le profil
     * en cas de succès — utilisé par le bouton "Tester la connexion".
     */
    testConnection: (
      url: string,
      token: string,
    ) => Promise<{ ok: boolean; user?: GitLabUser; error?: string }>;
    /**
     * Persiste l'URL et chiffre le PAT (safeStorage). En cas de succès
     * déclenche un fetch immédiat des MR. Échoue si l'URL/PAT est invalide.
     */
    saveCredentials: (
      url: string,
      token: string,
    ) => Promise<{ ok: boolean; error?: string }>;
    /** Supprime URL + PAT chiffré + reset le cache GitLabState. */
    clearCredentials: () => Promise<void>;
    /** Force un refresh immédiat. Le main pousse aussi un GitLabChange. */
    refresh: () => Promise<GitLabState>;
    /** S'abonne au push de GitLabState (polling). */
    onChange: (cb: (state: GitLabState) => void) => () => void;
  };
  gitlocal: {
    /** Snapshot complet de l'état Git local (repos détectés + erreurs). */
    getState: () => Promise<GitLocalState>;
    /** Force un rescan + collecte des statuts. */
    refresh: () => Promise<GitLocalState>;
    /**
     * Ouvre un repo. Détecte `*.sln`/`*.slnx` à la racine → Visual Studio
     * (association de fichier Windows). Sinon → VS Code (`code -n`).
     * `via` indique quel chemin a été emprunté (utile pour debug / toast).
     */
    openRepo: (
      path: string,
    ) => Promise<{ ok: boolean; via?: 'sln' | 'vscode'; error?: string }>;
    /** S'abonne au push de GitLocalState (polling ou refresh). */
    onChange: (cb: (state: GitLocalState) => void) => () => void;
  };
  meetings: {
    /**
     * Démarre le flow OAuth pour le provider donné. Le main process
     * ouvre le navigateur, lance un loopback HTTP server, échange le
     * code contre des tokens et persiste un nouveau CalendarAccount.
     */
    connect: (
      provider: CalendarProviderId,
    ) => Promise<{ ok: boolean; account?: CalendarAccount; error?: string }>;
    /** Déconnecte un compte et supprime ses tokens. */
    disconnect: (accountId: string) => Promise<{ ok: boolean }>;
    /** Liste agrégée des prochains meetings (cache main). */
    list: () => Promise<Meeting[]>;
    /** Force un refresh immédiat. */
    refresh: () => Promise<Meeting[]>;
    /**
     * Indique pour chaque provider si l'app a des credentials embarqués
     * au build (.env.local). Permet à l'UI Settings de masquer la
     * section "Saisir Client ID" quand les defaults sont en place.
     */
    hasDefaults: () => Promise<Record<CalendarProviderId, boolean>>;
    /** S'abonne au push de la liste de meetings (polling 5 min). */
    onChange: (cb: (meetings: Meeting[]) => void) => () => void;
  };
  clipboard: {
    /** Snapshot complet de l'historique du presse-papier. */
    getState: () => Promise<ClipboardState>;
    /** Épingle une entrée (la sort de la limite maxItems). */
    pin: (id: string) => Promise<ClipboardState>;
    /** Retire l'épingle. L'entrée peut alors être évincée si > maxItems. */
    unpin: (id: string) => Promise<ClipboardState>;
    /**
     * Recopie le contenu de l'entrée dans le presse-papier système. Ne
     * crée pas de nouvelle entrée (le watcher détecte sa propre écriture
     * et l'ignore via `pendingSelfWrite`).
     */
    copyAgain: (id: string) => Promise<ClipboardState>;
    /** Supprime une entrée (et son PNG si type=image). */
    remove: (id: string) => Promise<ClipboardState>;
    /**
     * Vide l'historique. Si `keepPinned === true`, conserve les épinglées.
     */
    clear: (keepPinned: boolean) => Promise<ClipboardState>;
    /** Met `lastSeenAt = Date.now()`. Efface le badge "non vu" sur la chip. */
    markSeen: () => Promise<ClipboardState>;
    /**
     * Récupère titre + favicon pour une entrée URL. Retourne `null` si
     * unfurl désactivé en settings, si l'entrée n'existe pas / n'est pas
     * une URL, ou si la requête a échoué.
     */
    unfurl: (id: string) => Promise<UrlUnfurl | null>;
    /**
     * Ouvre un dialog de sauvegarde du PNG d'une entrée image. Retourne
     * `{ ok: false }` si annulé par l'utilisateur ou si l'entrée n'est
     * pas une image.
     */
    saveImage: (id: string) => Promise<{ ok: boolean; error?: string }>;
    /**
     * Retourne le PNG d'une entrée image en data URL pour affichage
     * direct dans <img src>. `null` si l'entrée n'existe pas / n'est
     * pas une image / fichier perdu.
     */
    getImageDataUrl: (id: string) => Promise<string | null>;
    /**
     * Ouvre l'Explorer sur un chemin Windows détecté. Retourne
     * `{ ok: false }` si le chemin n'existe pas.
     */
    openPath: (id: string) => Promise<{ ok: boolean; error?: string }>;
    /** S'abonne au push de ClipboardState. */
    onChange: (cb: (state: ClipboardState) => void) => () => void;
    /**
     * S'abonne à la demande d'affichage de la card avec focus sur la
     * recherche (raccourci global Ctrl+Shift+V).
     */
    onFocusCard: (cb: () => void) => () => void;
  };
  audio: {
    getState: () => Promise<AudioState>;
    setVolume: (level: number) => Promise<AudioState>;
    setMuted: (muted: boolean) => Promise<AudioState>;
    setDevice: (id: string) => Promise<AudioState>;
    /** S'abonne au push d'AudioState. Retourne une fonction de désabonnement. */
    onChange: (cb: (state: AudioState) => void) => () => void;
  };
  music: {
    getState: () => Promise<MusicState>;
    playPause: () => Promise<MusicState>;
    next: () => Promise<MusicState>;
    previous: () => Promise<MusicState>;
    /** S'abonne au push de MusicState. Retourne une fonction de désabonnement. */
    onChange: (cb: (state: MusicState) => void) => () => void;
  };
  settings: {
    getAll: () => Promise<Settings>;
    toggleDnd: () => Promise<Settings>;
    addTask: (text: string) => Promise<Settings>;
    toggleTask: (id: string) => Promise<Settings>;
    removeTask: (id: string) => Promise<Settings>;
    clearDoneTasks: () => Promise<Settings>;
    /** Active ou désactive un module (Music, Tasks, etc.). */
    setModule: (id: ModuleId, enabled: boolean) => Promise<Settings>;
    /** Règle la densité visuelle globale du dashboard. */
    setDensity: (density: Density) => Promise<Settings>;
    /** Patch partiel d'une moduleConfig (merge superficiel côté main). */
    patchModuleConfig: <K extends ModuleId>(
      id: K,
      patch: Partial<ModuleConfig[K]>,
    ) => Promise<Settings>;
    /**
     * Active/désactive le démarrage automatique de WinNotch avec Windows.
     * Implémenté via `app.setLoginItemSettings` (écrit dans
     * `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`).
     */
    setAutoStart: (enabled: boolean) => Promise<Settings>;
    /**
     * Remplace l'ordre + la largeur des tuiles du dashboard. Le main
     * valide chaque entrée (cols 1..12, id ∈ DashTileId, pas de doublon)
     * avant persistance ; en cas de payload invalide, retourne l'état
     * inchangé.
     */
    setDashboardLayout: (layout: DashTile[]) => Promise<Settings>;
    /** S'abonne aux changements de Settings (ex. toggle DND via raccourci global). */
    onChange: (cb: (state: Settings) => void) => () => void;
  };
}
