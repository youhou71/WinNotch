/**
 * Métadonnées d'affichage pour la source SMTC d'une lecture musicale.
 *
 * Windows expose un `source` qui peut être un `AppUserModelId` UWP
 * (`SpotifyAB.SpotifyMusic_zpdnekdrzrea0`) ou un nom de process Win32
 * (`Spotify.exe`, `chrome.exe`). On mappe les apps connues vers leur
 * nom commercial + une icône Font Awesome + leur couleur de brand ;
 * fallback générique sinon.
 */

export interface MusicSourceMeta {
  label: string;
  /** Classe Font Awesome complète (ex. "fa-brands fa-spotify"). */
  icon: string;
  /** Couleur CSS de brand pour teinter l'icône, ou null pour neutre. */
  color: string | null;
}

interface SourceEntry {
  match: RegExp;
  label: string;
  icon: string;
  color: string | null;
}

const ENTRIES: SourceEntry[] = [
  {
    match: /spotifyab\.spotifymusic|^spotify\.exe$|^spotify$/,
    label: 'Spotify',
    icon: 'fa-brands fa-spotify',
    color: '#1DB954',
  },
  {
    match: /appleinc\.itunes|itunes|apple\.?music/,
    label: 'Apple Music',
    icon: 'fa-brands fa-apple',
    color: '#fc3c44',
  },
  {
    match: /youtubemusic|youtube\.music|music\.youtube/,
    label: 'YouTube Music',
    icon: 'fa-brands fa-youtube',
    color: '#FF0000',
  },
  {
    match: /microsoft\.zunemusic|groove/,
    label: 'Groove',
    icon: 'fa-brands fa-windows',
    color: '#6f3df5',
  },
  {
    match: /microsoft\.windowsmediaplayer|wmplayer|^wmplayer\.exe$/,
    label: 'Windows Media Player',
    icon: 'fa-brands fa-windows',
    color: '#0078D4',
  },
  {
    match: /^msedge\.exe$|microsoft\.microsoftedge|microsoftedge/,
    label: 'Edge',
    icon: 'fa-brands fa-edge',
    color: '#0078D4',
  },
  {
    match: /^chrome\.exe$|google\.chrome/,
    label: 'Chrome',
    icon: 'fa-brands fa-chrome',
    color: '#4285F4',
  },
  {
    match: /^firefox\.exe$|mozilla/,
    label: 'Firefox',
    icon: 'fa-brands fa-firefox-browser',
    color: '#FF7139',
  },
  {
    match: /^brave\.exe$|brave\.browser/,
    label: 'Brave',
    icon: 'fa-solid fa-shield',
    color: '#FB542B',
  },
  {
    match: /^opera\.exe$/,
    label: 'Opera',
    icon: 'fa-brands fa-opera',
    color: '#FF1B2D',
  },
  {
    match: /^vivaldi\.exe$/,
    label: 'Vivaldi',
    icon: 'fa-solid fa-globe',
    color: '#EF3939',
  },
  {
    match: /deezer/,
    label: 'Deezer',
    icon: 'fa-brands fa-deezer',
    color: '#00C7F2',
  },
  {
    match: /tidal/,
    label: 'TIDAL',
    icon: 'fa-solid fa-music',
    color: '#ffffff',
  },
  {
    match: /^vlc\.exe$|videolan/,
    label: 'VLC',
    icon: 'fa-solid fa-play',
    color: '#FF8800',
  },
  {
    match: /foobar2000/,
    label: 'foobar2000',
    icon: 'fa-solid fa-music',
    color: null,
  },
  {
    match: /aimp/,
    label: 'AIMP',
    icon: 'fa-solid fa-music',
    color: null,
  },
];

/**
 * Retourne les métadonnées d'affichage pour un `source` SMTC, ou un
 * objet générique si la source n'est pas reconnue (label dérivé par
 * heuristique sur le nom de package).
 */
export function getMusicSourceMeta(source: string): MusicSourceMeta {
  if (!source) {
    return { label: '', icon: 'fa-solid fa-music', color: null };
  }
  const lower = source.toLowerCase();
  for (const entry of ENTRIES) {
    if (entry.match.test(lower)) {
      return { label: entry.label, icon: entry.icon, color: entry.color };
    }
  }
  // Fallback : nettoie le suffixe UWP `_xxxxxxxx` et l'extension .exe,
  // puis prend le dernier segment significatif après le dernier point.
  const cleaned = source.replace(/_[a-z0-9]+$/i, '').replace(/\.exe$/i, '');
  const lastSegment = cleaned.split('.').pop() ?? cleaned;
  return {
    label: lastSegment || cleaned || source,
    icon: 'fa-solid fa-music',
    color: null,
  };
}
