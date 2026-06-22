/**
 * Rendu détaillé d'une entrée du presse-papier selon son type.
 *
 * Affiché à droite du libellé dans chaque ligne de la card, ou en bloc
 * étendu pour les types JSON/JWT qui méritent un dépliage.
 *
 * Chaque sous-composant lit `entry.meta` selon le contrat documenté
 * dans `shared/types.ts` (ClipboardEntry → meta). Les conversions ont
 * déjà été faites côté détecteurs main process.
 */
import { useEffect, useState } from 'react';
import type { ClipboardEntry, UrlUnfurl } from '../../../shared/types';
import { JsonHighlight } from './JsonHighlight';

interface Props {
  entry: ClipboardEntry;
  /** Unfurl async pour le type URL. */
  onUnfurl?: (id: string) => Promise<UrlUnfurl | null>;
}

export function ClipboardItemPreview({ entry, onUnfurl }: Props) {
  switch (entry.type) {
    case 'image':
      return <ImagePreview entry={entry} />;
    case 'color':
      return <ColorPreview entry={entry} />;
    case 'url':
      return <UrlPreview entry={entry} onUnfurl={onUnfurl} />;
    case 'json':
      return <JsonPreview entry={entry} />;
    case 'jwt':
      return <JwtPreview entry={entry} />;
    case 'path':
      return <PathPreview entry={entry} />;
    case 'uuid':
      return <UuidPreview entry={entry} />;
    case 'hash':
      return <HashPreview entry={entry} />;
    case 'epoch':
      return <EpochPreview entry={entry} />;
    default:
      return null;
  }
}

/* ───────────── Image ───────────── */
function ImagePreview({ entry }: { entry: ClipboardEntry }) {
  // Charge le PNG en data URL via IPC (`clipboard:getImageDataUrl`).
  // Electron refuse `file://` depuis le renderer en contextIsolation —
  // le data URL est la voie la plus simple et fiable pour rendre l'image.
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!entry.imagePath) return;
    let alive = true;
    void window.notch.clipboard.getImageDataUrl(entry.id).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [entry.id, entry.imagePath]);

  if (!entry.imagePath) return null;
  const width = typeof entry.meta.width === 'number' ? entry.meta.width : null;
  const height =
    typeof entry.meta.height === 'number' ? entry.meta.height : null;
  // Pré-alloue le ratio natif pour que le placeholder n'occupe pas un
  // carré (saut visuel quand l'image arrive), et pour que le browser
  // applique correctement max-width/max-height en respectant le ratio.
  const aspectRatio =
    width && height ? `${width} / ${height}` : ('1 / 1' as const);
  return (
    <div className="cb-preview cb-preview-image">
      {src ? (
        <img
          src={src}
          alt=""
          className="cb-image-thumb"
          style={{ aspectRatio }}
        />
      ) : (
        <div
          className="cb-image-thumb cb-image-thumb-loading"
          style={{ aspectRatio }}
        />
      )}
      {width && height && (
        <span className="cb-image-dim">
          {width} × {height} px
        </span>
      )}
    </div>
  );
}

/* ───────────── Color ───────────── */
function ColorPreview({ entry }: { entry: ClipboardEntry }) {
  const r = typeof entry.meta.r === 'number' ? entry.meta.r : 0;
  const g = typeof entry.meta.g === 'number' ? entry.meta.g : 0;
  const b = typeof entry.meta.b === 'number' ? entry.meta.b : 0;
  const a = typeof entry.meta.a === 'number' ? entry.meta.a : 1;
  const hex = typeof entry.meta.hex === 'string' ? entry.meta.hex : '#000';
  const css = `rgba(${r}, ${g}, ${b}, ${a})`;
  return (
    <div className="cb-preview cb-preview-color">
      <span className="cb-color-swatch" style={{ background: css }} />
      <span className="cb-color-hex">{hex}</span>
      <span className="cb-color-rgb">
        {r}, {g}, {b}
        {a < 1 ? `, ${a.toFixed(2)}` : ''}
      </span>
    </div>
  );
}

/* ───────────── URL ───────────── */
function UrlPreview({
  entry,
  onUnfurl,
}: {
  entry: ClipboardEntry;
  onUnfurl?: (id: string) => Promise<UrlUnfurl | null>;
}) {
  const titleFromMeta =
    typeof entry.meta.title === 'string' ? entry.meta.title : null;
  const faviconFromMeta =
    typeof entry.meta.favicon === 'string' ? entry.meta.favicon : null;
  const [title, setTitle] = useState<string | null>(titleFromMeta);
  const [favicon, setFavicon] = useState<string | null>(faviconFromMeta);

  // Déclenche l'unfurl asynchrone à la première vue si pas déjà fait.
  // Le main cache le résultat en mémoire (TTL 24 h) et le persiste dans
  // `entry.meta` au prochain commit, donc cet effect ne fera un fetch
  // qu'une fois par item.
  useEffect(() => {
    if (title || !onUnfurl) return;
    let alive = true;
    void onUnfurl(entry.id).then((res) => {
      if (alive && res) {
        if (res.title) setTitle(res.title);
        if (res.favicon) setFavicon(res.favicon);
      }
    });
    return () => {
      alive = false;
    };
  }, [entry.id, title, onUnfurl]);

  const host = typeof entry.meta.host === 'string' ? entry.meta.host : '';

  return (
    <div className="cb-preview cb-preview-url">
      {favicon ? (
        <img
          src={favicon}
          alt=""
          className="cb-url-favicon"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <i className="fa-solid fa-globe cb-url-favicon-fallback" />
      )}
      <div className="cb-url-body">
        {title && <span className="cb-url-title">{title}</span>}
        <span className="cb-url-host">{host}</span>
      </div>
    </div>
  );
}

