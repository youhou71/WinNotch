# Changelog

Toutes les évolutions notables de WinNotch.

Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versioning [SemVer](https://semver.org/lang/fr/).

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
