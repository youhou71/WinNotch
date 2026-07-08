# WinNotch

Widget système flottant pour Windows 11 inspiré du Dynamic Island d'iOS. WinNotch est une "notch" toujours au sommet de l'écran principal qui s'étend en un dashboard riche au clic ou via raccourci global.

> Stack : Electron 41 · electron-vite 5 · React 18 · TypeScript strict.

---

## Vue d'ensemble

À l'état rétracté, WinNotch est une petite barre noire qui héberge des chips contextuelles (musique en cours, prochain meeting, sessions Claude actives, état GitLab…). Au clic ou via `Ctrl + Shift + Space`, elle s'anime en un dashboard de 580 px de large rassemblant les informations actionnables du moment.

Conçu pour rester discret (mode Peek à `Alt` maintenu, masquage en plein écran, mode Ne pas Déranger).

---

## Modules

### Audio (toujours actif)
Footer sticky dans le dashboard. Contrôle du volume et du mute système, et basculement du périphérique de sortie par défaut (haut-parleurs, casque, sortie HDMI, etc.). Reflète les changements externes faits via les touches Windows.

### Music
Chip avec pochette + titre tronqué dans le notch rétracté, card étendue avec scrubber et contrôles play/pause/next/previous. Écoute les sessions media (SMTC) — fonctionne avec Spotify, Apple Music, navigateurs, Groove, etc.

### Meetings
Connexion **Outlook** (Microsoft Graph) et **Google Calendar** via OAuth. Chip avec le prochain rendez-vous, card avec la liste agrégée. Tokens chiffrés localement via DPAPI.

Pour chaque compte, l'utilisateur peut choisir précisément les calendriers à inclure (calendrier personnel, calendriers partagés, anniversaires…). Section dépliable « Filtres » sous chaque compte dans Settings → Meetings : toutes les cases sont cochées par défaut au premier connect, décocher exclut le calendrier de la liste des meetings affichés. Les nouveaux calendriers ajoutés côté provider après le premier paramétrage n'apparaissent **pas** automatiquement — cliquer sur « Rafraîchir » pour les voir.

Pour les comptes **Outlook**, le panneau permet aussi de masquer certaines **catégories de couleur** (liste noire). Pratique pour filtrer un tag « Perso » ajouté à des events dans le calendrier pro. Les events sans catégorie sont toujours affichés.

### Famille Claude

Regroupe deux sous-modules indépendants (toggles séparés dans Settings) :

#### Claude · Sessions live
Détecte automatiquement les sessions Claude Code en cours sur la machine (sans configuration) via le file watcher sur `~/.claude/projects/`. Indicateurs visuels d'activité, toast à la fin d'une session, et badge "?" jaune quand Claude attend une réponse utilisateur.

#### Claude · Limites d'usage
Suivi des **limites d'usage Pro / Max** sur les fenêtres glissantes **5 h** et **7 j** — couvre Claude Code, claude.ai et Claude Design (quota unifié depuis fin mai 2026).

Card dashboard avec 2 jauges horizontales (vert < 70 < orange < 90 < rouge), countdown vers le prochain reset, badge plan (`Pro / Team`, `Max 5× / Team+`, `Max 20×`) et **mini-sparkline 24 h** alimenté par un ring buffer local (288 points × 5 min).

**Projection de tenue** : à partir de la vélocité de consommation (moyenne glissante pondérée sur le ring buffer), le module estime si une fenêtre sera épuisée **avant son reset** et l'affiche (« 5 h épuisé dans ~38 min », « 7 j épuisé jeu. 16:00 ») avec une **ligne pointillée** prolongeant la sparkline. Une **alerte de rythme** (toast distinct des seuils absolus) prévient au franchissement.

Toasts à chaque franchissement de seuil (par défaut 70 / 85 / 95 %), dédupliqués jusqu'au reset suivant, filtrés en Ne pas Déranger.

**Source de données** : un wrapper statusline WinNotch (`resources/winnotch-statusline.cjs`) installable depuis Settings, qui patche `~/.claude/settings.json` de manière idempotente. À chaque turn de Claude Code, le wrapper écrit les `rate_limits` dans `~/.claude/winnotch-usage.json`. Si l'utilisateur avait déjà un statusline custom, WinNotch passe en **mode wrap** (la commande d'origine est invoquée en suivant — aucune perte de fonctionnalité). Tant que le wrapper n'a pas tourné une première fois, le module retombe sur un fallback de parsing local des `.jsonl` qui donne une estimation grossière selon le plan saisi.

