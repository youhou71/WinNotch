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
import { useMusicContext } from './MusicContext';

export function MusicChip() {
  const { state } = useMusicContext();

  // Pas d'attribut `title` : le notch étant collé tout en haut de l'écran,
  // le tooltip natif Windows s'afficherait sur le bureau sous le notch
  // (effet visuel disgracieux). La chip affiche déjà le titre tronqué et
  // l'utilisateur peut étendre le notch pour voir le détail dans la card.
  return (
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
  );
}
