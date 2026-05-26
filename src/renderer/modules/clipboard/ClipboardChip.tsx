/**
 * Chip Clipboard dans le notch rétracté.
 *
 * Affiche :
 *  - une icône presse-papier (par défaut) OU un mini-aperçu typé pour
 *    le dernier item (swatch couleur, favicon URL, miniature image…)
 *  - un badge `+N` quand il y a N nouvelles entrées depuis le dernier
 *    `markSeen` (déclenché à l'ouverture de la card).
 *
 * Pas d'attribut `title` (cf. note dans MusicChip : tooltip natif Windows
 * s'afficherait sur le bureau sous le notch).
 */
import { useEffect, useState } from 'react';
import type { ClipboardEntry } from '../../../shared/types';
import { useClipboardContext } from './ClipboardContext';

function ImageChipThumb({ entry }: { entry: ClipboardEntry }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void window.notch.clipboard.getImageDataUrl(entry.id).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [entry.id]);
  if (!src) return <i className="fa-regular fa-image cb-chip-icon" />;
  return <img src={src} alt="" className="cb-chip-thumb" />;
}

function ChipPreview({ entry }: { entry: ClipboardEntry }) {
  if (entry.type === 'image' && entry.imagePath) {
    return <ImageChipThumb entry={entry} />;
  }
  if (entry.type === 'color') {
    const r = typeof entry.meta.r === 'number' ? entry.meta.r : 0;
    const g = typeof entry.meta.g === 'number' ? entry.meta.g : 0;
    const b = typeof entry.meta.b === 'number' ? entry.meta.b : 0;
    const a = typeof entry.meta.a === 'number' ? entry.meta.a : 1;
    return (
      <span
        className="cb-chip-swatch"
        style={{ background: `rgba(${r}, ${g}, ${b}, ${a})` }}
      />
    );
  }
  if (entry.type === 'url') {
    const favicon =
      typeof entry.meta.favicon === 'string' ? entry.meta.favicon : null;
    return favicon ? (
      <img
        src={favicon}
        alt=""
        className="cb-chip-favicon"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    ) : (
      <i className="fa-solid fa-globe cb-chip-icon" />
    );
  }
  // Icône par type pour les autres
  const iconByType: Record<string, string> = {
    json: 'fa-solid fa-brackets-curly',
    jwt: 'fa-solid fa-key',
    path: 'fa-regular fa-folder',
    text: 'fa-solid fa-clipboard',
  };
  return <i className={(iconByType[entry.type] ?? 'fa-solid fa-clipboard') + ' cb-chip-icon'} />;
}

export function ClipboardChip() {
  const { state } = useClipboardContext();
  const last = state.entries[0];

  // Badge "non vu" : nombre d'items copiés après le dernier markSeen.
  const unseen = state.entries.filter((e) => e.copiedAt > state.lastSeenAt).length;

  if (!last) {
    // Rien dans l'historique → on ne montre pas la chip (cohérent avec
    // les autres modules qui se masquent quand ils n'ont rien à dire).
    return null;
  }

  return (
    <div className="chip chip-clipboard">
      <span className="cb-chip-preview">
        <ChipPreview entry={last} />
      </span>
      {unseen > 0 && (
        <span className="cb-chip-badge" aria-label={`${unseen} non vu`}>
          +{unseen > 99 ? '99' : unseen}
        </span>
      )}
    </div>
  );
}