Polling configurable de 10 s à 5 min (défaut 30 s).

### GitLab
Suit les **MR à reviewer**, **mes MR ouvertes**, et **issues critiques non assignées** (labels surveillés, ex. `Severity::Critique`). Chip avec badge rouge pulse pour les issues à prendre. Dashboard compact à 3 chiffres, panel plein dashboard au clic, clic sur une ligne ouvre dans le navigateur. Toasts pour les nouvelles MR assignées et les nouvelles issues critiques. Une MR **disparaît de « à reviewer » dès que tu as donné ta review** (relue, approuvée ou changements demandés).

**Détail au survol + pipelines** : dans le panel, survoler une MR affiche un tooltip enrichi (statut pipeline, jobs échoués, threads non résolus, approbations manquantes) — récupéré à la demande, débouncé et caché 60 s. Le statut pipeline de **mes MR** est pré-chargé à chaque poll : une pastille rouge distincte apparaît sur la chip quand un de mes pipelines est cassé, et un toast « Pipeline échoué » est émis sur transition (à activer dans Réglages → GitLab → notifications pipelines). *(Le décompte +/− lignes est reporté — pas d'API GitLab économique.)*

Configuration : URL d'instance + Personal Access Token (scope `read_api`), chiffré localement.

### Git local
Scanne des dossiers racines configurés pour trouver les repos Git locaux et rappelle passivement ceux qui ont des modifs non poussées. Card compacte avec deux totaux (`dirty` / `repos`), panel plein dashboard listant chaque repo avec branche, fichiers non commités, commits ahead/behind. Chip discrète dans le notch rétracté quand au moins un repo est sale.

Clic sur un repo : auto-détection — un `.sln`/`.slnx` à la racine ouvre **Visual Studio** (association de fichier Windows), sinon **VS Code** (`code -n <path>`).

**Actions Git sûres (opt-in, désactivé par défaut)** : une fois activées dans Réglages → Git local → Actions Git, chaque repo du panel expose **Fetch** (`git fetch --prune`), **Stash** (`git stash push -u`, réversible, si modifs locales) et **nouvelle branche** locale (`git checkout -b`, saisie inline). Mini-confirmation avant Stash / branche, toast de résultat, re-scan immédiat. **Jamais** de commit, push ou opération destructive. Garde-fous : git ne peut pas bloquer sur une invite d'identifiants (`GIT_TERMINAL_PROMPT=0` + timeout 20 s), et les actions ne s'exécutent que sur un repo issu du dernier scan.

Configuration : liste de dossiers racines à scanner, profondeur du scan, patterns ignorés, fréquence de rescan (défaut 60 s). Dépend de `git` dans le PATH.

### Tasks
Liste de tâches éphémères locales (pas de cloud sync). Compteur compact dans le dashboard, vue détaillée via le préfixe `-` dans la search bar. Auto-suppression optionnelle des tâches terminées après N jours.

### Clipboard
Historique du presse-papier chiffré localement (DPAPI), avec détection automatique du type de contenu et preview adapté :

- **Images** (screenshots, copies depuis navigateur) → miniature + bouton « Enregistrer ».
- **URLs** → titre + favicon récupérés en arrière-plan (désactivable).
- **JSON** → pretty-print dépliable.
- **JWT** → header + payload décodés + indicateur d'expiration.
- **Codes couleur** (`#fff`, `rgb()`, `hsl()`) → swatch visuel.
- **Chemins Windows** (`C:\…`, UNC) → bouton « Ouvrir dans Explorer ».

Recherche, épinglage, masquage automatique des secrets détectés (tokens, passwords). Limite par défaut 50 entrées non-épinglées (configurable jusqu'à 200). Raccourci global `Ctrl + Alt + V` pour ouvrir directement la card avec focus sur la recherche.

### VPN
Détecte les sessions VPN actives sur la machine — **ProtonVPN**, **NordVPN**, **OpenVPN**, **WireGuard** et les VPN configurés dans Windows (PPTP / L2TP / SSTP / IKEv2). Chip bouclier cyan dans le notch rétracté quand une connexion est active (visible même en Ne pas Déranger — c'est un état système). Card compacte dans le dashboard avec le client + nom de connexion + pays (optionnel) + durée de session. Toast à chaque transition connexion / déconnexion.

Read-only : aucune action exposée (pas de connect / disconnect). Le module observe l'état via `Get-NetAdapter` + `Get-VpnConnection` + scan de processus, sans toucher à la session. Résolution du pays best-effort via `ipapi.co` (cache 6 h, désactivable).

### Confidentialité (témoin caméra / micro)
Pastille rouge (icône caméra / micro + point pulsant) dans le notch rétracté **quand une application utilise actuellement la webcam ou le micro**, avec un tooltip listant les apps concernées. Visible même en Ne pas Déranger — c'est un signal de sécurité, particulièrement utile en partage d'écran / présentation. Au repos, rien ne s'affiche.

**100 % local, read-only** : lecture du registre Windows `CapabilityAccessManager\ConsentStore` (HKCU) — une app est « en cours » quand son `LastUsedTimeStop` vaut 0. Aucune capture, aucun réseau, aucune donnée stockée.

### Système live (CPU / RAM / Réseau)
Module toujours actif, lecture seule. Chip dans le notch rétracté avec un **mini-sparkline** (60 dernières secondes) + pourcentage de la métrique choisie (CPU par défaut, ou RAM, ou NET — configurable). Couleur dynamique vert → or → rouge selon des seuils raisonnables (CPU/RAM : 50 % / 80 % ; NET : 1 Mb/s / 10 Mb/s). Visible même en mode Ne pas Déranger — c'est un état système.

Dans le dashboard étendu, une card compacte avec trois jauges horizontales (`CPU 14%`, `RAM 45%`, `NET 1.5 Mb/s`) + l'**uptime du PC** aligné à droite. La largeur des barres est animée doucement (transition 180 ms) pour rester lisible à 1 Hz.

CPU/RAM/uptime sont lus en pur Node natif (`os.cpus()`, `os.totalmem()`, `os.uptime()`) — zéro dépendance. Le débit réseau est calculé via `Get-NetAdapterStatistics` (PowerShell, encodé en base64 comme le module VPN) sur deux snapshots consécutifs, en filtrant automatiquement les interfaces loopback / vEthernet / WSL / Bluetooth PAN / pseudo-interfaces. L'utilisateur peut whitelist explicitement certaines interfaces dans Settings.

Polling configurable de 500 ms à 5 s (défaut 1 s).

### Teams (présence)
Statut Microsoft Teams lu et piloté via Microsoft Graph (`/me/presence`). Pastille colorée dans le notch rétracté (vert = Disponible, rouge = Occupé, rouge foncé = Ne pas déranger, jaune = De retour bientôt / Absent). Card compacte avec les 5 boutons pour changer manuellement le statut + bouton « Auto » qui retire le statut manuel (`clearUserPreferredPresence`). Polling 30 s par défaut.

Réutilise l'authentification du module **Prochains rendez-vous** (mêmes tokens OAuth Outlook avec le scope additionnel `Presence.ReadWrite`). Si tu as connecté ton compte Outlook avant cette feature, la card affiche un bouton « Reconnecter » qui relance le flow OAuth en mode `prompt=consent` pour ré-élever le scope.

**Couplage DND bidirectionnel** (activé par défaut, désactivable dans Settings → Teams) : `Ctrl+Shift+D` bascule aussi ton statut Teams en DoNotDisturb (et inversement, un Teams DoNotDisturb détecté par le polling active le DND WinNotch). Un filtre anti-écho de 30 s évite les boucles entre l'écriture locale et la lecture du tick suivant.

### Imprimante 3D (Bambu)
Suivi d'un print Bambu Lab **série P1** (P1P / P1S) en local, **lecture seule**. Chip imprimante dans le notch rétracté pendant une impression (`42 %` + ETA), qui vire au rouge si une erreur HMS est active. Card dans le dashboard : barre de progression + temps restant + couche X/Y + nom du fichier, températures buse / lit, bobines AMS (couleur + type + % restant, slot actif surligné), et erreurs HMS en rouge avec lien direct vers le wiki Bambu. Hors impression, la card affiche un **résumé de la dernière impression** (terminée / échec + durée + fichier).

**Notifications** (toast-only, jamais d'auto-expand, filtré en Ne pas Déranger) : **fin d'impression** (avec la durée, « Impression terminée · 4h12 »), **échec**, **erreur HMS grave**, et **filament bas** quand une bobine AMS passe sous 10 % (nécessite le suivi RFID — sinon le % est inconnu et aucune alerte n'est émise). Le premier rapport reçu sert de **baseline silencieuse** : aucun faux « terminée » au démarrage. Réglable dans Settings → Imprimante 3D → Notifications.

Deux **modes de connexion** (au choix dans Settings → Imprimante 3D) :

- **Réseau local (LAN)** — MQTT direct au broker de l'imprimante (`mqtts://<ip>:8883`, auth `bblp` + code d'accès LAN, certificat auto-signé). Rapide, privé, sans dépendance Internet. Prérequis : **mode LAN** activé sur l'imprimante + **IP** + **numéro de série** + **code d'accès** (chiffré localement via DPAPI). PC et imprimante doivent être sur le **même réseau**.
- **Cloud Bambu** — pour suivre ses impressions **à distance** (ex. depuis le PC du boulot, imprimante à la maison). Connexion au broker cloud Bambu (`us.mqtt.bambulab.com`, ou `cn.` pour la Chine) via le **compte Bambu**. Connexion par **code email** : tu saisis ton email, reçois un code par mail, et le valides. Une connexion par **mot de passe** reste disponible en option. Note : les comptes **Google / Apple** ne reçoivent pas toujours le code email — dans ce cas, ajoute un mot de passe à ton compte sur bambulab.com et utilise l'option mot de passe. Puis tu choisis l'imprimante dans la liste liée au compte. Ni mot de passe ni code ne sont stockés — seul un **jeton chiffré** (DPAPI) est conservé, rafraîchi automatiquement. Prérequis : l'imprimante doit rester **connectée au cloud** (le mode « LAN Only » strict la coupe du cloud).

Dans les deux modes : la série P1 envoie des rapports en *deltas* (champs modifiés uniquement) fusionnés dans un état accumulé, amorcé par un `pushall` à la connexion ; reconnexion automatique ; chip non masquée en Ne pas Déranger (un print de plusieurs heures prime sur le DND).

> Caméra, contrôle (pause/stop) et série X1 hors périmètre de cette version.

### Updater
Mises à jour automatiques via GitHub Releases. Check au boot + toutes les heures. Notifications utilisateur à chaque étape (disponible → téléchargée → installée). Aucun téléchargement ni install sans confirmation explicite.

---

## Search bar (notch ouvert)

Champ de recherche en haut du dashboard. Deux familles de comportement :

### Préfixes explicites

| Préfixe | Mode | Action sur `Entrée` |
|---|---|---|
| `?` | Aide | Affiche un panneau récapitulatif des préfixes, détections et raccourcis disponibles selon les modules actifs |
| `-` | Tâche | Ajoute la tâche à la liste |
| `=` | Calc & Convert | Évalue un calcul ou une conversion inline ; `Entrée` copie le résultat |
| `!` | Quicklinks & bangs | Raccourcis web (`!npm vite`, `!mdn fetch`) ; ↑↓ pour naviguer, `Entrée` ouvre. Repli DuckDuckGo si l'alias est inconnu |
| `;` | Utilitaires dev | UUID, base64, hash, conversion de casse ; un bouton Copier par sortie |
| `:` | Snippets | Insère un modèle de texte à placeholders (`{clipboard}`/`{date}`/`{uuid}`) ; ↑↓ pour naviguer, `Entrée` copie |
| `>` | Claude Code | Lance `claude "<prompt>"` dans un nouveau terminal Windows |
| `/` | VS Code | Liste les workspaces récents, ouvre via `code <path>` |
| `vs` | Visual Studio | Liste les solutions `.sln`/`.slnx`, ouvre via l'association de fichier |

Les listes `/` et `vs` s'affichent **instantanément** depuis un cache (amorcé dès le démarrage) puis se rafraîchissent en tâche de fond : le scan des dossiers / la lecture des projets récents ne bloque plus la frappe, et la liste se met à jour en direct dès qu'un changement est détecté.

Les **dossiers de recherche** sont configurables dans **Réglages → Recherche → Dossiers** (un chemin par ligne, défaut `C:/Projets`). Ils pilotent les deux modes : ils sont scannés récursivement pour les solutions Visual Studio (`vs`) et servent à filtrer les workspaces récents VS Code (`/`) — seuls ceux situés sous l'une des racines sont affichés (masque les dossiers hors projets, WSL, etc.).

#### Mode `=` (Calc & Convert)

Calcul et conversion **100 % hors-ligne** (aucune dépendance, aucun réseau) :

- **Arithmétique** : `(1920/3)*2`, `2**16`, `-2**2`, `100 % 7`, décimaux et notation scientifique. Opérateurs `+ - * / % **`, parenthèses, moins unaire.
- **Bases** : `0xFF to dec`, `255 to hex`, `0b1010 to oct`, ou un littéral seul (`0xFF`) qui affiche dec/hex/bin/oct.
- **Longueurs CSS** : `20px to rem` (base 16 px) — px/rem/em/pt/pc/in/cm/mm.
- **Tailles de données** : `1.5MB to KB` — décimal (`KB` = 1000) et binaire (`KiB` = 1024).
- **Epoch ↔ date** : `1700000000 to date`, `2024-01-01 to epoch`.

Le résultat (et chaque ligne secondaire) dispose d'un bouton Copier ; `Entrée` copie le résultat principal. *(Devises hors scope — nécessiteraient le réseau.)*

#### Mode `!` (Quicklinks & bangs)

Raccourcis web ouverts dans le navigateur. Tape `!alias requête` : `!npm vite`, `!mdn fetch`, `!gh electron`, `!so async rust`… Les alias sont des **templates d'URL** où `{}` marque l'emplacement de la requête, éditables dans **Réglages → Recherche → Quicklinks** (un par ligne : `alias url [| libellé]`). Quelques alias dev sont fournis par défaut (`g`, `npm`, `mdn`, `so`, `gh`) ; ajoute les tiens (instance GitLab d'entreprise, Sentry, etc.).

Si l'alias tapé ne correspond à aucun quicklink, un **repli DuckDuckGo** est proposé (`!alias …` via la base de bangs de DDG). `↑↓` navigue, `Entrée` (ou clic) ouvre.

#### Mode `;` (Utilitaires dev)

Boîte à outils développeur **hors-ligne**. Tape `;commande [texte]` :

- `;uuid` — génère un UUID v4 (bouton Régénérer).
- `;b64 <texte>` / `;b64d <base64>` — encode / décode base64 (UTF-8).
- `;url <texte>` / `;urld <texte>` — encode / décode URL.
- `;case <texte>` — affiche toutes les casses (camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE).
- `;md5` / `;sha1` / `;sha256` / `;sha512` `<texte>` — hash (calculé côté main via Node crypto).

Chaque sortie a un bouton Copier. Le décodage base64 n'est disponible **que** derrière ce sigil (jamais en détection passive, pour ne pas interférer avec le masquage des chaînes sensibles).

#### Mode `:` (Snippets)

Insère des modèles de texte. Tape `:` (puis un filtre) pour lister tes snippets, `↑↓` pour naviguer, `Entrée` (ou clic) pour **copier** le snippet — ses **placeholders** sont résolus à la copie :

- `{clipboard}` — contenu actuel du presse-papier ;
- `{date}` / `{time}` / `{datetime}` — date/heure locale ;
- `{uuid}` — un UUID v4 (nouveau par occurrence).

Les snippets sont éditables dans **Réglages → Recherche → Snippets** (une ligne par snippet : `nom contenu`, le nom est le premier mot ; saut de ligne dans le contenu = `\n`). La valeur de `{clipboard}` (potentiellement un secret) n'est **jamais** affichée à l'écran : seul le body brut est listé, la résolution se fait au moment de la copie.

### Détection de contenu live

Quand le contenu tapé ou collé ressemble à un type connu, le dashboard bascule sur une vue d'actions adaptée :

| Type détecté | Affichage | Actions |
|---|---|---|
| URL (`https?://…`) | Host + URL complète | Ouvrir dans le navigateur · Copier |
| JSON (`{…}` / `[…]`) | Pretty-print | Copier formaté · Copier compact |
| JWT (`xxx.yyy.zzz`) | Header + payload décodés + expiration | Copier le token · Copier décodé |
| Couleur (`#fff`, `rgb()`, `hsl()`) | Swatch + équivalents | Copier HEX · RGB · HSL |
| Chemin Windows (`C:\…`, UNC) | Basename + chemin complet | Ouvrir dans Explorer · Copier |
| UUID (RFC 4122) | Version détectée | Copier minuscules · MAJUSCULES |
| Hash hex (32/40/64) | Label MD5 / SHA-1 / SHA-256 | Copier |
| Timestamp Unix (10/13 chiffres) | Date locale + UTC + relatif | Copier ISO · epoch s/ms |

Ces détections sont **passives et partagées** : elles s'appliquent aussi bien à la saisie de la search bar qu'aux entrées de l'historique du presse-papier. Une chaîne opaque jugée sensible (token, clé) n'est **jamais** décodée passivement.

Auto-focus à l'ouverture du notch.

---

## Raccourcis

| Raccourci | Action |
|---|---|
| `Ctrl + Shift + Space` | Toggle collapsed / expanded (global, depuis n'importe quelle app) |
| `Ctrl + Alt + V` | Ouvre le notch sur la card Clipboard avec focus sur la recherche (global) |
| `Ctrl + Shift + D` | Toggle Ne pas Déranger (global) |
| `Esc` | Back contextuel (cf. ci-dessous) |
| Bouton souris **Précédent** (XButton1) | Idem `Esc` |
| `Alt` maintenu | Mode Peek (notch à 15 % d'opacité, click-through) |

### Navigation "back" (Esc et bouton souris Précédent)

Le comportement s'adapte au contexte :

- Un panel ouvert (GitLab, Settings module page, etc.) → ferme ce panel.
- Une page Settings drilldown → retour à la home Settings.
- Settings home → ferme Settings.
- Mode search actif → vide la query.
- Aucun overlay → collapse le notch.

---

## Settings

Drilldown accessible via l'icône engrenage de la search bar :

- **Apparence** : densité du dashboard (dense / normal / aéré) et **disposition** (éditeur WYSIWYG : déplacer et redimensionner les tuiles directement sur le vrai dashboard).
- **Système** : démarrage automatique avec Windows, bouton « Quitter WinNotch » pour fermer l'application.
- **Recherche** : éditeurs des **Quicklinks & bangs** (`!`) et des **Snippets** (`:`).
- **Notifications** : toggle Ne pas Déranger.
- **À propos** : version installée, état des mises à jour, bouton "Vérifier".
- **Modules** : activer/désactiver chaque module, configuration détaillée par module (en drilldown).

### Disposition du dashboard

Chaque tuile (Tasks, Meetings, Music, GitLab, Claude, Git local…) occupe N colonnes sur 12. Tant que la somme d'une rangée tient sous 12, les tuiles restent côte à côte ; sinon elles passent automatiquement à la rangée suivante.

La page **Disposition** est un éditeur en mode WYSIWYG : on y voit les vraies tuiles, telles qu'elles s'affichent dans le dashboard, et on les édite directement —

- **Déplacer** : glisser une tuile par sa poignée (coin haut-gauche).
- **Redimensionner** : tirer le bord droit d'une tuile pour ajuster sa largeur (1 à 12 colonnes), avec un badge `N/12` qui suit le geste. Au clavier : flèches ←/→ sur la poignée de resize.
- Seules les tuiles **actuellement visibles** sont éditables (les modules désactivés ou sans données conservent leur place mais n'apparaissent pas). Bouton "Réinitialiser" pour revenir au layout d'origine.

**Contenu adaptatif** : le contenu de chaque tuile s'ajuste à sa largeur. Par exemple la card **Système** affiche CPU / RAM / NET sur une seule ligne quand la tuile est large, et les empile verticalement quand elle est étroite. Les autres cards multi-colonnes se réagencent de la même manière : stats GitLab, jauge d'usage Claude, actions Teams, lecteur **Musique** (pochette réduite puis empilée) et **rendez-vous** (heure + titre + participants empilés).

Les réglages sont persistés dans `%APPDATA%/WinNotch/config.json` (build installé) ou `%APPDATA%/WinNotch-dev/config.json` (mode `npm run dev`) — les deux ne se mélangent pas.

---

## Structure du code

```
src/
├─ main/                    Process Electron — IPC, modules backend, fenêtre
│  ├─ window/               BrowserWindow + suivi multi-écrans
│  ├─ ipc/                  Handlers IPC (mouse capture, etc.)
│  ├─ modules/              Un dossier par module (audio, music, gitlab, ...)
│  └─ shortcuts/            Raccourcis globaux + listener Alt (Peek)
├─ preload/                 Pont sécurisé window.notch.* (contextBridge)
├─ renderer/                Process UI — React 18 + Context par module
│  ├─ components/Notch/     Shell : Notch, CollapsedRow, ExpandedDashboard
│  ├─ modules/              Un dossier par module miroir du main
│  ├─ hooks/                Hooks transverses (hit-test, peek, keyboard, back)
│  └─ styles/               CSS par module (tokens + reset + un fichier par feature)
└─ shared/types.ts          Contrat IPC partagé + types métier (source de vérité)
```

L'ajout d'un nouveau module suit ce patron : un dossier `main/modules/<id>/` + un dossier `renderer/modules/<id>/` + un Context + des canaux IPC déclarés dans `shared/types.ts`.

---

## Modes spéciaux

### Mode Ne pas Déranger
Masque les chips de **notifications** et bloque les toasts. Indicateur visuel : icône lune dans le notch rétracté. Toggle via `Ctrl + Shift + D` ou dans Settings.

**Comportement par chip** :

| Chip | En DND | Pourquoi |
|---|---|---|
| Meeting | masquée | notification (RDV imminent) |
| GitLab | masquée | notification (MR / issues) |
| Git local | masquée | notification (repos dirty) |
| Claude | masquée | notification (sessions actives) |
| VPN | **visible** | état système — l'utilisateur veut savoir en permanence si son tunnel est actif |
| Teams (présence) | **visible** | état système — la pastille reste pertinente même en DND, surtout avec le couplage bidirectionnel `Ctrl+Shift+D ↔ Teams DoNotDisturb` |
| Système (CPU/RAM/Net) | **visible** | état système — la jauge est utile même pendant une démo |
| Imprimante 3D (Bambu) | **visible** | état d'impression — surveiller un print de plusieurs heures prime sur le DND |
| Music | non affectée | la chip est dans `cr-left`, pas une notification |
| Clipboard | non affectée | rappel passif d'historique, pas une notification |

### Mode Peek
Maintenir `Alt` rend le notch à 15 % d'opacité et le rend click-through complet. Utile pour vérifier ce qui se trouve derrière sans avoir à le rétracter.

### Masquage plein écran
Quand une fenêtre fullscreen (vidéo, jeu, présentation) occupe l'écran principal, le notch rétracté est automatiquement masqué. Il reste visible si l'utilisateur l'a ouvert volontairement.

---

## Build & lancement

```bash
npm install                # installe les dépendances + binaires natifs prebuilt
npm run dev                # lance Electron en mode dev (HMR renderer)
npm run typecheck          # tsc strict sur main + renderer
npm run dist:win           # construit l'installer NSIS dans dist/
```

L'installer généré (`dist/WinNotch-Setup-x.y.z.exe`) est un wizard NSIS classique. Installation per-user (pas besoin d'élévation), désinstallation propre via Programmes et fonctionnalités.

> **Instance unique** : une seule instance de WinNotch tourne à la fois. Relancer l'app (ou la lancer alors qu'elle a déjà démarré à l'ouverture de session) ne crée pas de second notch — la tentative redonne simplement le focus à l'instance en place. Cela évite d'empiler des fenêtres flottantes qui alourdiraient l'affichage.

---

## Démarrage automatique avec Windows

WinNotch peut se lancer à l'ouverture de session. Le réglage normal se fait dans **Notch → Paramètres → Système → « Démarrer avec Windows »**, qui crée une tâche planifiée `WinNotch` dans le Planificateur de tâches.

### Si un antivirus bloque l'activation

Certains antivirus / EDR d'entreprise empêchent l'application de créer la tâche (l'activation échoue alors avec un toast d'erreur, ex. `spawn EPERM`). Tu peux créer la tâche **manuellement** — deux méthodes au choix.

**A. PowerShell** — ouvre un PowerShell standard (pas besoin d'admin) et colle ce bloc :

```powershell
$exe  = "$env:LOCALAPPDATA\Programs\WinNotch\WinNotch.exe"
$user = "$env:USERDOMAIN\$env:USERNAME"
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Démarre WinNotch à l'ouverture de session.</Description>
    <URI>\WinNotch</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>$user</UserId></LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$user</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>"$exe"</Command></Exec>
  </Actions>
</Task>
"@
$f = Join-Path $env:TEMP 'winnotch-task.xml'
[System.IO.File]::WriteAllText($f, $xml, [System.Text.Encoding]::Unicode)
schtasks /Create /TN "WinNotch" /XML $f /F
Remove-Item $f
```

> Le fichier XML **doit** être encodé en UTF-16 (`[System.Text.Encoding]::Unicode`), sinon `schtasks /XML` le rejette.

**B. Interface graphique** (`taskschd.msc`) :

1. `Win + R` → `taskschd.msc`.
2. **Créer une tâche…** (pas « tâche de base »).
3. **Général** : nom `WinNotch` ; laisser « Exécuter seulement si l'utilisateur est connecté ».
4. **Déclencheurs** → Nouveau → « À l'ouverture de session ».
5. **Actions** → Nouveau → « Démarrer un programme » → `%LOCALAPPDATA%\Programs\WinNotch\WinNotch.exe`.
6. **Conditions** → décoche « Ne démarrer la tâche que si l'ordinateur est sur secteur » (sinon pas de démarrage sur batterie).
7. **Paramètres** → décoche « Arrêter la tâche si elle s'exécute plus de… ».

**Vérifier / supprimer** :

```powershell
schtasks /Query  /TN WinNotch /V /FO LIST
schtasks /Delete /TN WinNotch /F
```

Après une création manuelle, ne re-bascule pas le toggle dans l'app (il retenterait l'opération que l'antivirus bloque) — la tâche existante est détectée comme cohérente au prochain démarrage.

---

## Stack technique

- **Electron 41** (Chromium M146, Node 22.x) — supporte les courbes spring CSS natives.
- **electron-vite** — build / dev avec HMR renderer et reload main.
- **electron-store** — persistance des Settings dans `config.json`.
- **electron-updater** — mises à jour automatiques via GitHub Releases.
- **`@coooookies/windows-smtc-monitor`** — bindings napi-rs pour les sessions media Windows.
- **`@nut-tree-fork/libnut-win32`** — bindings natifs N-API pour l'envoi des touches média (play/pause, suivant, précédent).
- **`loudness`** — binaire Core Audio bundlé pour le volume système (lecture volume+muted en un seul spawn via `getVolumeInfo`).
- **`SoundVolumeView.exe`** (NirSoft, bundlé) — énumération + changement du device de sortie. Appelé uniquement à la demande (ouverture du panneau audio, changement de device) avec cache 30 s — plus de spawn périodique. Au démarrage automatique (login), où le service audio n'est pas toujours prêt, un warm-up relance l'énumération à délais croissants jusqu'à ce que la liste des sorties se remplisse, et le circuit breaker de secours se réarme tout seul (plus de liste « Aucune sortie » bloquée jusqu'au redémarrage).
- **Workspaces VS Code récents** — dérivés du scan de `%APPDATA%/Code/User/workspaceStorage` (fichiers `workspace.json`, tri par récence), 100 % `fs`, sans dépendance native. Les versions récentes de VS Code (1.10x+) ne stockent plus le MRU dans `state.vscdb`.
- **Détection `Alt` (mode Peek)** — polling `GetAsyncKeyState` dans le PowerShell résident du détecteur fullscreen (`resources/ps/fullscreen-detector.ps1`). Plus aucun hook clavier global : l'ancien `node-global-key-listener` (WH_KEYBOARD_LL) faisait transiter chaque frappe du PC par l'event loop de l'app, ajoutant de la latence clavier système dès que le main était chargé.

---

## Limitations connues

- **Claude Code** : les writes du fichier `.jsonl` sont bufferisés par Claude Code. Le toast "Claude attend une réponse" n'arrive donc qu'au moment où l'utilisateur répond (l'event est écrit à ce moment-là). Le toast de fin de session reste fiable car le buffer est flushé sur `end_turn`.
- **Icône dans le gestionnaire des tâches** : Windows cache les icônes par chemin d'exe. Après une réinstallation, l'ancienne icône peut persister jusqu'au prochain rebuild du cache (`Stop-Process explorer ; Remove-Item iconcache_*.db ; Start-Process explorer`).
- **Polling GitLab vs webhooks** : le module est en polling (par défaut 120 s). Pour du temps réel, il faudrait un serveur webhook intermédiaire — hors scope.

---

## Notes internes

Documentation des procédures internes (release auto-update, fix du cache `winCodeSign`, flags de diagnostic, pièges des modules natifs, etc.) dans `README.md.local` — non versionné, à demander à un mainteneur.

---

## Licence

[MIT](LICENSE) © 2026 Jeremy Bolzonella
