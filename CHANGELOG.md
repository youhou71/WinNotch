# Changelog

Toutes les évolutions notables de WinNotch.

Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versioning [SemVer](https://semver.org/lang/fr/).

## [Unreleased]

### Fixed

- **Icône WinNotch qui apparaissait parfois dans la barre des tâches au lancement.** La fenêtre était déjà créée avec `skipTaskbar: true`, mais cette option ne fait, sur Windows, que demander un retrait **a posteriori** (`ITaskbarList::DeleteTab`) : le shell crée d'abord le bouton, Electron le supprime juste après. Quand la barre des tâches n'est pas encore prête à cet instant — typiquement au démarrage de session, WinNotch étant lancé par la tâche planifiée pendant qu'`explorer.exe` initialise encore la sienne — le retrait se perd et le bouton reste, d'où le caractère intermittent, aléatoire d'un démarrage à l'autre. La fenêtre est désormais déclarée en **tool window** (`type: 'toolbar'`, soit le style natif `WS_EX_TOOLWINDOW`) : Windows ne lui crée jamais de bouton, quel que soit le timing, et n'en recrée pas davantage après un redémarrage d'`explorer.exe`. `skipTaskbar` est conservé et ré-affirmé à l'affichage, à la prise de focus et à la restauration, en filet. **Contrepartie assumée** : une tool window ne figure pas non plus dans **Alt+Tab** ni dans l'Aero Peek — cohérent pour un overlay always-on-top qui se pilote au clic et aux raccourcis globaux (`Ctrl + Shift + Space`).
- **Alt-Peek et masquage plein écran ne démarraient plus du tout (régression).** Une sonde du mode de langage PowerShell, ajoutée quand le détecteur ne pouvait être qu'un script (`Add-Type` interdit en `ConstrainedLanguage`), interrompait le démarrage sur les postes bridés — précisément ceux où la voie native introduite ensuite fonctionne. Résultat : ni le détecteur natif ni le repli n'étaient lancés, et le mode Peek restait muet. Le choix de l'implémentation appartient désormais au seul `startFullscreenDetector()`, qui préfère le natif et ne retombe sur le script qu'en cas d'indisponibilité réelle ; la sonde, devenue inutile, est supprimée.
- **Alt-Peek et masquage plein écran réparés sur les postes bridés par AppLocker/WDAC.** Ces deux fonctions reposaient sur `fullscreen-detector.ps1`, qui fait du P/Invoke `user32` via `Add-Type` — interdit en `ConstrainedLanguage`, le mode qu'une politique d'entreprise impose aux scripts situés sous `%LOCALAPPDATA%`, donc à l'application installée. Contrairement aux autres scripts, celui-ci ne pouvait pas être rendu compatible : définir un type est interdit par conception dans ce mode. Les API Windows concernées (`GetForegroundWindow`, `GetWindowRect`, `GetWindowThreadProcessId`, `GetAsyncKeyState`) sont donc désormais appelées **directement dans le process** via `koffi` (FFI), ce qui échappe entièrement au mode de langage PowerShell — et supprime au passage le dernier processus résident du détecteur. Le repli PowerShell reste en place et prend le relais si la couche native est indisponible ; deux variables d'environnement permettent de forcer l'un ou l'autre chemin pour comparaison (`WINNOTCH_FORCE_PS_DETECTOR`, `WINNOTCH_FORCE_NATIVE_DETECTOR`). Cadences inchangées (Alt toutes les 75 ms, fenêtre toutes les 750 ms) : le coût mesuré est de ~1 µs par appel, soit 0,002 % d'un cœur.
- **Claude Usage — installation du wrapper de statusline en échec (`ENOENT`) sur l'app installée.** `resources/winnotch-statusline.cjs` n'était **pas déclaré dans `extraResources`** : il n'existait donc que dans le dépôt. En développement le fichier est résolu depuis `app.getAppPath()/resources` et tout fonctionnait ; une fois l'application packagée, `wrapperSourcePath()` pointe vers `process.resourcesPath`, où le fichier n'avait jamais été copié — d'où l'`ENOENT` à l'installation, et un `winnotch-usage.json` qui cessait d'être alimenté (chiffres d'usage figés). Le wrapper est désormais embarqué comme les autres ressources. Le message d'erreur, jusque-là un `ENOENT` brut qui laissait croire à un problème du côté de `~/.claude`, nomme maintenant le fichier attendu et sa cause.
- **Alt-Peek et détection plein écran : plus de spawn voué à l'échec sur poste bridé.** `fullscreen-detector.ps1` fait du P/Invoke `user32` via `Add-Type`, ce que `ConstrainedLanguage` interdit par conception — contrairement aux autres scripts, il ne peut donc pas être rendu compatible. Le mode de langage est désormais sondé une fois au démarrage ; s'il n'est pas `FullLanguage`, le détecteur n'est pas lancé et un avertissement explicite le signale, au lieu de spawner un `powershell.exe` qui meurt aussitôt en laissant un Alt-Peek muet. La sonde ne coûte **aucun spawn supplémentaire** : elle passe par le PowerShell résident, qui subit la même politique, et se réduit à un accès de propriété autorisé dans tous les modes. Si la sonde n'aboutit pas, le comportement précédent est conservé — on ne désactive rien sur une supposition.
- **Modules Système (réseau), Confidentialité et VPN réparés sur les postes bridés par AppLocker.** Sur ces machines, `persistent-loop.ps1` s'exécute en `ConstrainedLanguage` (mode imposé aux scripts sous `%LOCALAPPDATA%`, donc à l'app **installée** — le même fichier lancé depuis le dépôt tourne en `FullLanguage`, ce qui rendait le bug invisible en développement). Or la boucle reposait sur `[Console]::In.ReadLine()`, interdit dans ce mode : l'appel renvoyait `$null` dès la première itération, le script sortait immédiatement, et **le débit réseau restait à 0 B/s, le témoin caméra/micro ne s'allumait jamais et le VPN n'était jamais détecté** — le tout en relançant un `powershell.exe` par seconde. Le protocole d'échange a été refait sans aucune primitive interdite : lecture de stdin via `$input` (streaming vérifié), exécution par `Invoke-Expression`, transport en JSON une-ligne à la place du base64 (`[Convert]::FromBase64String` est lui aussi interdit), et échappement `\uXXXX` des non-ASCII dans les deux sens pour rester indépendant de la page de code de la console. Les scripts métier ont été alignés : plus de `[pscustomobject]` (interdit en CLM, remplacé par des tables de hachage — le JSON produit est équivalent) ni de `$OutputEncoding = [System.Text.Encoding]::UTF8`. Validé en conditions réelles depuis un emplacement où AppLocker force le CLM : les trois scripts répondent dans un **seul** process, réseau à 6,7 s au premier appel puis **289 ms** à chaud.

