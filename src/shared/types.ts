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

/* ───────────── Bambu (imprimante 3D, MQTT LAN) ───────────── */

/**
 * État de la connexion MQTT à l'imprimante.
 *  - `idle`       : module activé mais pas (encore) configuré.
 *  - `connecting` : tentative de connexion / reconnexion en cours.
 *  - `connected`  : abonné au topic report, on reçoit (ou attend) des données.
 *  - `offline`    : connexion perdue (imprimante éteinte / hors réseau).
 *  - `error`      : échec persistant (auth refusée, host injoignable…).
 */
export type BambuConnection =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'offline'
  | 'error';

/**
 * État du gcode tel que rapporté par l'imprimante (`print.gcode_state`).
 * `Unknown` couvre l'absence de donnée (avant le premier rapport complet).
 */
export type BambuGcodeState =
  | 'IDLE'
  | 'PREPARE'
  | 'RUNNING'
  | 'PAUSE'
  | 'FINISH'
  | 'FAILED'
  | 'Unknown';

/** Une bobine (tray) d'un AMS, dérivée de `print.ams.ams[].tray[]`. */
export interface BambuAmsTray {
  /** Index 0-based du slot dans l'AMS. */
  slot: number;
  /** Couleur du filament au format CSS `#RRGGBB` (alpha tronqué). */
  colorHex: string;
  /** Type de filament (`PLA`, `PETG`, `ABS`…). Vide si inconnu. */
  type: string;
  /** Pourcentage restant estimé [0..100], ou `null` si l'AMS ne le sait pas. */
  remainPercent: number | null;
  /** `true` si c'est le tray actuellement chargé (`ams.tray_now`). */
  active: boolean;
}

/** Une entrée du Health Management System (`print.hms[]`). */
export interface BambuHmsEntry {
  /** Code humain formaté (ex. `0300_0100_0002_0001`). */
  code: string;
  /** Sévérité décodée depuis les bits de poids fort de `attr`/`code`. */
  level: 'fatal' | 'serious' | 'common' | 'info' | 'unknown';
  /** URL de la page wiki Bambu correspondant au code. */
  wikiUrl: string;
}

/** Snapshot complet de l'état imprimante exposé au renderer. */
export interface BambuState {
  /** État de la connexion MQTT. */
  connection: BambuConnection;
  /** Message d'erreur lisible (null si pas d'erreur). */
  error: string | null;
  /** `true` dès qu'un host est configuré (sinon : prompt d'onboarding). */
  configured: boolean;
  /**
   * `true` si l'imprimante elle-même est joignable (des rapports arrivent).
   * En mode cloud, `connection === 'connected'` ne signifie que « broker
   * cloud joignable » : l'imprimante peut être éteinte/en veille. Ce flag
   * distingue les deux (passe à `false` si aucun rapport n'arrive).
   */
  printerOnline: boolean;
  /** Nom convivial de l'imprimante (saisi par l'utilisateur). Vide sinon. */
  printerName: string;
  /** État du gcode courant. */
  gcodeState: BambuGcodeState;
  /** `true` si un print est en cours (RUNNING / PAUSE / PREPARE). */
  isPrinting: boolean;
  /** Progression [0..100]. */
  progressPercent: number;
  /** Temps restant estimé en minutes (null si inconnu). */
  remainingMin: number | null;
  /** Layer courant / total (null si inconnu). */
  layerCur: number | null;
  layerTotal: number | null;
  /** Nom du fichier en cours d'impression. */
  fileName: string;
  /** Niveau de vitesse : 1 silent / 2 standard / 3 sport / 4 ludicrous. */
  speedLevel: number | null;
  /** Températures buse / lit (courante + cible) en °C. */
  nozzleTemp: number | null;
  nozzleTarget: number | null;
  bedTemp: number | null;
  bedTarget: number | null;
  /** Trays AMS (vide si pas d'AMS). */
  amsTrays: BambuAmsTray[];
  /** Erreurs HMS actives. */
  hms: BambuHmsEntry[];
  /** Timestamp (ms) du dernier rapport reçu, ou 0. */
  lastUpdateAt: number;
}

/** Une imprimante liée au compte Bambu (réponse `bind` du cloud). */
export interface BambuCloudDevice {
  /** Numéro de série (= `dev_id`), sert au topic MQTT. */
  serial: string;
  /** Nom convivial défini dans l'app Bambu. */
  name: string;
  /** `true` si l'imprimante est en ligne côté cloud. */
  online: boolean;
}

/** Résultat d'une étape de login cloud renvoyé au renderer. */
export interface BambuCloudLoginResult {
  ok: boolean;
  /** `true` si un code de vérification email est requis (2FA). */
  needCode?: boolean;
  /** Imprimantes liées au compte (après login réussi). */
  devices?: BambuCloudDevice[];
  error?: string;
}

/**
 * Identifiants des modules que l'utilisateur peut activer/désactiver
 * depuis les réglages. Note : `audio` n'est pas dans la liste car il est
 * implicite (toujours actif — le footer audio est toujours rendu).
 *
 * **Convention dot-notation** : un identifiant peut être plat (`'audio'`,
 * `'music'`…) ou hiérarchique `'<groupId>.<subId>'` (ex. `'claude.live'`,
 * `'claude.usage'`). La partie avant le point désigne une **famille** de
 * modules regroupés visuellement dans Settings → Modules. Voir
 * `parseModuleId` ci-dessous et `moduleGroupsMeta.ts` côté renderer.
 */
export type ModuleId =
  | 'music'
  | 'meetings'
  | 'gitlab'
  | 'gitlocal'
  | 'claude.live'
  | 'claude.usage'
  | 'tasks'
  | 'clipboard'
  | 'vpn'
  | 'teams'
  | 'system'
  | 'bambu';

/**
 * Identifiant d'une famille (groupe) de modules. Une famille regroupe
 * dans Settings plusieurs sous-modules logiquement liés, chacun avec son
 * propre toggle et sa propre config. Le rendu visuel est piloté par
 * `MODULE_GROUPS` côté renderer.
 */
export type ModuleGroupId = 'claude';

/** Décomposition d'un `ModuleId` éventuellement hiérarchique. */
export interface ParsedModuleId {
  group: ModuleGroupId | null;
  sub: string;
}