/* ───────────── JSON ───────────── */
function JsonPreview({ entry }: { entry: ClipboardEntry }) {
  const pretty =
    typeof entry.meta.pretty === 'string' ? entry.meta.pretty : entry.text ?? '';
  const isArray = entry.meta.isArray === true;
  const length =
    typeof entry.meta.length === 'number' ? entry.meta.length : 0;
  const [open, setOpen] = useState(false);
  return (
    <div className="cb-preview cb-preview-json">
      <button
        type="button"
        className="cb-json-toggle"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <i
          className={
            open
              ? 'fa-solid fa-chevron-down'
              : 'fa-solid fa-chevron-right'
          }
        />
        {isArray ? 'Array' : 'Object'} · {length}{' '}
        {isArray ? 'élément' : 'clé'}
        {length > 1 ? 's' : ''}
      </button>
      {open && <JsonHighlight source={pretty} className="cb-json-pre" />}
    </div>
  );
}

/* ───────────── JWT ───────────── */
function JwtPreview({ entry }: { entry: ClipboardEntry }) {
  const header = entry.meta.header as Record<string, unknown> | undefined;
  const payload = entry.meta.payload as Record<string, unknown> | null;
  const expIso =
    typeof entry.meta.expIso === 'string' ? entry.meta.expIso : null;
  const [open, setOpen] = useState(false);

  const relExp = expIso ? relativeFromNow(expIso) : null;

  return (
    <div className="cb-preview cb-preview-jwt">
      <button
        type="button"
        className="cb-jwt-toggle"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <i
          className={
            open
              ? 'fa-solid fa-chevron-down'
              : 'fa-solid fa-chevron-right'
          }
        />
        JWT · {(header?.alg as string | undefined) ?? '?'}
        {relExp && (
          <span
            className={
              'cb-jwt-exp ' +
              (relExp.expired ? 'is-expired' : 'is-valid')
            }
          >
            {relExp.expired
              ? 'expiré ' + relExp.text
              : 'expire ' + relExp.text}
          </span>
        )}
      </button>
      {open && (
        <JsonHighlight
          source={JSON.stringify({ header, payload }, null, 2)}
          className="cb-jwt-pre"
        />
      )}
    </div>
  );
}

/* ───────────── Path ───────────── */
function PathPreview({ entry }: { entry: ClipboardEntry }) {
  return (
    <div className="cb-preview cb-preview-path">
      <i className="fa-regular fa-folder cb-path-icon" />
      <span className="cb-path-full">{entry.text}</span>
    </div>
  );
}

/* ───────────── UUID ───────────── */
function UuidPreview({ entry }: { entry: ClipboardEntry }) {
  const version =
    typeof entry.meta.version === 'number' ? entry.meta.version : null;
  return (
    <div className="cb-preview cb-dev-preview">
      <i className="fa-solid fa-fingerprint cb-dev-icon" data-color="#c084fc" />
      <span className="cb-dev-label">UUID{version ? ` v${version}` : ''}</span>
    </div>
  );
}

/* ───────────── Hash ───────────── */
function HashPreview({ entry }: { entry: ClipboardEntry }) {
  const algo = typeof entry.meta.algo === 'string' ? entry.meta.algo : 'Hash';
  const bits = typeof entry.meta.bits === 'number' ? entry.meta.bits : null;
  return (
    <div className="cb-preview cb-dev-preview">
      <i className="fa-solid fa-hashtag cb-dev-icon" data-color="#fb923c" />
      <span className="cb-dev-label">
        {algo}
        {bits ? ` · ${bits} bits` : ''}
      </span>
    </div>
  );
}

/* ───────────── Epoch ───────────── */
function EpochPreview({ entry }: { entry: ClipboardEntry }) {
  const epochMs =
    typeof entry.meta.epochMs === 'number' ? entry.meta.epochMs : NaN;
  if (Number.isNaN(epochMs)) return null;
  const d = new Date(epochMs);
  const local = d.toLocaleString('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const rel = relativeFromNow(d.toISOString());
  return (
    <div className="cb-preview cb-dev-preview">
      <i className="fa-solid fa-clock cb-dev-icon" data-color="#38bdf8" />
      <span className="cb-dev-label">{local}</span>
      <span className="cb-dev-meta">{rel.text}</span>
    </div>
  );
}

/* ───────────── Utils ───────────── */
function relativeFromNow(iso: string): { text: string; expired: boolean } {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = t - now;
  const expired = diffMs < 0;
  const absSec = Math.abs(Math.round(diffMs / 1000));
  const min = Math.round(absSec / 60);
  const h = Math.round(absSec / 3600);
  const d = Math.round(absSec / 86400);
  let unit: string;
  if (absSec < 60) unit = `il y a ${absSec} s`;
  else if (min < 60) unit = expired ? `il y a ${min} min` : `dans ${min} min`;
  else if (h < 48) unit = expired ? `il y a ${h} h` : `dans ${h} h`;
  else unit = expired ? `il y a ${d} j` : `dans ${d} j`;
  return { text: unit, expired };
}
