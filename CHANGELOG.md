# Changelog

Toutes les évolutions notables de WinNotch.

Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versioning [SemVer](https://semver.org/lang/fr/).

## [Unreleased]

### Performance

- **Lag système « qui s'aggrave au fil du temps » corrigé (fenêtre transparente / MPO).** Diagnostic : la fenêtre transparente always-on-top du notch perturbe le MPO (Multiplane Overlay) de Windows — DWM recompose et bascule overlay↔composition à chaque `setBounds`/repaint → micro-saccades du curseur **sans pic CPU/GPU** (fermer WinNotch supprimait le lag, alors que les compteurs GDI/USER/handles restaient normaux — ce n'était donc pas une fuite mais un coût de composition). Correctifs :
  - **Verrou d'instance unique** (`app.requestSingleInstanceLock`) : empêche deux WinNotch simultanés (autostart + lancement manuel, ou instance dev + app installée), dont les fenêtres transparentes cumulaient leur charge de composition. La 2ᵉ instance quitte et redonne le focus à la 1ʳᵉ.
  - **Moins de `setBounds`** : rectangle identique ignoré (guard d'égalité) + coalescence des raffinements de croissance à l'ouverture (1 resize au lieu de 2-4).
  - **Moins de repaints continus** : les animations des chips toujours visibles (spinners / halos Claude, GitLab, meetings, confidentialité) passent en `steps()` (~10 fps au lieu de 60) ; la Sparkline Système n'émet plus qu'1 tick sur 3 quand le notch est replié ; `will-change` permanent retiré de `.notch`.
  - **Tooltip** : plus de resize de fenêtre quand la bulle tient déjà dans la fenêtre (cas notch ouvert).
- **Fuite mémoire du cache de détails MR GitLab** — le `Map` mémoïsant les détails de MR au survol (`pipeline.ts`) n'était jamais purgé (croissance monotone sur un widget always-on jamais rechargé) ; il est désormais borné à 100 entrées avec éviction LRU douce.

### Fixed

- **GitLab — les MR déjà reviewées quittent « à reviewer »** — une MR reste dans le compteur « à reviewer » tant qu'elle est ouverte, même après avoir donné sa review (le filtre REST `reviewer_id` ne tient pas compte de l'état de reviewer). WinNotch récupère désormais cet état via une requête GraphQL (`currentUser.reviewRequestedMergeRequests`) et masque les MR dont **mon** état vaut *relue*, *approuvée* ou *changements demandés*. Robuste sur toutes les éditions (pas de dépendance à l'API d'approbations Premium) ; en cas d'indisponibilité du GraphQL, on retombe silencieusement sur la liste complète (aucune régression).

### Added