/**
 * Décompose un `ModuleId` en `{ group, sub }`. Les IDs plats (ex. `'audio'`)
 * sortent avec `group: null` et `sub` égal à l'ID complet. Les IDs en
 * `'<group>.<sub>'` sont scindés sur le premier `.`.
 */
export function parseModuleId(id: ModuleId): ParsedModuleId {
  const dot = id.indexOf('.');
  if (dot === -1) return { group: null, sub: id };
  return {
    group: id.slice(0, dot) as ModuleGroupId,
    sub: id.slice(dot + 1),
  };
}

/** Densité visuelle du dashboard étendu. */
export type Density = 'dense' | 'normal' | 'airy';

/**
 * Identifiants des modules qui rendent une tuile dans le dashboard étendu.
 * Sous-ensemble strict de `ModuleId` : `clipboard` n'a pas de card (page
 * plein dashboard à la place, ouverte via bouton ou Ctrl+Shift+V).
 */
export type DashTileId =
  | 'music'
  | 'meetings'
  | 'gitlab'
  | 'gitlocal'
  | 'claude.live'
  | 'claude.usage'
  | 'tasks'
  | 'vpn'
  | 'teams'
  | 'system'
  | 'bambu';

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
 * Configuration spécifique à chaque module. Chaque module câblé déclare
 * ici sa structure de réglages persistés.
 */
