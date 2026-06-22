/**
 * Chip Clipboard dans le notch rétracté.
 *
 * Affiche :
 *  - une icône presse-papier (par défaut) OU un mini-aperçu typé pour
 *    le dernier item (swatch couleur, favicon URL, miniature image…)
 *  - un badge `+N` quand il y a N nouvelles entrées depuis le dernier
 *    `markSeen` (déclenché à l'ouverture de la card).
 *
 * Tooltip rich au survol : dernière entrée + total + non-vus.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { ClipboardEntry, ClipboardEntryType } from '../../../shared/types';
import { useClipboardContext } from './ClipboardContext';
import { NotchTooltip } from '../../components/Tooltip/NotchTooltip';

const CLIPBOARD_ACCENT: CSSProperties = {
  '--tt-accent': '#a78bfa',
  '--tt-accent-fade': 'rgba(167, 139, 250, 0.18)',
} as CSSProperties;

const TYPE_META: Record<ClipboardEntryType, { icon: string; label: string }> = {
  image: { icon: 'fa-regular fa-image', label: 'Image' },
  jwt: { icon: 'fa-solid fa-key', label: 'JWT' },
  url: { icon: 'fa-solid fa-globe', label: 'URL' },
  json: { icon: 'fa-solid fa-brackets-curly', label: 'JSON' },
  color: { icon: 'fa-solid fa-palette', label: 'Couleur' },
  path: { icon: 'fa-regular fa-folder', label: 'Chemin' },
  uuid: { icon: 'fa-solid fa-fingerprint', label: 'UUID' },
  hash: { icon: 'fa-solid fa-hashtag', label: 'Hash' },
  epoch: { icon: 'fa-solid fa-clock', label: 'Epoch' },
  text: { icon: 'fa-solid fa-quote-right', label: 'Texte' },
};

function fmtRelative(copiedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - copiedAt) / 1000));
  if (s < 60) return 'à l’instant';
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

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
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(handle);
  }, []);

  // Badge "non vu" : nombre d'items copiés après le dernier markSeen.
  const unseen = state.entries.filter((e) => e.copiedAt > state.lastSeenAt).length;
  const pinned = state.entries.filter((e) => e.pinned).length;

  if (!last) return null;

  const lastMeta = TYPE_META[last.type] ?? TYPE_META.text;

  return (
    <NotchTooltip
      accentStyle={CLIPBOARD_ACCENT}
      content={
        <div className="tt-body">
          <div className="tt-head">
            <i className="fa-solid fa-clipboard" />
            <span>presse-papier</span>
            <span className="tt-head-count">
              {state.entries.length} entrée{state.entries.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="tt-row">
            <div className="tt-row-head">
              <span className="tt-meta-pill">
                <i className={lastMeta.icon} />
                {lastMeta.label}
              </span>
              <span className="tt-sub">{fmtRelative(last.copiedAt, now)}</span>
            </div>
            <span className="tt-title">{last.preview || '(vide)'}</span>
          </div>
          {(unseen > 0 || pinned > 0) && (
            <div className="tt-meta">
              {unseen > 0 && (
                <span className="tt-meta-pill tt-meta-pill-warn">
                  +{unseen} non vu{unseen > 1 ? 's' : ''}
                </span>
              )}
              {pinned > 0 && (
                <span className="tt-meta-pill tt-meta-pill-dim">
                  <i className="fa-solid fa-thumbtack" />
                  {pinned} épinglé{pinned > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
          <div className="tt-sub">Ctrl + Alt + V pour ouvrir l'historique.</div>
        </div>
      }
    >
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
    </NotchTooltip>
  );
}