### Performance

- **Audio — polling suspendu quand le notch est replié (~−41 000 process/jour).** Le cycle de 2 s tournait en permanence, y compris notch fermé, session verrouillée ou jeu en plein écran, et chacun spawne le binaire `loudness` : 43 200 créations de processus par jour pour alimenter une interface que personne ne regarde — `AudioFooter` n'existe que dans le tableau de bord déployé, la rangée repliée n'affiche aucune pastille audio. Le polling ne tourne désormais que notch ouvert, et se resynchronise immédiatement à l'ouverture (liste des périphériques comprise) pour rattraper ce qui a pu changer entre-temps : volume modifié aux touches média, casque branché. Le test porte sur le mode du notch et **non** sur la détection plein écran — celle-ci repose sur un script indisponible en `ConstrainedLanguage`, où elle répondrait toujours « pas en plein écran ».
- **Git local — `git status` relancé seulement quand le dépôt a bougé (−80 % de process, ~−46 000/jour).** Le scan relançait un `git status` sur **chaque** dépôt à **chaque** tick, sans le moindre test de fraîcheur : avec 20 dépôts et un tick de 60 s, cela représentait 20 `git.exe` par minute — et autant de `conhost.exe`, chaque processus console en allouant un — soit ~57 600 créations de processus par jour, toutes scannées par l'antivirus, pour un résultat presque toujours identique. Un `git status` coûtant ici de 0,7 à 1,9 s, le scan complet occupait ~18 s de travail disque par minute. Le statut de chaque dépôt est désormais mémoïsé et réutilisé tant que l'empreinte de son `.git` (mtimes de `index`, `HEAD` et `refs`) n'a pas changé : trois `fs.stat`, mesurés à moins d'une milliseconde pour les 20 dépôts réunis. Comme cette empreinte ne voit pas les modifications du répertoire de travail (éditer un fichier suivi ne touche pas `.git`), un re-scan complet est forcé toutes les 5 minutes — le compteur « non commité » ne peut donc pas rester figé. Un refresh manuel vide le cache, les dépôts en erreur ne sont pas mémoïsés (retentés au tick suivant), et les dépôts disparus sont purgés à chaque scan.
- **Coupe-circuit sur le PowerShell résident — fin d'un relancement en boucle à ~53 spawns/minute.** Sur un poste où AppLocker force `ConstrainedLanguage` pour les scripts situés sous `%LOCALAPPDATA%` (donc pour l'app **installée**, alors que le même script lancé depuis le dépôt tourne en `FullLanguage` — d'où un bug invisible en développement), `persistent-loop.ps1` sortait à sa première ligne interdite, avant même d'avoir lu une requête. Le poller Système la redemandant à 1 Hz, l'app relançait un `powershell.exe` — plus son `conhost.exe` — **environ une fois par seconde**, soit ~69 000 créations de process par jour, chacune interceptée et scannée par l'antivirus/EDR, pour un résultat toujours vide. Mesuré sur machine réelle : 22 instances de `persistent-loop.ps1` en 25 s. Désormais, trois morts prématurées consécutives (moins de 2 s, sans la moindre réponse) ouvrent un coupe-circuit définitif pour la session, avec un avertissement unique en console. Aucune régression : quand il se déclenche, la fonctionnalité est déjà cassée — on cesse simplement d'en payer le coût. Le compteur est réarmé dès qu'une réponse valide est reçue, pour qu'un incident ponctuel (timeout, process tué par l'EDR) ne condamne pas le mécanisme.
- **Lag système « qui s'aggrave au fil du temps » corrigé (fenêtre transparente / MPO).** Diagnostic : la fenêtre transparente always-on-top du notch perturbe le MPO (Multiplane Overlay) de Windows — DWM recompose et bascule overlay↔composition à chaque `setBounds`/repaint → micro-saccades du curseur **sans pic CPU/GPU** (fermer WinNotch supprimait le lag, alors que les compteurs GDI/USER/handles restaient normaux — ce n'était donc pas une fuite mais un coût de composition). Correctifs :
  - **Verrou d'instance unique** (`app.requestSingleInstanceLock`) : empêche deux WinNotch simultanés (autostart + lancement manuel, ou instance dev + app installée), dont les fenêtres transparentes cumulaient leur charge de composition. La 2ᵉ instance quitte et redonne le focus à la 1ʳᵉ.
  - **Moins de `setBounds`** : rectangle identique ignoré (guard d'égalité) + coalescence des raffinements de croissance à l'ouverture (1 resize au lieu de 2-4).
  - **Moins de repaints continus** : les animations des chips toujours visibles (spinners / halos Claude, GitLab, meetings, confidentialité) passent en `steps()` (~10 fps au lieu de 60) ; la Sparkline Système n'émet plus qu'1 tick sur 3 quand le notch est replié ; `will-change` permanent retiré de `.notch`.
  - **Tooltip** : plus de resize de fenêtre quand la bulle tient déjà dans la fenêtre (cas notch ouvert).
- **Fuite mémoire du cache de détails MR GitLab** — le `Map` mémoïsant les détails de MR au survol (`pipeline.ts`) n'était jamais purgé (croissance monotone sur un widget always-on jamais rechargé) ; il est désormais borné à 100 entrées avec éviction LRU douce.

### Fixed

- **Une requête PowerShell lente ne casse plus les autres modules.** Le process PowerShell résident est partagé par les modules Système, Confidentialité, VPN et Audio, et il traite ses requêtes les unes après les autres. Or la première expiration de délai, d'où qu'elle vienne, **tuait ce process** : un module momentanément lent — le plus souvent au démarrage à froid, quand le premier appel paie l'autoload des modules CIM sur une machine que l'antivirus occupe — emportait donc la détection des trois autres avec lui. Le symptôme était trompeur au possible, puisque chaque module rapportait un délai qui n'était pas le sien : `[vpn] détection échouée: timeout (10000 ms)` alors que le VPN, lui, attend 20 s. Une requête expirée est désormais abandonnée **seule** : elle rend la main en erreur à son appelant, sa réponse tardive est ignorée si elle finit par arriver, et les requêtes des autres modules continuent leur chemin. Le filet reste en place pour le cas où la boucle est *réellement* bloquée sur un cmdlet gelé — trois abandons consécutifs **sans la moindre réponse entre-temps** la font relancer — mais un simple ralentissement passager ne déclenche plus rien, puisque toute réponse reçue réarme le compteur. Effet de bord bienvenu : les délais par module n'ont plus besoin d'être surdimensionnés « pour ne pas tuer la boucle », les garder courts fait au contraire réagir ce filet plus vite.
- **Crash « A JavaScript error occurred in the main process » (`write EPIPE`).** Le PowerShell résident partagé par les modules Système (1 Hz), Confidentialité (4 s) et VPN (10 s) n'avait **aucun handler `'error'` sur son `stdin`** — seulement sur le process, `stdout` et `stderr`. Quand la boucle PS mourait entre deux requêtes (timeout d'un module → `resetProc` → `kill()`, ou process tué par l'antivirus/EDR), l'écriture suivante émettait un `EPIPE`. Cet EPIPE est émis de façon **asynchrone**, après le retour de `write()` (d'où `afterWriteDispatched` en tête de pile) : le `try/catch` du site d'appel ne pouvait donc pas l'attraper, le stream escaladait en `uncaughtException`, et l'app entière était perdue pour une simple requête WMI lente. Le test `stdin.writable` ne protégeait pas non plus — vrai à l'instant du contrôle, faux quelques millisecondes plus tard. Symptôme d'autant plus fréquent que la machine est chargée, puisque c'est la charge qui fait dépasser les timeouts. L'erreur est désormais absorbée : la requête en vol est résolue en erreur et le tick suivant relance le process. Deux durcissements associés : les handlers `error` / `exit` / `stdin` sont filtrés sur l'**identité du process émetteur** (un EPIPE tardif de l'ancien pipe ne tue plus le process fraîchement relancé), et un `stdin` déjà fermé force le reset au lieu de laisser tous les appels suivants échouer en « PowerShell indisponible » jusqu'au redémarrage de l'app.
- **Audio — liste des sorties vide (« Aucune sortie ») au lancement automatique.** Au démarrage de session, le service audio Windows et `SoundVolumeView.exe` ne sont pas toujours prêts (scan antivirus/EDR du binaire au 1ᵉʳ spawn, disque saturé) : la 1ʳᵉ énumération échoue ou revient vide. Deux causes corrigées : (1) le **circuit breaker** de SVV était un verrou définitif — après 3 échecs il court-circuitait l'appel *pour toute la vie du process* (le reset n'arrivait que sur un résultat non vide, jamais atteignable puisque SVV n'était plus appelé), d'où une liste vide jusqu'au redémarrage manuel de l'app. Il devient **« half-open »** : ouvert pendant un cooldown de 15 s, puis une tentative d'essai ; succès → refermé, échec → nouveau cooldown, et il se cale sur la *spawnabilité* de SVV et non sur le nombre de périphériques. (2) La liste n'était plus relue qu'à l'ouverture du panneau + TTL 30 s : ajout d'un **warm-up** au boot (et au réveil) qui replanifie des relectures à délais croissants (1/2/4/8/15/30 s) jusqu'à obtenir au moins une sortie, puis push `audio:change` — la liste se remplit d'elle-même dès que le stack audio répond. Le volume/mute (binaire `loudness`) n'était pas affecté, seule la liste des sorties l'était.
- **GitLab — les MR déjà reviewées quittent « à reviewer »** — une MR reste dans le compteur « à reviewer » tant qu'elle est ouverte, même après avoir donné sa review (le filtre REST `reviewer_id` ne tient pas compte de l'état de reviewer). WinNotch récupère désormais cet état via une requête GraphQL (`currentUser.reviewRequestedMergeRequests`) et masque les MR dont **mon** état vaut *relue*, *approuvée* ou *changements demandés*. Robuste sur toutes les éditions (pas de dépendance à l'API d'approbations Premium) ; en cas d'indisponibilité du GraphQL, on retombe silencieusement sur la liste complète (aucune régression).

