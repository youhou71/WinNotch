/**
 * Card Music compact du dashboard étendu.
 *
 * Reproduit fidèlement le pattern `card-music.is-compact` du prototype
 * (notch-modules.jsx lignes 43-71) : pochette 48px à gauche, méta +
 * scrubber + 3 boutons (prev/play/next) à droite.
 *
 * Les contrôles passent par les touches média virtuelles (cf. mediaKeys.ts
 * côté main). Pas de slider de scrubber draggable en Phase 2 : SMTC ne
 * permet pas le seek, on se contente d'afficher la progression.
 *
 * Animation : le state IPC n'expose qu'un anchor (position, duration,
 * updatedAt). La progression visuelle est calculée localement à 60 fps
 * via `requestAnimationFrame` et appliquée *imperatively* au DOM —
 * `style.width` du fill et `textContent` du elapsed — pour éviter de
 * re-render React à chaque frame.
 */
import { useEffect, useRef } from 'react';
import { useMusicContext } from './MusicContext';
import { getMusicSourceMeta } from './musicSourceMeta';

function formatElapsed(seconds: number): string {
  // Defense-in-depth : si seconds n'est pas un nombre fini, on retombe sur
  // 0:00 — éviter d'afficher "NaN:NaN" si l'anchor venait à être pourri.
  if (!Number.isFinite(seconds)) return '0:00';
  const abs = Math.max(0, Math.floor(seconds));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MusicCard() {
  const { state, playPause, next, previous } = useMusicContext();
  const fillRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);

  // Animation rAF : recalcule la position interpolée à chaque frame à
  // partir de l'anchor du state, et met à jour le DOM directement.
  // Re-déclenché quand l'anchor change (track switch, play/pause, seek).
  useEffect(() => {
    if (!state.title) return;

    let frameId = 0;
    let lastSec = -1;

    // Sanitize : si l'anchor contient des valeurs non-finies (cas vu avec
    // certaines sources SMTC qui renvoient NaN pour la timeline), on
    // retombe sur des zéros pour éviter de propager le NaN à `style.width`
    // et au textContent.
    const anchorPos = Number.isFinite(state.position) ? state.position : 0;
    const anchorDur = Number.isFinite(state.duration) ? state.duration : 0;
    const anchorAt = Number.isFinite(state.updatedAt) ? state.updatedAt : 0;

    const tick = (): void => {
      const elapsedFromAnchor =
        state.playing && anchorAt > 0 ? (Date.now() - anchorAt) / 1000 : 0;
      const positionNow =
        anchorDur > 0
          ? Math.min(anchorPos + elapsedFromAnchor, anchorDur)
          : anchorPos + elapsedFromAnchor;

      if (fillRef.current) {
        const pct = anchorDur > 0 ? (positionNow / anchorDur) * 100 : 0;
        fillRef.current.style.width = pct + '%';
      }

      // Le texte ne change qu'à l'entier de seconde près → on évite les
      // 60 writes/s du textContent inutiles.
      const sec = Math.floor(positionNow);
      if (sec !== lastSec && elapsedRef.current) {
        elapsedRef.current.textContent = formatElapsed(sec);
        lastSec = sec;
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [state.title, state.playing, state.position, state.duration, state.updatedAt]);

  // Si aucune lecture détectée, on ne rend rien — l'ExpandedDashboard fait
  // déjà le rendu conditionnel mais ce garde-fou évite un flicker au mount
  // pendant que `getState` est en vol.
  if (!state.title) return null;

  const sourceMeta = state.source ? getMusicSourceMeta(state.source) : null;

  return (
    <div className="card card-music is-compact">
      <div className="mc-compact-cover">
        {state.thumbnail && (
          <img
            src={state.thumbnail}
            alt=""
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
      </div>
      <div className="mc-compact-body">
        <div className="mc-row">
          <div className="mc-meta">
            <div className="mc-title">{state.title}</div>
            <div className="mc-artist">
              {state.artist}
              {state.album && ` · ${state.album}`}
            </div>
            {sourceMeta && (
              <div className="mc-source">
                <i
                  className={sourceMeta.icon}
                  style={sourceMeta.color ? { color: sourceMeta.color } : undefined}
                />
                <span>{sourceMeta.label}</span>
              </div>
            )}
          </div>
          <div className="mc-controls">
            <button
              type="button"
              className="ctl"
              title="Précédent"
              onClick={() => void previous()}
            >
              <i className="fa-solid fa-backward-step"></i>
            </button>
            <button
              type="button"
              className="ctl play"
              title={state.playing ? 'Pause' : 'Lecture'}
              onClick={() => void playPause()}
            >
              <i className={'fa-solid ' + (state.playing ? 'fa-pause' : 'fa-play')}></i>
            </button>
            <button
              type="button"
              className="ctl"
              title="Suivant"
              onClick={() => void next()}
            >
              <i className="fa-solid fa-forward-step"></i>
            </button>
          </div>
        </div>
        <div className="mc-scrub">
          <div className="mc-scrub-bar">
            <div ref={fillRef} className="mc-scrub-fill"></div>
          </div>
          <span ref={elapsedRef} className="mc-elapsed">0:00</span>
          {state.duration > 0 && (
            <span className="mc-duration">{' / ' + formatElapsed(state.duration)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
