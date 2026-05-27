/**
 * Composant racine du notch (shell visible).
 *
 * Gère :
 *  - les dimensions selon le mode (collapsed/expanded)
 *  - le clic sur le notch (collapsed → expanded)
 *  - le clic à l'extérieur (expanded → collapsed)
 *  - l'animation visuelle "pressing" (scale 0.98 au mousedown)
 *  - l'attribut `data-notch-hit="true"` qui signale au hit-test que le
 *    curseur est en zone interactive
 *  - la largeur dynamique du collapsed selon les modules actifs
 *  - la densité visuelle (data-density) pilotée par les settings
 *
 * Les transitions CSS (width / height / border-radius) sont définies dans
 * `notch.css` avec la courbe spring `linear()` 700 ms.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DashTileId, NotchMode } from '../../../shared/types';
import { useMeetingsContext } from '../../modules/meetings/MeetingsContext';
import { useMusicContext } from '../../modules/music/MusicContext';
import { useClaudeContext } from '../../modules/claude/ClaudeContext';
import { useGitLabContext } from '../../modules/gitlab/GitLabContext';
import { useSettingsContext } from '../../modules/settings/SettingsContext';
import { CollapsedRow } from './CollapsedRow';
import { ExpandedDashboard } from './ExpandedDashboard';

interface NotchProps {
  mode: NotchMode;
  setMode: (updater: (m: NotchMode) => NotchMode) => void;
  peeking: boolean;
  fullscreen: boolean;
}

export function Notch({ mode, setMode, peeking, fullscreen }: NotchProps) {
  const [pressing, setPressing] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const { state: music } = useMusicContext();
  const { next: nextMeeting } = useMeetingsContext();
  const { active: activeClaude } = useClaudeContext();
  const { state: gitlab } = useGitLabContext();
  const { settings } = useSettingsContext();

  // Hauteur réelle du contenu de l'état expanded (`.dashboard` scrollHeight
  // + `.audio-footer` offsetHeight). `null` tant qu'on n'a pas encore
  // mesuré ; dans ce cas on retombe sur l'estimation TILE_H ci-dessous,
  // ce qui évite un flash de notch trop court au moment du passage
  // collapsed → expanded (le DOM n'est pas encore peuplé au 1er render).
  const [contentH, setContentH] = useState<number | null>(null);
  // Hauteur max disponible. Calculée à partir de `window.innerHeight`
  // (= workArea.height, cf. notchWindow.ts qui sizes la fenêtre Electron
  // sur la workArea). Stockée en state pour suivre les redimensionnements
  // d'écran (changement de display, resize, DPI…).
  const [maxH, setMaxH] = useState(() => Math.max(360, window.innerHeight - 100));

  // Click outside → collapse. Listener attaché seulement en mode expanded
  // pour économiser les re-render.
  useEffect(() => {
    if (mode !== 'expanded') return;
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setMode(() => 'collapsed');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [mode, setMode]);

  // Suit les variations de hauteur de la fenêtre (l'utilisateur change
  // d'écran principal, branche un écran de hauteur différente, change la
  // DPI ou la résolution → notchWindow.ts resize la fenêtre Electron, ce
  // qui propage un `resize` côté renderer).
  useEffect(() => {
    const onResize = () =>
      setMaxH(Math.max(360, window.innerHeight - 100));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Mesure du contenu réel pour dimensionner le notch au plus juste.
  // Trois observers complémentaires sont nécessaires car :
  //  - `.dashboard` est `flex: 1` → sa contentBox ne change PAS quand son
  //    contenu interne change (ouverture de Settings/panel GitLab/etc.).
  //    Un ResizeObserver dessus ne tire donc pas sur les changements de
  //    page interne — seul son `scrollHeight` varie.
  //  - Les états de page (`settingsOpen`, `gitlabPanelOpen`, …) vivent
  //    dans `ExpandedDashboard`, pas dans `Notch`. Un useEffect ici ne
  //    re-tire donc pas quand l'utilisateur change de page.
  //
  // Solution :
  //  - MutationObserver sur le sous-arbre du notch → détecte tout
  //    ajout/suppression de nœud (changement de page, banner DND…) et
  //    déclenche une remesure.
  //  - ResizeObserver sur les enfants directs du `.dashboard` (re-attaché
  //    à chaque mutation) → capture les changements de taille naturelle
  //    de la vue en cours (panel qui grandit, card qui s'étire…).
  //  - ResizeObserver sur le `.audio-footer` → variation de hauteur du
  //    footer (rare mais possible si on ajoute un disclosure).
  //
  // En mode collapsed on ne mesure pas (le contenu expanded n'est pas
  // monté) et on remet contentH à null pour rebenchmark au prochain
  // passage expanded.
  useLayoutEffect(() => {
    if (mode !== 'expanded') {
      if (contentH !== null) setContentH(null);
      return;
    }
    const root = wrapperRef.current;
    if (!root) return;

    const measure = () => {
      const dashboard = root.querySelector<HTMLElement>('.dashboard');
      const footer = root.querySelector<HTMLElement>('.audio-footer');
      if (!dashboard) return;
      // Pourquoi pas juste `dashboard.scrollHeight` ? Quand le contenu
      // rentre dans le container, Chromium plafonne scrollHeight à
      // clientHeight — donc en quittant une page longue (Settings) pour
      // une page courte (dashboard), scrollHeight reste collé à l'ancienne
      // hauteur tant que le notch n'a pas rétréci. Boucle vicieuse.
      //
      // Solution : sommer les `scrollHeight` des enfants directs du
      // dashboard + paddings + gap flex. Pré-requis CSS : ces enfants
      // (.settings-view, .gitlab-panel, .gitlocal-panel, .clipboard-view,
      // .dash-grid, .search-bar, .dnd-banner) doivent prendre leur
      // hauteur naturelle (pas de `flex: 1; min-height: 0`). Garanti par
      // les modifs CSS associées.
      const cs = getComputedStyle(dashboard);
      const padTop = parseFloat(cs.paddingTop) || 0;
      const padBottom = parseFloat(cs.paddingBottom) || 0;
      const gap = parseFloat(cs.rowGap || cs.gap || '0') || 0;
      const children = Array.from(dashboard.children) as HTMLElement[];
      let h = padTop + padBottom;
      for (let i = 0; i < children.length; i++) {
        h += children[i].scrollHeight;
        if (i > 0) h += gap;
      }
      h += footer?.offsetHeight ?? 0;
      setContentH((prev) => (prev === h ? prev : h));
    };

    const ro = new ResizeObserver(measure);

    /**
     * (Re)attache le ResizeObserver à la structure courante : enfants
     * directs du dashboard + footer. Appelé à chaque mutation pour
     * suivre les changements de page (Settings remplace dash-grid, etc.).
     */
    const attach = () => {
      ro.disconnect();
      const dashboard = root.querySelector<HTMLElement>('.dashboard');
      const footer = root.querySelector<HTMLElement>('.audio-footer');
      if (dashboard) {
        for (const child of Array.from(dashboard.children)) {
          ro.observe(child);
        }
      }
      if (footer) ro.observe(footer);
    };

    // Mesure et attache initiale.
    attach();
    measure();

    // Mutations du sous-arbre → réattache + remesure. Coalescées en
    // microtask par le navigateur, donc pas de spam.
    const mo = new MutationObserver(() => {
      attach();
      measure();
    });
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  });

  // Largeur collapsed dynamique selon les modules actifs et leur état.
  // 124 = largeur de base (notch vide).
  //  +80 si chip Music
  //  +54 si chip Meeting (pill avec countdown ou heure)
  //  +36 si chip Claude (icône + badge)
  //  +36 si chip GitLab (icône + badge)
  //  +38 si chip DND (qui remplace toutes les chips droite)
  //
  // Les valeurs sont des estimations volontairement larges (icône réelle
  // ~18 px + gap 14 px = 32 px) pour que le shell ne coupe jamais une chip,
  // même lors d'animations de width.
  const musicCfg = settings.moduleConfig.music;
  const meetingsCfg = settings.moduleConfig.meetings;
  const hasMusicChip =
    settings.modules.music &&
    musicCfg.collapsed &&
    (!musicCfg.hideWhenStopped || !!music.title);
  const hasMeetingChip =
    !settings.dnd &&
    settings.modules.meetings &&
    meetingsCfg.collapsed &&
    !!nextMeeting;
  const claudeCfg = settings.moduleConfig.claude;
  const hasClaudeChip =
    !settings.dnd &&
    settings.modules.claude &&
    claudeCfg.collapsed &&
    activeClaude.length > 0;
  const gitlabCfg = settings.moduleConfig.gitlab;
  const hasGitlabChip =
    !settings.dnd &&
    settings.modules.gitlab &&
    gitlabCfg.collapsed &&
    gitlab.configured &&
    (gitlab.watchedIssues.length > 0 ||
      gitlab.toReview.length > 0 ||
      gitlab.mine.length > 0);
  const hasDndChip = settings.dnd;
  const collapsedW =
    124 +
    (hasMusicChip ? 80 : 0) +
    (hasMeetingChip ? 54 : 0) +
    (hasClaudeChip ? 36 : 0) +
    (hasGitlabChip ? 36 : 0) +
    (hasDndChip ? 38 : 0);

  // Estimation a priori utilisée *uniquement* comme fallback avant la
  // première mesure DOM (la frame du passage collapsed → expanded). Une
  // fois la mesure réelle disponible (`contentH`), elle prend le relais.
  //
  // On reconstruit la même simulation que côté layout : somme des hauteurs
  // max par rangée (dashboardLayout en colonnes 1..12, wrap quand on
  // dépasse 12). Les hints reflètent la hauteur observée des cards en
  // mode compact ; meetings et claude un peu plus grands car peuvent
  // afficher 1-2 entrées internes (meeting suivant + agenda, sessions
  // Claude actives).
  const TILE_H: Record<DashTileId, number> = {
    tasks: 122,
    meetings: 150,
    music: 130,
    gitlab: 140,
    claude: 200,
    gitlocal: 122,
    vpn: 122,
  };
  const hasMusicCard = settings.modules.music && !!music.title;
  const hasClaudeCard =
    settings.modules.claude &&
    claudeCfg.showCard &&
    activeClaude.length > 0;
  let layoutH = 0;
  let rowCols = 0;
  let rowMax = 0;
  for (const tile of settings.dashboardLayout) {
    if (!settings.modules[tile.id]) continue;
    if (tile.id === 'music' && !hasMusicCard) continue;
    if (tile.id === 'claude' && !hasClaudeCard) continue;
    const cols = Math.max(1, Math.min(12, tile.cols));
    if (rowCols + cols > 12) {
      layoutH += rowMax;
      rowCols = 0;
      rowMax = 0;
    }
    rowCols += cols;
    rowMax = Math.max(rowMax, TILE_H[tile.id]);
  }
  layoutH += rowMax;
  // Base 200 = search bar (40) + audio footer (60) + paddings + gaps
  // internes du dashboard.
  const estimatedH = 200 + layoutH + (settings.dnd ? 70 : 0);

  // Hauteur effective : mesure réelle si dispo, sinon estimation.
  // Clamp [MIN_H, maxH] :
  //  - MIN_H garantit une fenêtre lisible même quand tout est éteint /
  //    en mode DND / search bar seule (sinon le notch deviendrait une
  //    bande ~120 px peu utilisable).
  //  - maxH = window.innerHeight - 100, suit la workArea de l'écran
  //    principal (cf. notchWindow.ts).
  const MIN_H = 280;
  const expandedH = Math.max(
    MIN_H,
    Math.min(contentH ?? estimatedH, maxH),
  );

  const geom =
    mode === 'expanded'
      ? { w: 580, h: expandedH, r: 26 }
      : { w: collapsedW, h: 34, r: 12 };

  // Masquage automatique en plein écran : on cache la chip rétractée
  // pour ne pas perturber l'utilisateur (vidéo, jeu, présentation…).
  // En mode expanded on garde le notch visible — l'utilisateur l'a
  // ouvert volontairement via Ctrl+Shift+Space, c'est intentionnel.
  const hideForFullscreen = fullscreen && mode === 'collapsed';

  const classes = ['notch'];
  if (pressing) classes.push('is-pressing');
  if (peeking) classes.push('is-peeking');
  if (hideForFullscreen) classes.push('is-fullscreen-hidden');

  return (
    <div className="notch-host">
      <div
        ref={wrapperRef}
        className={classes.join(' ')}
        data-mode={mode}
        data-density={settings.density}
        data-notch-hit="true"
        style={{
          width: geom.w + 'px',
          height: geom.h + 'px',
          // Coins arrondis bas uniquement (le notch "sort" du bord
          // supérieur de l'écran).
          borderRadius: `0 0 ${geom.r}px ${geom.r}px`,
        }}
        onMouseDown={() => mode === 'collapsed' && setPressing(true)}
        onMouseUp={() => setPressing(false)}
        onMouseLeave={() => setPressing(false)}
        onClick={() => mode === 'collapsed' && setMode(() => 'expanded')}
      >
        <div className="notch-inner">
          {mode === 'collapsed' ? (
            <CollapsedRow />
          ) : (
            <ExpandedDashboard
              onSearchAction={() => setMode(() => 'collapsed')}
            />
          )}
        </div>
      </div>
    </div>
  );
}