### Added

- **Type de sortie audio visible dans le notch rétracté.** Une chip affiche l'icône du périphérique vers lequel le son part réellement — casque, micro-casque, haut-parleurs, sortie écran — sans avoir à déployer quoi que ce soit ; le nom de l'appareil, son type et son transport (Bluetooth) sont dans la tooltip, et un clic ouvre le notch sur le sélecteur de sortie. Le type ne vient plus d'une supposition sur le nom de l'appareil (l'ancienne heuristique classait « n'importe quoi contenant *realtek* » en haut-parleurs) mais du **form factor déclaré par le pilote** dans le registre Windows (`MMDevices`), qui distingue aussi le micro-casque et la sortie HDMI/DisplayPort. Cette lecture sert au passage le footer du dashboard, dont les libellés gagnent la mention Bluetooth. **Aucun retour en arrière sur la perf** : le cycle de 2 s qui spawne le binaire `loudness` reste suspendu notch fermé (la chip n'affiche ni volume ni mute, précisément pour ne pas avoir à le relancer — et une valeur non relue serait périmée au premier appui sur une touche média, donc pire qu'absente). Le suivi du périphérique passe par une relecture du registre dans le PowerShell **déjà résident** (mesurée à ~80 ms à chaud pour 20 endpoints, soit ~1,6 % d'occupation de cette boucle), soit zéro création de processus, et n'appelle `SoundVolumeView` que quand la liste des sorties actives a changé — casque branché, appareil Bluetooth connecté, dock — puisque c'est le seul moment où il y a un nouveau périphérique par défaut à découvrir. Un filet de sécurité espacé (5 min par défaut, réglable de 1 à 30 min) couvre le seul cas que le registre ne montre pas : un changement de sortie fait depuis le panneau Windows. Coût en régime : ~288 appels/jour au défaut, contre 43 200 si le polling complet avait été rallumé. `audio` devient un module à part entière dans les réglages (il était implicite) : le désactiver retire la chip **et** le bandeau volume, et arrête tout polling audio.
- **Notch épinglable (copier-coller).** Un bouton punaise dans la barre de recherche verrouille le notch en position ouverte : il ne se referme plus au clic dans une autre fenêtre ni quand il perd le focus, ce qui permet d'aller chercher une valeur ailleurs et de revenir la coller dans les réglages sans perdre la page en cours. L'épinglage rend aussi **le texte sélectionnable à la souris** dans tout le dashboard : sans ça, le verrou global `user-select: none` du shell (qui évite les sélections accidentelles sur un widget) rendait impossible la copie de toute valeur affichée hors champ de saisie — on pouvait coller, jamais copier. Les fermetures explicites (`Esc`, `Ctrl + Shift + Space`) continuent de fonctionner et dépinglent au passage, pour que l'ouverture suivante reparte sur le comportement normal ; l'état n'est pas persisté.
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