export interface ModuleConfig {
  music: {
    /** Masque la chip et la card quand aucune lecture n'est détectée. */
    hideWhenStopped: boolean;
    /** Afficher la chip dans le notch collapsed (vs. expanded only). */
    collapsed: boolean;
    /** Afficher la card dans le dashboard étendu. */
    showCard: boolean;
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
    /** Afficher la card dans le dashboard étendu. */
    showCard: boolean;
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
     * Fréquence de polling en millisecondes. Minimum 15 000 ms pour ne pas
     * saturer le disque ; défaut 60 000 ms.
     */
    pollMs: number;
    /**
     * Afficher la chip dans le notch rétracté quand au moins un repo est
     * "dirty" (uncommitted > 0 OU ahead > 0).
     */
    collapsed: boolean;
    /** Afficher la card dans le dashboard étendu. */
    showCard: boolean;
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
    /** Fréquence de polling en millisecondes (défaut 120 000 ms). */
    pollMs: number;
    collapsed: boolean;
    /** Afficher la card dans le dashboard étendu. */
    showCard: boolean;
  };
  'claude.live': {
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
  'claude.usage': {
    /**
     * Fréquence de polling en millisecondes. Le statusline et le fichier
     * cache `~/.claude/winnotch-usage.json` sont relus à chaque tick.
     * Borne [10 000, 300 000] ms, défaut 30 000 ms.
     */
    pollMs: number;
    /**
     * Tier d'abonnement Claude saisi manuellement par l'utilisateur. Sert
     * uniquement à afficher les valeurs absolues (messages restants) à
     * partir du `%` retourné par le statusline. `unknown` → seuls les
     * pourcentages sont montrés.
     */
    plan: ClaudeUsagePlan;
    /**
     * Pourcentages déclencheurs des toasts d'alerte. Toast émis à chaque
     * transition `% < seuil → % ≥ seuil`, indépendamment pour la fenêtre
     * 5 h et la fenêtre hebdomadaire.
     */
    thresholdsPct: number[];
    /** Active l'émission des toasts de seuil. */
    notifyThresholds: boolean;
    /** Affiche la card dans le dashboard étendu. */
    showCard: boolean;
  };
  tasks: {
    /** Auto-supprime les tâches done plus vieilles que N jours. 0 = jamais. */
    autoClearDays: number;
    /** Critère de tri par défaut. */
    sortBy: 'created' | 'alpha';
    collapsed: boolean;
    /** Afficher la card compteur dans le dashboard étendu. */
    showCard: boolean;
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
  vpn: {
    /**
     * Fréquence de polling en millisecondes. Minimum 5 000 ms — un appel
     * PowerShell coûte ~150 ms, on peut descendre bas sans saturer.
     * Défaut 10 000 ms.
     */
    pollMs: number;
    /**
     * Récupère le pays de l'IP du peer/serveur via `ipapi.co` (lookup
     * caché 6 h par IP). Désactivable pour rester offline-only.
     */
    lookupCountry: boolean;
    /**
     * Affiche la chip même quand aucune connexion VPN n'est active (gris).
     * Par défaut la chip disparaît quand déconnecté pour rester discrète.
     */
    showWhenDisconnected: boolean;
    /** Afficher la chip dans le notch rétracté quand une connexion est active. */
    collapsed: boolean;
    /** Afficher la card dans le dashboard étendu. */
    showCard: boolean;
  };
  teams: {
    /**
     * Fréquence de polling Graph `GET /me/presence` en millisecondes.
     * Minimum 15 000 ms — Graph throttle à ~1500 req / 30 s par app, on
     * est largement sous. Défaut 30 000 ms.
     */
    pollMs: number;
    /**
     * `accountId` du `CalendarAccount` Outlook utilisé pour Teams Presence.
     * `null` = fallback automatique sur le premier compte Outlook trouvé.
     * Permet à l'utilisateur de choisir explicitement quand plusieurs
     * comptes Outlook sont connectés (Settings → Teams).
     */
    outlookAccountId: string | null;
    /**
     * Si `true`, le toggle DND WinNotch et le statut Teams DoNotDisturb
     * se synchronisent bidirectionnellement : `Ctrl+Shift+D` → set Teams
     * DoNotDisturb ; et inversement, un Teams DoNotDisturb détecté par
     * le polling active le DND WinNotch. Décocher rend Teams Presence
     * purement manuel (boutons de la card + bascules Teams isolées).
     */
    dndCouplingEnabled: boolean;
    /** Afficher la chip dans le notch rétracté. */
    collapsed: boolean;
    /** Afficher la card dans le dashboard étendu. */
    showCard: boolean;
  };
  system: {
    /**
     * Fréquence d'échantillonnage en millisecondes. 1 000 ms par défaut
     * pour un sparkline temps réel ; minimum 500 ms (au-delà la lecture
     * `os.cpus()` perd en stabilité), maximum 5 000 ms (~2 % CPU machine
     * et sparkline trop lent).
     */
    pollMs: number;
    /**
     * Métrique affichée dans la chip du notch rétracté : `cpu` (défaut),
     * `ram`, ou `net`. La card étendue affiche toujours les 3 jauges
     * indépendamment de ce choix.
     */
    primaryMetric: SystemMetricKey;
    /**
     * Liste blanche des interfaces réseau à agréger pour la métrique NET
     * (noms d'adaptateur Windows). `null` = auto (toutes les interfaces
     * `Up` hors loopback, vEthernet, WSL, Bluetooth PAN, Pseudo-Interface).
     */
    netInterfaces: string[] | null;
    /** Afficher la chip dans le notch rétracté. */
    collapsed: boolean;
    /** Afficher la card dans le dashboard étendu. */
    showCard: boolean;
  };
  bambu: {
    /**
     * Mode de connexion :
     *  - `lan`   : MQTT direct à l'imprimante sur le réseau local (rapide,
     *    privé, mais PC + imprimante doivent être sur le même réseau).
     *  - `cloud` : MQTT via le broker cloud Bambu (suivi à distance depuis
     *    n'importe quel réseau ; nécessite un compte Bambu).
     */
    mode: 'lan' | 'cloud';
    /** Région du cloud Bambu (`global` = Europe/US, `china`). */
    region: 'global' | 'china';
    /** IP (ou hostname) de l'imprimante sur le LAN. Vide tant que non configuré. */
    host: string;
    /**
     * Numéro de série de l'imprimante — compose le topic MQTT
     * `device/<serial>/report`. Indispensable (LAN comme cloud).
     */
    serial: string;
    /**
     * Code d'accès LAN (8 chiffres) chiffré via Electron `safeStorage`
     * (DPAPI sous Windows) puis encodé en base64. `null` tant qu'aucun
     * code valide n'a été enregistré. Le code brut ne quitte jamais le main.
     */
    encryptedAccessCode: string | null;
    /** Email du compte Bambu (mode cloud) — affichage seul, non secret. */
    email: string;
    /**
     * Bundle d'auth cloud `{ accessToken, refreshToken, expiresAt, username }`
     * chiffré via `safeStorage` puis base64. `null` tant que non connecté.
     * Le mot de passe du compte n'est JAMAIS persisté (login HTTP transitoire).
     */
    cloudAuthEnc: string | null;
    /** Nom convivial de l'imprimante (saisi en LAN ; nom Bambu en cloud). */
    printerName: string;
    /** Nom de l'imprimante cloud sélectionnée (depuis la liste `bind`). */
    deviceName: string;
    /** Afficher la chip dans le notch rétracté pendant un print. */
    collapsed: boolean;
    /**
     * Garder la chip visible hors impression (état connexion). Par défaut
     * la chip n'apparaît que pendant un print pour rester discrète.
     */
    showWhenIdle: boolean;
    /** Afficher la card dans le dashboard étendu. */
    showCard: boolean;
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
   * Si `true`, WinNotch démarre automatiquement avec Windows, via une tâche
   * planifiée `WinNotch` (Task Scheduler, créée par `schtasks.exe`).
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

/**
 * Résultat d'un appel `settings.setAutoStart`. Porte l'état persisté à jour
 * (`settings`) ET le statut de l'opération système (création/suppression de la
 * tâche planifiée) pour permettre au renderer d'afficher un toast de réussite
 * ou d'échec. `ok: false` n'est jamais une exception — le détail est dans
 * `error`.
 */
export interface SetAutoStartResult {
  settings: Settings;
  ok: boolean;
  /** Message d'erreur si l'opération système a échoué (sinon undefined). */
  error?: string;
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
    'claude.live': true,
    'claude.usage': true,
    tasks: true,
    clipboard: true,
    vpn: true,
    teams: true,
    system: true,
    // Désactivé par défaut : requiert une configuration (IP + serial + code
    // d'accès LAN) avant de pouvoir se connecter. On n'active pas un module
    // qui afficherait un état « non configuré » d'office.
    bambu: false,
  },
  moduleConfig: {
    music: {
      hideWhenStopped: true,
      collapsed: true,
      showCard: true,
    },
    meetings: {
      imminentMin: 5,
      hideJoinedToday: false,
      maxUpcoming: 5,
      accounts: [],
      clientCredentials: { outlook: null, google: null },
      collapsed: true,
      showCard: true,
    },
    gitlab: {
      url: '',
      encryptedToken: null,
      account: null,
      notify: { mr: true, pipelines: false, comments: false, watchedIssues: true },
      watchedLabels: [],
      assignedOnly: false,
      pollMs: 120_000,
      collapsed: true,
      showCard: true,
    },
    gitlocal: {
      rootDirs: [],
      scanDepth: 3,
      ignorePatterns: ['node_modules', 'dist', 'out', 'bin', 'obj', '.next', '.vs'],
      pollMs: 60_000,
      collapsed: true,
      showCard: true,
    },
    'claude.live': {
      notifyCompletion: true,
      notifyError: true,
      workspaces: [],
      showCard: true,
      collapsed: true,
    },
    'claude.usage': {
      pollMs: 30_000,
      plan: 'unknown',
      thresholdsPct: [70, 85, 95],
      notifyThresholds: true,
      showCard: true,
    },
    tasks: {
      autoClearDays: 0,
      sortBy: 'created',
      collapsed: true,
      showCard: true,
    },
    clipboard: {
      maxItems: 50,
      collapsed: true,
      enableUnfurl: true,
      maskSensitive: true,
    },
    vpn: {
      pollMs: 10_000,
      lookupCountry: true,
      showWhenDisconnected: false,
      collapsed: true,
      showCard: true,
    },
    teams: {
      pollMs: 30_000,
      outlookAccountId: null,
      dndCouplingEnabled: true,
      collapsed: true,
      showCard: true,
    },
    system: {
      pollMs: 1000,
      primaryMetric: 'cpu',
      netInterfaces: null,
      collapsed: true,
      showCard: true,
    },
    bambu: {
      mode: 'lan',
      region: 'global',
      host: '',
      serial: '',
      encryptedAccessCode: null,
      email: '',
      cloudAuthEnc: null,
      printerName: '',
      deviceName: '',
      collapsed: true,
      showWhenIdle: false,
      showCard: true,
    },
  },
  // Layout par défaut — reproduit l'agencement historique :
  //   ┌── tasks (4) ─┬─── meetings (8) ───┐
  //   ├──────── music (12) ────────────────┤
  //   ├── gitlab (6) ─┬── claude.live (6) ─┤
  //   ├── gitlocal (8) ─┬─ claude.usage(4)─┤
  //   └──── vpn (4) ─┬── teams (4) ───────┤
  //   └──────── system (12) ──────────────┘
  // L'utilisateur peut réordonner et redimensionner via Settings → Disposition.
  dashboardLayout: [
    { id: 'tasks', cols: 4 },
    { id: 'meetings', cols: 8 },
    { id: 'music', cols: 12 },
    { id: 'gitlab', cols: 6 },
    { id: 'claude.live', cols: 6 },
    { id: 'gitlocal', cols: 8 },
    { id: 'claude.usage', cols: 4 },
    { id: 'vpn', cols: 4 },
    { id: 'teams', cols: 4 },
    { id: 'system', cols: 12 },
    { id: 'bambu', cols: 6 },
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
  /**
   * True si le dernier event assistant porte `stop_reason === 'end_turn'`.
   * Persisté au parse pour que le recalcul périodique du statut (transition
   * working → waiting → idle → done, cf. `computeStatus`) se fasse en pure
   * mémoire depuis le mtime connu, sans relire le fichier (audit perf P4 —
   * `slowTick` re-parsait tous les .jsonl du cache toutes les 5 s).
   */
  endedTurn: boolean;
}

/* ─────────────────────────────────────────────────────────────────────
 *  CLAUDE USAGE (quotas Pro / Max)
 * ─────────────────────────────────────────────────────────────────── */

/**
 * Tier d'abonnement Claude saisi manuellement par l'utilisateur.
 * Sert à dériver les valeurs absolues (messages restants) à partir des
 * pourcentages remontés par le statusline. `unknown` masque les valeurs
 * absolues et n'affiche que les pourcentages.
 *
 * Les plans équipe sont fusionnés avec les plans perso de même niveau
 * (mêmes nominaux par seat) :
 *  - `pro`    couvre **Pro** (perso) ET **Team** (Standard, ≈ Pro par seat)
 *  - `max5x`  couvre **Max 5×** ET **Team+** (Premium, ≈ Max 5× par seat)
 *  - `max20x` reste perso (pas d'équivalent équipe)
 */
export type ClaudeUsagePlan = 'pro' | 'max5x' | 'max20x' | 'unknown';

/**
 * Source d'une mesure d'usage. `statusline` est la source autoritaire
 * (lue depuis `~/.claude/winnotch-usage.json` alimenté par le statusline
 * WinNotch). `estimated` est le fallback calculé localement par parsing
 * des `.jsonl` dans `~/.claude/projects/`.
 */
export type ClaudeUsageSource = 'statusline' | 'estimated';

/** Une fenêtre d'usage (5h glissante OU 7j glissante). */
export interface ClaudeUsageWindow {
  /** Pourcentage consommé sur la fenêtre, dans [0, 100]. */
  percent: number;
  /** Timestamp Unix (ms) auquel la fenêtre se reset (rolling window). */
  resetsAt: number;
  source: ClaudeUsageSource;
}

/**
 * État courant du module `claude.usage`. Émis par le service main à chaque
 * tick de polling. Le ring buffer `sparkline` est persisté en local pour
 * survivre aux redémarrages.
 */
export interface ClaudeUsageState {
  fiveH: ClaudeUsageWindow;
  weekly: ClaudeUsageWindow;
  /**
   * Ring buffer de 288 points (1 toutes les 5 min × 24 h). Chaque point
   * est le `percent` 5h enregistré à ce tick. Utilisé pour la mini-spark
   * dans la card étendue.
   */
  sparkline: number[];
  /** Tier saisi par l'utilisateur dans Settings → Claude → Limites d'usage. */
  plan: ClaudeUsagePlan;
  /** True si le wrapper statusline WinNotch est installé dans `~/.claude/settings.json`. */
  statuslineInstalled: boolean;
  /** True si `~/.claude/` est détecté (Claude Code installé). */
  claudeInstalled: boolean;
  /** Timestamp Unix (ms) du dernier tick réussi. */
  lastSyncAt: number;
  /** Dernier message d'erreur rencontré (null = OK). */
  lastError: string | null;
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
 *  VPN
 * ─────────────────────────────────────────────────────────────────── */

/**
 * Client VPN identifié. `windows-native` couvre les connexions VPN
 * configurées dans Windows (PPTP/L2TP/SSTP/IKEv2), `unknown` est utilisé
 * quand on détecte une interface VPN active sans pouvoir l'attribuer à un
 * client connu.
 */
export type VpnClient =
  | 'protonvpn'
  | 'nordvpn'
  | 'openvpn'
  | 'wireguard'
  | 'fortinet'
  | 'windows-native'
  | 'unknown';

/**
 * Une connexion VPN active détectée sur la machine. Plusieurs peuvent
 * coexister (multi-tunnel WireGuard, OpenVPN + Proton, etc.).
 *
 * `connectionName` et `serverAddress` sont best-effort : Proton/Nord
 * exposent rarement le serveur précis sans plugin propriétaire, alors que
 * WireGuard, OpenVPN et le VPN Windows natif sont fiables.
 *
 * `connectedSince` est initialisé à `Date.now()` quand la connexion passe
 * de `disconnected` à `connected`. Si WinNotch démarre alors qu'une
 * connexion VPN est déjà active, le timestamp vaut l'heure du premier
 * tick — l'UI affiche alors « connecté » sans durée pour ne pas mentir.
 */
export interface VpnConnection {
  /** Client identifié via le nom de l'interface + scan de processus. */
  client: VpnClient;
  /** Nom Windows de l'adaptateur réseau (clé unique pour le dédup). */
  interfaceName: string;
  /** Nom logique de la connexion (config OpenVPN, tunnel WG, nom Windows VPN). */
  connectionName?: string;
  /** IP ou hostname de l'endpoint si exposé par le client. */
  serverAddress?: string;
  /** Pays résolu en async via `countryLookup` (cache 6 h). */
  country?: string;
  /** Unix ms du passage `disconnected → connected` (best-effort au boot). */
  connectedSince: number;
  /**
   * True quand `connectedSince` correspond au démarrage de WinNotch et
   * non à la connexion réelle (cas du VPN déjà actif au lancement de
   * l'app). L'UI utilise ce flag pour masquer la durée et éviter une
   * valeur trompeuse.
   */
  connectedSinceIsApprox: boolean;
}

/**
 * Snapshot complet exposé au renderer via `vpn:getState` + push
 * `vpn:change`.
 */
export interface VpnState {
  /** True si au moins une connexion VPN active a été détectée. */
  connected: boolean;
  /** Connexions actives. Dédupliquées par `interfaceName`. */
  connections: VpnConnection[];
  /** Unix ms du dernier tick de polling terminé. 0 tant qu'aucun tick n'a fini. */
  lastCheckAt: number;
  /**
   * Erreur globale du dernier tick (PowerShell introuvable, timeout, etc.).
   * `null` quand le dernier tick s'est bien passé.
   */
  lastError: string | null;
}

/* ─────────────────────────────────────────────────────────────────────
 *  SYSTEM (CPU / RAM / Network live)
 * ─────────────────────────────────────────────────────────────────── */

/**
 * Métrique affichée dans la chip du notch rétracté. La card étendue
 * affiche toujours les 3 jauges indépendamment de ce choix.
 */
export type SystemMetricKey = 'cpu' | 'ram' | 'net';

/**
 * Série historique pour le sparkline du chip. `points` est une fenêtre
 * coulissante des dernières secondes ; sa longueur est fixée à 60 (voir
 * `SYSTEM_HISTORY_LENGTH` côté main). `points[0]` est l'échantillon le
 * plus ancien, `points[length - 1]` le plus récent.
 */
export interface SystemMetricSeries {
  /** Valeur courante. Unité dépendante de la métrique (% pour cpu/ram, bytes/s pour net). */
  value: number;
  /** Fenêtre coulissante des N dernières mesures. */
  history: number[];
}

/**
 * Snapshot complet exposé au renderer via `system:getState` + push
 * `system:change` à chaque tick de polling.
 */
export interface SystemState {
  /** Utilisation CPU globale, 0-100. Calculé via deux snapshots `os.cpus()` consécutifs. */
  cpu: SystemMetricSeries;
  /** Utilisation mémoire physique, 0-100. */
  ram: SystemMetricSeries & {
    /** Octets utilisés (totalmem - freemem). */
    usedBytes: number;
    /** Mémoire totale en octets. */
    totalBytes: number;
  };
  /**
   * Débit réseau total (réception + émission) en bytes/seconde. Calculé via
   * deux snapshots `Get-NetAdapterStatistics` consécutifs et le delta temps.
   */
  net: SystemMetricSeries;
  /** Uptime du système en secondes (`os.uptime()`). */
  uptimeSec: number;
  /** Unix ms du dernier tick. 0 tant qu'aucun tick n'a fini. */
  lastTickAt: number;
  /**
   * Erreur globale du dernier tick (PowerShell introuvable, timeout, etc.).
   * `null` quand le dernier tick s'est bien passé. CPU/RAM continuent
   * à fonctionner même si la lecture réseau échoue (NET reste à 0).
   */
  lastError: string | null;
}

/* ─────────────────────────────────────────────────────────────────────
 *  TEAMS PRESENCE (Microsoft Graph `/me/presence`)
 * ─────────────────────────────────────────────────────────────────── */

/**
 * Valeurs `availability` retournées par `GET /me/presence` (Graph v1.0).
 *
 *  - `Available`     : disponible
 *  - `Busy`          : occupé (réunion, appel)
 *  - `DoNotDisturb`  : ne pas déranger
 *  - `BeRightBack`   : de retour bientôt
 *  - `Away`          : absent
 *  - `Offline`       : déconnecté
 *  - `Unknown`       : pas encore lu (avant le premier polling)
 *
 * `setUserPreferredPresence` n'accepte qu'un sous-ensemble (pas
 * `Unknown`, et `Offline` est mappé à `Offline/OffWork`).
 */
export type TeamsAvailability =
  | 'Available'
  | 'Busy'
  | 'DoNotDisturb'
  | 'BeRightBack'
  | 'Away'
  | 'Offline'
  | 'Unknown';

/**
 * `activity` complémentaire à `availability`. Graph retourne des valeurs
 * comme `Available`, `InACall`, `InAConferenceCall`, `Presenting`, etc.
 * On ne valide pas en TypeScript (chaîne libre) — la card affiche la
 * valeur brute pour l'utilisateur, le filtre métier ne s'appuie que sur
 * `availability`.
 */
export type TeamsActivity = string;

/**
 * Erreurs typées du module Teams. L'UI les utilise pour afficher des
 * bannières spécifiques et choisir si on continue à poller ou pas.
 *
 *  - `no-account`  : aucun compte Outlook connecté pour servir Teams Presence
 *  - `no-scope`    : le compte Outlook n'a pas (ou plus) `Presence.ReadWrite`
 *                    → demander une reconnexion (`prompt=consent`)
 *  - `no-license`  : le compte Outlook n'a pas de licence Teams M365
 *  - `network`     : erreur HTTP transitoire, refresh token mort, etc.
 */
export type TeamsError = 'no-account' | 'no-scope' | 'no-license' | 'network';

/**
 * Snapshot complet exposé au renderer via `teams:getState` + push
 * `teams:change`.
 */
export interface TeamsState {
  availability: TeamsAvailability;
  activity: TeamsActivity;
  /** Unix ms du dernier `GET /me/presence` réussi. 0 tant qu'aucun. */
  lastSyncAt: number;
  /** True pendant un appel Graph (set/clear/get). UI = spinner. */
  loading: boolean;
  /** Erreur typée, `null` quand tout va bien. */
  error: TeamsError | null;
  /** `accountId` du `CalendarAccount` Outlook utilisé. `null` si `no-account`. */
  accountId: string | null;
  /** Email du compte Outlook utilisé. Vide si `no-account`. */
  accountEmail: string;
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
 * Calendrier disponible sur un compte (Outlook ou Google). Représente
 * un calendrier auquel l'utilisateur a accès — son calendrier perso,
 * mais aussi les calendriers partagés / d'équipe.
 *
 * Sert à laisser l'utilisateur cocher uniquement ceux dont il veut voir
 * les meetings dans WinNotch (ex. exclure le calendrier "Anniversaires"
 * ou un calendrier d'équipe spammé de RDV qui ne le concernent pas).
 */
export interface CalendarInfo {
  /** ID du calendrier côté provider (Graph: calendar.id, Google: calendarList.id). */
  id: string;
  /** Nom d'affichage. */
  name: string;
  /** Couleur hex éventuellement remontée par le provider (Google: backgroundColor). */
  color?: string;
  /** True si c'est le calendrier principal du compte. Toujours coché par défaut. */
  isPrimary?: boolean;
}

/**
 * Catégorie de couleur Outlook (lue depuis `/me/outlook/masterCategories`).
 *
 * Permet à l'utilisateur de masquer les meetings d'une catégorie donnée
 * dans WinNotch — typiquement utile quand on tagge des events "Perso"
 * dans son calendrier pro pour les exclure du résumé visuel.
 *
 * Spécifique Outlook : Google n'expose pas de catégories nommées
 * équivalentes (juste 10 `colorId` non nommés), donc on n'embarque pas
 * cette feature pour Google. Côté provider, l'interface
 * `CalendarProvider.listCategories` est optionnelle.
 */
export interface OutlookCategory {
  /** Nom de la catégorie. Sert d'identifiant (Outlook ne fournit pas d'ID stable). */
  name: string;
  /**
   * Preset de couleur Outlook (`preset0` à `preset24`, ou `none`).
   * Sert juste à afficher une pastille de couleur cohérente avec
   * l'application Outlook. Mappé en hex par l'UI.
   */
  preset?: string;
}

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
  /**
   * Cache des calendriers disponibles sur le compte. Rafraîchi
   * périodiquement (TTL côté `meetingsService`) ou à la demande via
   * `meetings:listCalendars`. Vide tant qu'on n'a pas réussi à les fetch
   * — dans ce cas on agrège quand même le calendrier "primary" pour ne
   * pas se retrouver sans aucun meeting au premier connect.
   */
  calendars?: CalendarInfo[];
  /** Timestamp Unix ms du dernier fetch de `calendars`. */
  calendarsFetchedAt?: number;
  /**
   * Liste blanche des calendriers (IDs) à inclure dans l'agrégation.
   *
   *  - `undefined` : pas encore initialisé (ex. ancien compte avant
   *    cette feature, ou nouveau compte avant le premier fetch des
   *    calendriers) → fallback : on agrège tous les calendriers connus.
   *    Cela garde la rétro-compat : les comptes existants continuent à
   *    voir tous leurs meetings sans intervention.
   *  - Tableau (même vide) : la sélection est explicite. Un calendrier
   *    nouvellement apparu côté provider n'apparaît PAS automatiquement
   *    — c'est la sémantique "inclusion" : seul ce qui est coché compte.
   */
  selectedCalendarIds?: string[];
  /**
   * Cache des catégories Outlook définies sur le compte. Outlook only —
   * reste `undefined` pour les comptes Google. Rafraîchi à la même
   * cadence que `calendars` (même TTL côté `meetingsService`).
   */
  categories?: OutlookCategory[];
  /** Timestamp Unix ms du dernier fetch de `categories`. */
  categoriesFetchedAt?: number;
  /**
   * Liste noire de **noms** de catégories Outlook à masquer après
   * l'agrégation. Sémantique d'exclusion :
   *
   *  - `undefined` ou `[]` : aucune exclusion (comportement par défaut
   *    rétro-compatible).
   *  - `["Perso", "Sport"]` : tout event dont `categories` contient au
   *    moins un de ces noms est masqué. Les events **sans** catégorie
   *    passent toujours (choix explicite — voir doc utilisateur).
   *
   * Compare sur le nom car Outlook ne fournit pas d'ID stable pour les
   * masterCategories ; renommer une catégorie côté Outlook = la sortir
   * du filtre, c'est attendu.
   */
  excludedCategories?: string[];
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
  /**
   * Catégories Outlook attachées à l'event. Outlook only (Graph renvoie
   * `categories: string[]` directement). Reste vide pour Google. Sert
   * au filtre d'exclusion utilisateur (`CalendarAccount.excludedCategories`).
   */
  categories?: string[];
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
  /** Renderer → main (invoke) : snapshot des tâches courantes. */
  TasksGetState: 'tasks:getState',
  /** Renderer → main (invoke) : ajoute une tâche, retourne la liste mise à jour. */
  TasksAdd: 'tasks:add',
  /** Renderer → main (invoke) : bascule done sur une tâche, retourne la liste. */
  TasksToggle: 'tasks:toggle',
  /** Renderer → main (invoke) : supprime une tâche, retourne la liste. */
  TasksRemove: 'tasks:remove',
  /** Renderer → main (invoke) : supprime toutes les tâches done, retourne la liste. */
  TasksClearDone: 'tasks:clearDone',
  /** Main → renderer : push d'une nouvelle liste de tâches après mutation. */
  TasksChange: 'tasks:change',
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
  /**
   * Renderer → main : hauteur souhaitée de la fenêtre (px), par **couche**.
   * Le main applique le max des couches : `notch` (hauteur visible du notch +
   * marge d'ombre) et `tooltip` (bulle rich qui déborde sous le notch en
   * collapsed, rendue en portal hors du shell). Borner la BrowserWindow à
   * cette taille — au lieu de couvrir tout l'écran — évite que la fenêtre
   * transparente désactive le compositing MPO de Windows (saccades système).
   * Une hauteur `<= 0` retire la couche (overlay fermé).
   */
  ShellSetHeight: 'shell:setHeight',
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
  /**
   * Renderer → main (invoke) : retourne les calendriers disponibles sur
   * un compte. Force un refetch côté provider (skip cache) — utilisé
   * quand l'utilisateur ouvre la section "Calendriers" dans Settings ou
   * clique sur le bouton "Rafraîchir".
   */
  MeetingsListCalendars: 'meetings:listCalendars',
  /**
   * Renderer → main (invoke) : met à jour la liste blanche des calendriers
   * sélectionnés pour un compte donné. Déclenche un refresh immédiat de
   * l'agrégation pour que le changement soit visible sans attendre le
   * prochain tick de polling.
   */
  MeetingsSetSelectedCalendars: 'meetings:setSelectedCalendars',
  /**
   * Renderer → main (invoke) : retourne les catégories Outlook
   * disponibles sur un compte. Outlook only — retourne `null` pour un
   * compte Google. Force un refetch côté provider.
   */
  MeetingsListCategories: 'meetings:listCategories',
  /**
   * Renderer → main (invoke) : met à jour la liste noire des catégories
   * Outlook à masquer pour un compte. `null` côté names = reset (plus
   * aucune exclusion). Déclenche un refresh immédiat.
   */
  MeetingsSetExcludedCategories: 'meetings:setExcludedCategories',
  /** Main → renderer : push de la nouvelle liste de meetings (polling 5 min). */
  MeetingsChange: 'meetings:change',

  /** Renderer → main (invoke) : liste les sessions Claude détectées. */
  ClaudeList: 'claude:list',
  /** Main → renderer : push de la nouvelle liste de sessions (file watcher). */
  ClaudeChange: 'claude:change',

  /** Renderer → main (invoke) : retourne l'état courant des limites Claude. */
  ClaudeUsageGetState: 'claude-usage:getState',
  /**
   * Renderer → main (invoke) : force une relecture immédiate du cache
   * statusline et du fallback `.jsonl`. Retourne le nouvel état.
   */
  ClaudeUsageRefresh: 'claude-usage:refresh',
  /**
   * Renderer → main (invoke) : installe (ou désinstalle si `enable=false`)
   * le wrapper statusline WinNotch dans `~/.claude/settings.json`. Retourne
   * `{ ok, installed, path? , error? }`.
   */
  ClaudeUsageInstallStatusline: 'claude-usage:installStatusline',
  /** Main → renderer : push d'un nouveau ClaudeUsageState (polling). */
  ClaudeUsageChange: 'claude-usage:change',

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

  /** Renderer → main (invoke) : retourne le VpnState courant. */
  VpnGetState: 'vpn:getState',
  /**
   * Renderer → main (invoke) : force un check VPN immédiat (skip
   * l'attente du tick de polling). Retourne le nouveau snapshot.
   */
  VpnRefresh: 'vpn:refresh',
  /** Main → renderer : push d'un nouveau VpnState (polling ou refresh). */
  VpnChange: 'vpn:change',

  /** Renderer → main (invoke) : retourne le TeamsState courant. */
  TeamsGetState: 'teams:getState',
  /**
   * Renderer → main (invoke) : applique un statut manuel via
   * `setUserPreferredPresence` (PT8H). `activity` doit matcher
   * `availability` (cf. table Graph). Retourne le nouveau TeamsState.
   */
  TeamsSetPresence: 'teams:setPresence',
  /**
   * Renderer → main (invoke) : retire le statut manuel via
   * `clearUserPreferredPresence` → Teams revient à son statut auto.
   */
  TeamsClearPresence: 'teams:clearPresence',
  /**
   * Renderer → main (invoke) : déclenche un re-consent OAuth du compte
   * Outlook lié à Teams Presence (force `prompt=consent`). Utilisé quand
   * `state.error === 'no-scope'` pour qu'un compte ancien ré-élève
   * ses scopes Graph (`Presence.ReadWrite`).
   */
  TeamsReconnect: 'teams:reconnect',
  /** Main → renderer : push d'un nouveau TeamsState (polling ou action). */
  TeamsChange: 'teams:change',

  /** Renderer → main (invoke) : retourne le SystemState courant. */
  SystemGetState: 'system:getState',
  /** Main → renderer : push d'un nouveau SystemState à chaque tick de polling. */
  SystemChange: 'system:change',

  /** Renderer → main (invoke) : retourne le BambuState courant. */
  BambuGetState: 'bambu:getState',
  /** Renderer → main (invoke) : teste une connexion MQTT (host+serial+code). */
  BambuTestConnection: 'bambu:testConnection',
  /** Renderer → main (invoke) : enregistre les identifiants + (re)connecte. */
  BambuSaveCredentials: 'bambu:saveCredentials',
  /** Renderer → main (invoke) : efface les identifiants + déconnecte. */
  BambuDisconnect: 'bambu:disconnect',
  /** Renderer → main (invoke) : bascule le mode lan/cloud. */
  BambuSetMode: 'bambu:setMode',
  /** Renderer → main (invoke) : login compte Bambu (cloud, mot de passe). */
  BambuCloudLogin: 'bambu:cloudLogin',
  /** Renderer → main (invoke) : demande un code de connexion par email (SSO). */
  BambuCloudRequestCode: 'bambu:cloudRequestCode',
  /** Renderer → main (invoke) : soumet le code de vérification email (2FA). */
  BambuCloudSubmitCode: 'bambu:cloudSubmitCode',
  /** Renderer → main (invoke) : sélectionne l'imprimante cloud (serial+nom). */
  BambuCloudSelectDevice: 'bambu:cloudSelectDevice',
  /** Main → renderer : push d'un nouveau BambuState (rapport MQTT ou état conn). */
  BambuChange: 'bambu:change',

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
    /**
     * Notifie le main de la hauteur souhaitée de la fenêtre (px) pour une
     * **couche** (`'notch'` par défaut, ou `'tooltip'` pour une bulle qui
     * déborde sous le notch collapsed). Le main applique le max des couches
     * et borne la BrowserWindow à cette taille (au lieu de couvrir tout
     * l'écran) pour ne plus désactiver le compositing MPO de Windows.
     * Croissance immédiate, réduction différée. `height <= 0` retire la couche.
     */
    setHeight: (height: number, layer?: string) => void;
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
  claudeUsage: {
    /** Snapshot courant des limites + ring buffer sparkline. */
    getState: () => Promise<ClaudeUsageState>;
    /** Force un refresh immédiat (skip l'attente du tick). */
    refresh: () => Promise<ClaudeUsageState>;
    /**
     * Installe (`enable: true`) ou désinstalle (`enable: false`) le wrapper
     * statusline WinNotch dans `~/.claude/settings.json`. Idempotent.
     */
    installStatusline: (
      enable: boolean,
    ) => Promise<{ ok: boolean; installed: boolean; path?: string; error?: string }>;
    /** S'abonne au push d'un nouvel état (polling). */
    onChange: (cb: (state: ClaudeUsageState) => void) => () => void;
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
  vpn: {
    /** Snapshot complet de l'état VPN (connexions actives + erreurs). */
    getState: () => Promise<VpnState>;
    /** Force un check VPN immédiat (saute l'attente du prochain tick). */
    refresh: () => Promise<VpnState>;
    /** S'abonne au push de VpnState (polling ou refresh). */
    onChange: (cb: (state: VpnState) => void) => () => void;
  };
  teams: {
    /** Snapshot complet de l'état Teams Presence (availability + activity). */
    getState: () => Promise<TeamsState>;
    /**
     * Applique un statut manuel persistant (PT8H). `activity` doit
     * correspondre à `availability` (table Graph) — sinon erreur 400.
     */
    setPresence: (
      availability: TeamsAvailability,
      activity: TeamsActivity,
    ) => Promise<TeamsState>;
    /** Retire le statut manuel → Teams revient en automatique. */
    clearPresence: () => Promise<TeamsState>;
    /**
     * Déclenche un re-consent OAuth du compte Outlook lié pour ré-élever
     * les scopes (utilisé quand `state.error === 'no-scope'`).
     * Retourne `{ ok }` ; le nouveau TeamsState arrive via `onChange`.
     */
    reconnect: () => Promise<{ ok: boolean; error?: string }>;
    /** S'abonne au push de TeamsState (polling ou action). */
    onChange: (cb: (state: TeamsState) => void) => () => void;
  };
  system: {
    /** Snapshot courant des métriques système (CPU/RAM/NET + uptime). */
    getState: () => Promise<SystemState>;
    /** S'abonne au push de SystemState à chaque tick de polling. */
    onChange: (cb: (state: SystemState) => void) => () => void;
  };
  bambu: {
    /** Snapshot complet de l'état imprimante (connexion + print + AMS + HMS). */
    getState: () => Promise<BambuState>;
    /**
     * Teste une connexion MQTT avec les identifiants fournis (sans persister).
     * Résout `{ ok }` après connexion + abonnement réussis, sinon `{ ok:false }`.
     */
    testConnection: (
      host: string,
      serial: string,
      accessCode: string,
    ) => Promise<{ ok: boolean; error?: string }>;
    /**
     * Enregistre les identifiants (code chiffré côté main) et (re)connecte.
     * `accessCode` vide ⇒ conserve le code déjà stocké (mise à jour host/serial).
     */
    saveCredentials: (
      host: string,
      serial: string,
      accessCode: string,
      printerName: string,
    ) => Promise<{ ok: boolean; error?: string }>;
    /** Efface les identifiants stockés (LAN + cloud) et coupe la connexion. */
    disconnect: () => Promise<{ ok: boolean }>;
    /** Bascule le mode de connexion (lan/cloud) et reconnecte. */
    setMode: (mode: 'lan' | 'cloud') => Promise<{ ok: boolean }>;
    /**
     * Login au compte Bambu (cloud). Si la 2FA email est active, résout
     * `{ ok:false, needCode:true }` et un code est envoyé par mail.
     */
    cloudLogin: (
      email: string,
      password: string,
      region: 'global' | 'china',
    ) => Promise<BambuCloudLoginResult>;
    /**
     * Demande l'envoi d'un code de connexion par email (login sans mot de
     * passe — compatible comptes Google / Apple).
     */
    cloudRequestCode: (
      email: string,
      region: 'global' | 'china',
    ) => Promise<{ ok: boolean; error?: string }>;
    /** Soumet le code de vérification email reçu (étape 2 de la 2FA). */
    cloudSubmitCode: (
      email: string,
      code: string,
      region: 'global' | 'china',
    ) => Promise<BambuCloudLoginResult>;
    /** Sélectionne l'imprimante cloud à suivre, passe en mode cloud, reconnecte. */
    cloudSelectDevice: (
      serial: string,
      name: string,
    ) => Promise<{ ok: boolean }>;
    /** S'abonne au push de BambuState (rapport MQTT ou changement d'état). */
    onChange: (cb: (state: BambuState) => void) => () => void;
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
    /**
     * Récupère la liste des calendriers disponibles pour un compte —
     * force un refetch côté provider et persiste le résultat sur le
     * `CalendarAccount.calendars`. Retourne `null` si le compte n'existe
     * pas, si le refresh token est mort, ou si le provider renvoie une
     * erreur.
     */
    listCalendars: (accountId: string) => Promise<CalendarInfo[] | null>;
    /**
     * Met à jour la liste blanche des calendriers à inclure dans
     * l'agrégation pour un compte. `null` côté ids = reset (revient au
     * fallback "tous les calendriers connus"). Déclenche un refresh
     * immédiat des meetings.
     */
    setSelectedCalendars: (
      accountId: string,
      ids: string[] | null,
    ) => Promise<{ ok: boolean }>;
    /**
     * Outlook uniquement. Retourne la liste des catégories de couleur
     * définies par l'utilisateur sur son compte Outlook (lue depuis
     * `/me/outlook/masterCategories`). `null` pour un compte Google
     * ou en cas d'erreur réseau.
     */
    listCategories: (accountId: string) => Promise<OutlookCategory[] | null>;
    /**
     * Met à jour la liste noire des catégories Outlook à masquer pour
     * un compte. `null` = reset (aucune exclusion). Déclenche un refresh
     * immédiat.
     */
    setExcludedCategories: (
      accountId: string,
      names: string[] | null,
    ) => Promise<{ ok: boolean }>;
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
  tasks: {
    /** Snapshot courant des tâches. */
    getState: () => Promise<Task[]>;
    /** Ajoute une tâche. Retourne la liste mise à jour. */
    add: (text: string) => Promise<Task[]>;
    /** Bascule done sur une tâche. Retourne la liste. */
    toggle: (id: string) => Promise<Task[]>;
    /** Supprime une tâche. Retourne la liste. */
    remove: (id: string) => Promise<Task[]>;
    /** Supprime toutes les tâches done. Retourne la liste. */
    clearDone: () => Promise<Task[]>;
    /** S'abonne au push de la liste de tâches après mutation. */
    onChange: (cb: (tasks: Task[]) => void) => () => void;
  };
  settings: {
    getAll: () => Promise<Settings>;
    toggleDnd: () => Promise<Settings>;
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
     * Active/désactive le démarrage automatique de WinNotch avec Windows
     * (tâche planifiée via `schtasks.exe`). Retourne le statut de l'opération
     * système (`ok`/`error`) en plus des settings, pour que le renderer puisse
     * afficher un toast de réussite/échec.
     */
    setAutoStart: (enabled: boolean) => Promise<SetAutoStartResult>;
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