- **Confidentialité — témoin caméra / micro** *(Roadmap perso Lot B #6, sans le verrouillage rapide)* — nouveau module read-only : pastille rouge (caméra / micro + point pulsant) dans le notch rétracté quand une app utilise **actuellement** la webcam ou le micro, tooltip listant les apps. Visible même en Ne pas Déranger (signal de sécurité). 100 % local : lecture du registre `CapabilityAccessManager\ConsentStore` (HKCU) via le PowerShell résident, aucun réseau ni stockage. Activé par défaut, polling 4 s configurable. *(Le verrouillage rapide de session n'a pas été retenu.)*
- **Git local — actions sûres opt-in** *(Roadmap Lot 3 #10)* — une fois activées (Réglages → Git local → Actions Git, **désactivé par défaut**), chaque repo du panel expose **Fetch** (`git fetch --prune`), **Stash** (`git stash push -u`, réversible) et **nouvelle branche** locale (`git checkout -b`), avec mini-confirmation / saisie inline, toast et re-scan immédiat. **Jamais** de commit, push ou opération destructive. Garde-fous : actions refusées si l'opt-in est OFF ou si le repo n'est pas issu du dernier scan ; `GIT_TERMINAL_PROMPT=0` + timeout 20 s empêchent tout blocage sur une invite d'identifiants.
- **GitLab — détail MR au survol + badge pipeline** *(Roadmap Lot 3 #9)* — dans le panel, survoler une MR affiche un tooltip enrichi (statut pipeline, jobs échoués, threads non résolus, approbations manquantes), récupéré à la demande via le nouvel IPC `gitlab:mrDetail` (débouncé 250 ms + cache TTL 60 s, sources isolées en `Promise.allSettled` → dégradation gracieuse si l'API approvals est Premium). Le statut pipeline de **mes MR** est pré-chargé au poll (`pipelineStatus` sur `GitLabMr`) : pastille rouge distincte sur la chip collapsed quand un pipeline est cassé, et toast « Pipeline échoué » sur transition (toggle `notify.pipelines`, désactivé par défaut). *(Décompte +/− lignes reporté — pas d'API GitLab économique.)*

- **Mode `=` (Calc & Convert) dans la search bar** *(Roadmap Lot 1 #1)* — un préfixe `=` bascule la barre en calculette/convertisseur **100 % hors-ligne** (moteur pur `shared/calc.ts`, tokenizer + shunting-yard maison, zéro dépendance) :
  - arithmétique `(1920/3)*2`, `2**16`, `-2**2`, `100 % 7`, décimaux / notation scientifique (`+ - * / % **`, parenthèses, moins unaire) ;
  - bases `0xFF to dec` / `255 to hex` / littéral seul `0xFF` → dec/hex/bin/oct ;
  - longueurs CSS `20px to rem` (base 16 px) ; tailles data `1.5MB to KB` (décimal + binaire `KiB`) ;
  - epoch ↔ date `1700000000 to date`, `2024-01-01 to epoch`.
  Chaque valeur a un bouton Copier ; `Entrée` copie le résultat principal. Vue `CalcView` réutilisant la coque des vues de détection. *(Implémenté comme sigil-préfixe et non comme détecteur passif du `TEXT_PIPELINE` — sinon la calculette se déclencherait sur tout nombre tapé.)*
- **Détections dev passives étendues** *(Roadmap Lot 1 #2)* — le pipeline de détection partagé Clipboard ↔ search bar (`shared/clipboardDetectors.ts`) reconnaît trois nouveaux types, donc aussi bien dans la barre de recherche que dans l'historique du presse-papier :
  - **UUID** (RFC 4122, version détectée) → Copier minuscules / MAJUSCULES ;
  - **Hash** hex 32/40/64 → label MD5 / SHA-1 / SHA-256 + Copier ;
  - **Timestamp Unix** (10/13 chiffres, borné an 2000–2100) → date locale + UTC + relatif, Copier ISO / epoch s / ms.
  Détecteurs purs (sans dépendance Node). **Règle de priorité** : une chaîne opaque jugée sensible (mixte maj/min) n'est jamais décodée passivement comme un hash — elle reste masquée.
- **Claude Usage — projection de tenue** *(Roadmap Lot 1 #3)* — à partir de la vélocité de consommation (moyenne glissante pondérée sur les ring buffers persistés), le module estime si une fenêtre (5 h / 7 j) sera épuisée **avant son reset** :
  - texte sous les jauges (« 5 h épuisé dans ~38 min », « 7 j épuisé jeu. 16:00 ») ou « Tenu jusqu'au reset » ;
  - **ligne pointillée** de projection prolongeant la mini-sparkline 24 h, bornée par le reset ;
  - **alerte de rythme** : toast `notifyPace` (nouveau toggle, défaut activé) déclenché quand une fenêtre va dépasser avant son reset — distinct des seuils absolus 70/85/95.
  Moteur pur testable (`claudeUsage/projection.ts`) avec garde-fous cold-start et reset/roll-off. Ajout d'un ring buffer hebdomadaire parallèle (non exposé au renderer) pour la vélocité 7 j.
- **Bambu — toasts fin/échec + filament bas** *(Roadmap Lot 1 #4)* — notifications **toast-only** (jamais d'auto-expand, filtrées en Ne pas Déranger) sur l'imprimante 3D :
  - **fin d'impression** avec durée (« Impression terminée · 4h12 »), **échec** (FAILED), **erreur HMS grave** (fatal / serious) ;
  - **filament bas** quand une bobine AMS passe sous 10 % — ignoré si le `remainPercent` est inconnu (P1 sans RFID) ;
  - **résumé de la dernière impression** affiché dans la card hors impression (terminée / échec + durée + fichier).
  **Garde-fou** : le premier rapport reçu (snapshot `pushall`) sert de baseline silencieuse → aucun faux « terminée » au démarrage. Nouveaux toggles `notifyPrint` / `notifyFilament` (Settings → Imprimante 3D → Notifications, activés par défaut).
- **Mode `!` — Quicklinks & web bangs** *(Roadmap Lot 2 #6)* — la search bar devient une mini command-palette web. `!alias requête` ouvre une URL-template dans le navigateur (`!npm vite`, `!mdn fetch`, `!gh electron`…). Liste éditable dans **Réglages → Recherche → Quicklinks** (`alias url [| libellé]`, `{}` = emplacement de la requête), validée + dédupliquée côté main. Quelques alias dev par défaut (`g`, `npm`, `mdn`, `so`, `gh`). **Repli DuckDuckGo** automatique (`!bang`) quand l'alias est inconnu. Panneau de résultats navigable (↑↓ / Entrée / clic), helpers purs `shared/quicklinks.ts`, persistance via nouveau `settings:setQuicklinks`.
- **Mode `;` — Générateur d'utilitaires dev** *(Roadmap Lot 2 #7)* — boîte à outils hors-ligne dans la search bar : `;uuid` (+ régénérer), `;b64`/`;b64d` (base64 UTF-8), `;url`/`;urld`, `;case fooBar` (camel/Pascal/snake/kebab/CONSTANT), et `;md5`/`;sha1`/`;sha256`/`;sha512` (calculés côté main via `node:crypto`, nouveau IPC `search:transform`). Un bouton Copier par sortie. Helpers purs `shared/devtools.ts`. Le décodage base64 reste cantonné à ce sigil (jamais en détection passive, pour ne pas interférer avec le masquage des chaînes sensibles).
- **Mode `:` — Snippets à placeholders** *(Roadmap Lot 2 #8)* — `:` ouvre une liste de modèles de texte filtrables (↑↓ / Entrée / clic). À la copie, les **placeholders** sont résolus : `{clipboard}` (presse-papier actuel), `{date}`/`{time}`/`{datetime}`, `{uuid}`. Éditables dans **Réglages → Recherche → Snippets** (une ligne `nom contenu` par snippet, sauts de ligne `\n`), persistés via `settings:setSnippets`. Helpers purs `shared/snippets.ts`. **Synergie sécurité** : la valeur résolue de `{clipboard}` (potentiel secret) n'est jamais affichée — seul le body brut est listé, la résolution se fait au moment de la copie.

### Changed

- **Raccourci global du presse-papier `Ctrl+Shift+V` → `Ctrl+Alt+V`**. `Ctrl+Shift+V` est le raccourci Windows natif de « coller sans mise en forme » ; le conflit empêchait son usage. Mise à jour de l'accélérateur (`globalShortcuts.ts`) et de toutes les références visibles (tooltip search bar, description Settings, chip clipboard, page clipboard, aide recherche) + commentaires.

### Fixed

- **Contrôle du volume inopérant en version installée** (affichait `0 %` + icône mute alors qu'il y avait du son, OK en dev). Cause : le binaire `loudness` (`adjust_get_current_system_volume_vista_plus.exe`) était spawné depuis son chemin **virtuel** dans `app.asar`, or `CreateProcess` ne peut pas lire un `.exe` à l'intérieur de l'archive asar (Electron ne patche que `fs`, pas le spawn de process) → `ENOENT` silencieux, cache volume figé à `0` (et l'icône mute s'allume dès que `level === 0`). `audio/volume.ts` résout désormais le chemin et le réécrit vers `app.asar.unpacked\…` (no-op en dev), et appelle le binaire directement pour la lecture **et** l'écriture (`setVolume`/`setMuted` ne passent plus par l'API JS de `loudness`, qui souffrait du même chemin cassé). Commentaire `electron-builder.yml` (« loudness wrappe PowerShell ») corrigé au passage.

## [1.1.0] - 2026-05-29

### Added

- **Famille de modules `Claude`** — premier client du nouveau mécanisme générique de regroupement. Settings → Modules affiche désormais une section dédiée « Claude » qui contient deux sous-modules indépendants (toggle + drilldown par sous-module).
- **Module `claude.usage`** — suivi des limites d'usage Claude Pro / Max (fenêtres 5 h et 7 j) avec :
  - Card dashboard : 2 jauges horizontales (vert < 70 < orange < 90 < rouge), countdowns vers le prochain reset, mini-sparkline 24 h, badge plan (Pro / Team · Max 5× / Team+ · Max 20× · ?). Les paires perso/équipe partagent une seule valeur car leurs nominaux par seat sont identiques.
  - Sources : cache statusline `~/.claude/winnotch-usage.json` (autoritaire) avec fallback parsing des `.jsonl` dans `~/.claude/projects/` quand le statusline n'a pas encore tourné.
  - Wrapper statusline WinNotch installable depuis Settings — patch idempotent de `~/.claude/settings.json`, **mode wrap** si l'utilisateur avait déjà un statusline custom (la commande d'origine est invoquée en suivant via `WINNOTCH_WRAPPED_STATUSLINE`).
  - Toasts à chaque franchissement de seuil (70 / 85 / 95 % configurables) sur 5 h ou 7 j, dédupliqués jusqu'au reset suivant, filtrés en Ne pas Déranger.
  - Ring buffer 288 points (5 min × 24 h) persisté dans `electron-store` (store dédié `claude-usage.json` pour ne pas polluer le `config.json` Settings).
  - Polling configurable [10 s, 5 min], défaut 30 s.
  - Couvre Claude Code, claude.ai et Claude Design (quota unifié depuis fin mai 2026).
- **`ModuleId` hiérarchique** (`<groupId>.<subId>`) — convention dot-notation extensible. Helper `parseModuleId` + nouveau fichier `moduleGroupsMeta.ts` qui définit les familles affichables dans Settings. Premier groupe : `claude`. Préparé pour d'autres familles futures (Teams + Slack, GitLab + GitHub, …) sans refactor.
- **Section `description` optionnelle** dans `<SettingsSection>` (atom partagé) — affichée sous le titre d'une famille pour rappeler son périmètre.

### Changed

- **Module historique `claude` → `claude.live`** (sessions Claude Code détectées via file watcher). Renommage de :
  - `ModuleId` / `DashTileId` / `VALID_DASH_TILE_IDS`
  - `ModuleConfig['claude.live']` (ex-`ModuleConfig.claude`)
  - `DEFAULT_SETTINGS.modules['claude.live']` et `.moduleConfig['claude.live']`
  - tuile `dashboardLayout` : `{ id: 'claude' }` → `{ id: 'claude.live' }`
  - libellé dans `modulesMeta` : « Claude Code » → « Sessions live »
- **Canaux IPC `claude:*` inchangés** (`claude:list`, `claude:change`) — conventions de naming hors typage TS, pas de raison de casser le contrat.
- **Migration douce v1.0 → v1.1** dans `settingsService.mergeDefaults` : renomme automatiquement les clés persistées (`modules.claude` → `modules['claude.live']`, `moduleConfig.claude` → `moduleConfig['claude.live']`, `{id:'claude'}` → `{id:'claude.live'}` dans `dashboardLayout`). Idempotente : à la 2ᵉ passe les clés legacy n'existent plus, le bloc est no-op. Les préférences utilisateur (toggle, position custom de la tuile, etc.) sont préservées.
- **Card dashboard `ClaudeCard`** désormais branchée sur `tile.id === 'claude.live'` (au lieu de `'claude'`). Idem `ClaudeChip` côté collapsed.
- Bump version `1.0.2` → `1.1.0` — premier ajout fonctionnel post-v1 + refacto interne sans casse côté utilisateur.

### Notes

- L'utilisateur n'a rien à faire : la migration est transparente, son toggle / position de tuile / config existante sont préservés au premier boot 1.1.
- Le wrapper statusline n'est **pas** installé automatiquement — il faut explicitement l'activer via Settings → Claude → Limites d'usage. En attendant, le module bascule sur le fallback `jsonlParser` qui donne une estimation grossière (`source: 'estimated'`) selon le plan saisi.
- Flag d'arrêt diagnostique : `WINNOTCH_DISABLE_CLAUDE_USAGE=1` saute l'enregistrement du module au boot. Le flag historique `WINNOTCH_DISABLE_CLAUDE` reste effectif pour `claude.live`.

---

## [1.0.2] - 2026-05-29

### Changed

- **Bump majeur Electron 32 → 41.7.1** (10 majeures de retard rattrapées). Chromium M146, Node 22.x. Récupère les correctifs sécurité accumulés depuis fin 2024.
- **Ecosystème Electron suivi en cohérence** :
  - `electron-builder` 24 → 26.8.1 (migration interne `rcedit.exe` → paquet npm `resedit`, support pnpm 11).
  - `electron-vite` 2 → 5.0.0 (nouveau type `BuildEnvironmentOptions`, peer Vite ≥ 7).
  - `vite` 5 → 7.3.3 (forcé par electron-vite 5).
  - `@electron-toolkit/utils` 3 → 4.0.0, `@electron-toolkit/preload` 3.0.1 → 3.0.2.
  - `@types/node` 20 → 22.
- **CI Node 20 → 22** dans `.github/workflows/release.yml` (Electron 41+ requiert Node 22.x à la compilation).

### Security

- 0 vulnérabilité npm reportée par `npm audit` (vs. 2 moderate en v1.0.1, héritées de la chaîne `vite 5`).
- Correctifs Chromium / Node accumulés sur 10 majeures Electron récupérés.

### Notes

- **Cible Electron 42 reportée** : `better-sqlite3` 12.10.0 a explicitement retiré ses prebuilds pour Electron 42 (cf. changelog upstream « Temporarily rollback support for Electron v42 prebuilds »). Pin sur 41.7.1 (EOL 25 août 2026) — à rebumper en v42 ou v43 dès que `better-sqlite3` republie ses prebuilds compatibles.

---

## [1.0.1] - 2026-05-29

### Fixed

- **Tooltip participants Meetings (mode étendu)** : la bulle listant tous les participants du « next meeting » restait clippée à l'intérieur de la tuile dans le mode dashboard (double `overflow: hidden` du `.notch` + `overflow-y: auto` du `.dashboard`). Rendue désormais via `createPortal(document.body)` avec position `fixed` calculée depuis le rect du wrapper, fermeture différée 100 ms pour permettre au curseur de traverser le gap et scroller la liste interne (`max-height: 220px`). Z-index relevé à 10000 pour passer au-dessus du `.notch` (z-index 9999).

---

## [1.0.0] - 2026-05-28

Première version stable. Gel fonctionnel — pas de nouveau module avant la v1.x.

### Added

- **Système live (CPU / RAM / Réseau)** — module read-only toujours actif. Polling 1 Hz par défaut, sparkline SVG dans la chip rétractée, card étendue avec 3 jauges horizontales + uptime PC. Lecture CPU/RAM/uptime via Node natif `os.*`, débit réseau via `Get-NetAdapterStatistics` (PowerShell `-EncodedCommand`).
- **Pattern Service+Context aligné** sur les modules historiquement hors-pattern :
  - `audio` a désormais un `AudioContext` (subscription IPC unique, plus de re-renders inutiles).
  - `search` a un `SearchContext` (query + clearSearch partagés, reset au passage en collapsed).
  - `tasks` est extrait de `SettingsContext` en service main `tasksService.ts` + `TasksContext` avec ses propres canaux IPC `tasks:*`.
- **Lazy-load** des 3 pages plein dashboard (`SettingsView`, `GitLabPanel`, `ClipboardPage`) via `React.lazy()` + `<Suspense>`. Bundle JS initial réduit de **654 KB → 433 KB** (−34 %).
- **CHANGELOG.md** (ce fichier).

### Changed

- **Démarrage automatique migré vers Task Scheduler** (`Register-ScheduledTask` via PowerShell) au lieu de la Run key historique (`HKCU\…\Run`). Raison : la Run key subit le « Startup Delay » de Windows 10/11 (10 s fixes + jusqu'à 150 s aléatoires), qui faisait apparaître WinNotch 1 à 2 minutes après l'ouverture de session. Une task `AtLogOn` se déclenche immédiatement. Migration douce : au premier boot v1, l'éventuelle Run key d'une install v0.x est convertie en task + nettoyée transparenttement.
- **Migration `pollSec → pollMs`** sur les 4 modules concernés (`vpn`, `teams`, `gitlab`, `gitlocal`). Unité uniforme avec le module `system` (qui était déjà en `pollMs`). Migration douce du store dans `mergeDefaults` : une vieille config porteuse de `pollSec` est convertie au boot (`pollMs = pollSec × 1000`) sans perte des préférences utilisateur.
- **Validator runtime `VALID_DASH_TILE_IDS`** : passage en `satisfies Record<DashTileId, true>`. Si un nouveau membre est ajouté à l'union sans être enregistré dans la table, le typecheck casse — élimine le piège du « drag-and-drop silencieusement filtré » rencontré sur la tuile Système live.
- **Cap caches main process** pour borner le heap sous usage intensif :
  - sessions Claude : éviction par âge (> 48 h) + plafond 200 entrées LRU.
  - `urlUnfurl` clipboard : LRU 500 entrées (TTL 24 h conservé).
  - `clipboard.maxItems` : clamp `[10, 500]` côté serveur dans `mergeDefaults` (sécurité contre un édit manuel du `config.json`).
- **Mesure de hauteur du notch** : passe de `scrollHeight` à `offsetHeight` pour les enfants du `.dashboard`. `scrollHeight` remontait le contenu débordé d'enfants comme `.mnpt-list` (liste des meetings qui scrolle en interne via `max-height + overflow-y: auto`), gonflant la hauteur effective de +200 px et plus.
- **Documentation** :
  - `README.md` : section « Mode Ne pas Déranger » détaille le comportement par chip (notifs masquées vs état système visible).
  - `README.md.local` : table de debug DND par chip, flags `WINNOTCH_DISABLE_*` complétés (`AUDIO_POLL`, `SYSTEM`, `SVV`), section « Dépendances — choix v1 » qui documente les bumps reportés post-v1 et les vulns acceptées (dev-only).

### Removed

- Module **`messages`** (stub jamais rempli). Retiré de `ModuleId`, `ModuleConfig`, `DEFAULT_SETTINGS`, `SETTINGS_MODULES`, page Settings, commentaires d'historique. Hors scope v1.
- Dépendance npm **`chokidar`** (jamais importée, vestige d'un essai de file watcher abandonné).
- Type orphelin **`IpcChannelValue`** dans `shared/types.ts` (0 référence).

### Fixed

- **Drag-and-drop de la tuile Système live** dans Settings → Disposition : la tuile était silencieusement filtrée par un validator runtime hardcodé qui n'avait pas été mis à jour. Fixé + blindé via `satisfies Record<DashTileId, true>` (cf. Changed).
- **`setTimeout` non démontés** dans `GitLabCard` et `GitLabPanel` (spinner refresh 400 ms). Capture du handle dans une `useRef`, cleanup dans le return du `useEffect`. Warning React et setState sur node mort éliminés.
- **Hauteur du notch en mode expanded** qui restait collée à une valeur trop grande quand une card avait un overflow interne (Meetings, surtout). Cf. Changed.

### Security

- `npm audit fix` non-breaking : 1 vulnérabilité `tmp` (path traversal) corrigée. 9 vulns restantes acceptées pour la v1 — toutes dans la chaîne `electron-builder` (devDependencies), aucune exposition côté runtime utilisateur. Le bump `electron-builder@26` (breaking) est planifié post-v1.

---

## [0.9.0] - 2026-05-28

### Added

- Module **Système live (CPU / RAM / Réseau)** v0 (livré sur la branche `feat/live-cpu-ram`, intégré au tag `v0.9.0`).

## [0.8.0] - 2026-05-28

### Added

- Module **Teams (présence)** — Microsoft Graph `/me/presence` lecture + écriture (`setUserPreferredPresence` / `clearUserPreferredPresence`). Couplage DND ↔ Teams bidirectionnel avec filtre anti-écho 30 s. Réutilise l'app Entra single-tenant CFAST + l'auth OAuth Outlook (scope `Presence.ReadWrite`).
- **Isolation `userData` dev vs prod** via `src/main/bootstrap.ts` (override `app.setPath('userData')` quand `!app.isPackaged`). Évite que `npm run dev` mélange sa config avec le build installé.
- Toggle `showCard` généralisé sur tous les modules avec card. Permet de masquer la card sans désactiver le module (chip + toasts restent actifs).

## [0.7.0] - 2026-05-27

### Added

- Module **VPN status** (read-only) — détection des sessions VPN actives sur Windows (ProtonVPN, NordVPN, OpenVPN, WireGuard, VPN natifs). Polling PowerShell `-EncodedCommand` avec filtre WMI.
- Composant **`<NotchTooltip>`** réutilisable via `createPortal(document.body)`. Migration de toutes les chips du mode rétracté (music, meetings, claude, gitlab, gitlocal, clipboard, vpn, dnd).
- **Mapping source SMTC vers nom commercial** + icône Font Awesome brand (ex. `SpotifyAB.SpotifyMusic_xxx` → « Spotify »).
- **Module Meetings enrichi** : app Entra dédiée CFAST, participants riches avec tooltip, photo profil self via Graph, icône provider Outlook/Google, boutons « Rejoindre » + « Ouvrir ».

## [0.6.1] - 2026-05-25

### Added

- Module **Git local** — scan récursif de dossiers racines, suivi par repo (branche, uncommitted, ahead/behind).
- Module **Clipboard intelligent** — historique chiffré DPAPI, détection automatique URL/JSON/JWT/couleur/chemin/image, page plein dashboard, raccourci `Ctrl+Shift+V`.
- **Search bar enrichie** : préfixes `-` `>` `/` `vs` `?` + mode détection live (URL/JSON/JWT/couleur/chemin) + mode aide `?`.
- **Hauteur dynamique du dashboard** étendu (suit le contenu réel jusqu'à `workArea.height − 100`).

## [0.6.0] et versions antérieures

Modules **Audio**, **Music** (SMTC), **Meetings** (OAuth Outlook + Google), **Claude Code**, **GitLab** (MR + issues critiques), **Tasks**, **Updater** (auto-update GitHub Releases), **DND**, **mode Peek**, **masquage plein écran**, **multi-écrans**, **packaging NSIS**, **CI/CD GitHub Actions** sur push de tag.
