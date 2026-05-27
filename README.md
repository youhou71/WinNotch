# WinNotch

Widget système flottant pour Windows 11 inspiré du Dynamic Island d'iOS. WinNotch est une "notch" toujours au sommet de l'écran principal qui s'étend en un dashboard riche au clic ou via raccourci global.

> Stack : Electron 32 · electron-vite · React 18 · TypeScript strict.

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

### Claude Code
Détecte automatiquement les sessions Claude Code en cours sur la machine (sans configuration) via le file watcher sur `~/.claude/projects/`. Indicateurs visuels d'activité, toast à la fin d'une session, et badge "?" jaune quand Claude attend une réponse utilisateur.

### GitLab
Suit les **MR à reviewer**, **mes MR ouvertes**, et **issues critiques non assignées** (labels surveillés, ex. `Severity::Critique`). Chip avec badge rouge pulse pour les issues à prendre. Dashboard compact à 3 chiffres, panel plein dashboard au clic, clic sur une ligne ouvre dans le navigateur. Toasts pour les nouvelles MR assignées et les nouvelles issues critiques.

Configuration : URL d'instance + Personal Access Token (scope `read_api`), chiffré localement.

### Git local
Scanne des dossiers racines configurés pour trouver les repos Git locaux et rappelle passivement ceux qui ont des modifs non poussées. Card compacte avec deux totaux (`dirty` / `repos`), panel plein dashboard listant chaque repo avec branche, fichiers non commités, commits ahead/behind. Chip discrète dans le notch rétracté quand au moins un repo est sale.

Clic sur un repo : auto-détection — un `.sln`/`.slnx` à la racine ouvre **Visual Studio** (association de fichier Windows), sinon **VS Code** (`code -n <path>`).

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

Recherche, épinglage, masquage automatique des secrets détectés (tokens, passwords). Limite par défaut 50 entrées non-épinglées (configurable jusqu'à 200). Raccourci global `Ctrl + Shift + V` pour ouvrir directement la card avec focus sur la recherche.

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
| `>` | Claude Code | Lance `claude "<prompt>"` dans un nouveau terminal Windows |
| `/` | VS Code | Liste les workspaces récents, ouvre via `code <path>` |
| `vs` | Visual Studio | Liste les solutions `.sln`/`.slnx`, ouvre via l'association de fichier |

### Détection de contenu live

Quand le contenu tapé ou collé ressemble à un type connu, le dashboard bascule sur une vue d'actions adaptée :

| Type détecté | Affichage | Actions |
|---|---|---|
| URL (`https?://…`) | Host + URL complète | Ouvrir dans le navigateur · Copier |
| JSON (`{…}` / `[…]`) | Pretty-print | Copier formaté · Copier compact |
| JWT (`xxx.yyy.zzz`) | Header + payload décodés + expiration | Copier le token · Copier décodé |
| Couleur (`#fff`, `rgb()`, `hsl()`) | Swatch + équivalents | Copier HEX · RGB · HSL |
| Chemin Windows (`C:\…`, UNC) | Basename + chemin complet | Ouvrir dans Explorer · Copier |

Auto-focus à l'ouverture du notch.

---

## Raccourcis

| Raccourci | Action |
|---|---|
| `Ctrl + Shift + Space` | Toggle collapsed / expanded (global, depuis n'importe quelle app) |
| `Ctrl + Shift + V` | Ouvre le notch sur la card Clipboard avec focus sur la recherche (global) |
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

- **Apparence** : densité du dashboard (dense / normal / aéré) et **disposition** (ordre + largeur des tuiles via drag-and-drop sur une grille de 12 colonnes).
- **Système** : démarrage automatique avec Windows, bouton « Quitter WinNotch » pour fermer l'application.
- **Notifications** : toggle Ne pas Déranger.
- **À propos** : version installée, état des mises à jour, bouton "Vérifier".
- **Modules** : activer/désactiver chaque module, configuration détaillée par module (en drilldown).

### Disposition du dashboard

Chaque tuile (Tasks, Meetings, Music, GitLab, Claude, Git local) occupe N colonnes sur 12. Tant que la somme d'une rangée tient sous 12, les tuiles restent côte à côte ; sinon elles passent automatiquement à la rangée suivante. Réorganisation par glisser-déposer (poignée ⋮⋮), bouton "Réinitialiser" pour revenir au layout d'origine.

Les réglages sont persistés dans `%APPDATA%/winnotch/config.json`.

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
Masque toutes les chips de notifications (Meetings, Claude, GitLab) et bloque les toasts. Indicateur visuel : icône lune dans le notch rétracté. Toggle via `Ctrl + Shift + D` ou dans Settings.

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

---

## Stack technique

- **Electron 32** (Chromium 128) — supporte les courbes spring CSS natives.
- **electron-vite** — build / dev avec HMR renderer et reload main.
- **electron-store** — persistance des Settings dans `config.json`.
- **electron-updater** — mises à jour automatiques via GitHub Releases.
- **`@coooookies/windows-smtc-monitor`** — bindings napi-rs pour les sessions media Windows.
- **`loudness`** — wrapper PowerShell pour le volume système.
- **`SoundVolumeView.exe`** (NirSoft, bundlé) — énumération + changement du device de sortie.
- **`better-sqlite3`** — lecture de `state.vscdb` (workspaces VS Code récents).
- **`node-global-key-listener`** — hook clavier global pour la détection `Alt` (mode Peek).

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
