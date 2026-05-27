/**
 * Chip Music affichée dans `.cr-left` du notch rétracté.
 *
 * Reproduit le pattern `MusicChip` du prototype (notch-modules.jsx lignes
 * 22-40) :
 *  - pochette 24×24px avec overlay semi-transparent
 *  - 3 barres animées qui rebondissent quand `playing` (CSS .overlay-bars)
 *  - icône fa-pause sinon
 *  - titre tronqué à 100px à droite
 *
 * Fallback visuel : si l'app ne fournit pas de thumbnail (Spotify peut
 * omettre la cover pendant qu'il charge), un gradient rose/violet/bleu
 * statique défini dans `music.css` prend la place. L'image est masquée
 * via `onError` pour révéler le gradient en-dessous.
 */
import type { CSSProperties } from 'react';
import { useMusicContext } from './MusicContext';
import { NotchTooltip } from '../../components/Tooltip/NotchTooltip';
import { getMusicSourceMeta } from './musicSourceMeta';

const MUSIC_ACCENT: CSSProperties = {
  '--tt-accent': '#f472b6',
  '--tt-accent-fade': 'rgba(244, 114, 182, 0.18)',
} as CSSProperties;

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}


export function MusicChip() {
  const { state } = useMusicContext();

  // Position estimée à l'instant courant (anchor + elapsed depuis updatedAt).
  // On évite un re-render permanent en ne demandant pas l'animation à 60 Hz
  // dans le tooltip — la valeur est figée à l'ouverture, ce qui est OK
  // pour un overlay éphémère.
  const elapsed = state.duration > 0
    ? Math.min(state.duration, state.position + (Date.now() - state.updatedAt) / 1000)
    : 0;

  return (
    <NotchTooltip
      accentStyle={MUSIC_ACCENT}
      content={
        <div className="tt-body">
          <div className="tt-head">
            <i className={state.playing ? 'fa-solid fa-music' : 'fa-solid fa-pause'} />
            <span>{state.playing ? 'lecture en cours' : 'en pause'}</span>
          </div>
          <div className="tt-row-with-thumb">
            {state.thumbnail ? (
              <img src={state.thumbnail} alt="" className="tt-thumb" />
            ) : (
              <div className="tt-thumb" />
            )}
            <div className="tt-row-body">
              <span className="tt-title">{state.title || 'Titre inconnu'}</span>
              {state.artist && <span className="tt-sub">{state.artist}</span>}
              {state.album && <span className="tt-sub">{state.album}</span>}
            </div>
          </div>
          {state.duration > 0 && (
            <div className="tt-meta">
              <span className="tt-meta-pill">
                <i className="fa-regular fa-clock" />
                {fmtTime(elapsed)} / {fmtTime(state.duration)}
              </span>
              {state.source && (() => {
                const meta = getMusicSourceMeta(state.source);
                return (
                  <span className="tt-meta-pill tt-meta-pill-dim">
                    <i
                      className={meta.icon}
                      style={meta.color ? { color: meta.color } : undefined}
                    />
                    {meta.label}
                  </span>
                );
              })()}
            </div>
          )}
        </div>
      }
    >
      <div className="chip chip-music">
        <div className="music-tile" data-playing={state.playing}>
          {state.thumbnail && (
            <img
              className="music-tile-art"
              src={state.thumbnail}
              alt=""
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <div className="music-tile-overlay">
            {state.playing ? (
              <div className="overlay-bars">
                <span></span>
                <span></span>
                <span></span>
              </div>
            ) : (
              <i className="fa-solid fa-pause"></i>
            )}
          </div>
        </div>
        <div className="music-chip-meta">
          <span className="music-chip-title">{state.title}</span>
          {state.artist && (
            <span className="music-chip-artist">{state.artist}</span>
          )}
        </div>
      </div>
    </NotchTooltip>
  );
}
