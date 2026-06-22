/**
 * Vue plein dashboard quand la search bar a détecté un type de contenu
 * (URL / JSON / color / JWT / path).
 *
 * Cohabite avec les autres modes search (`-`, `>`, `/`, `vs`) selon le
 * même contrat de mutex que ExpandedDashboard impose.
 *
 * Actions par type :
 *  - URL  : Ouvrir dans le navigateur · Copier
 *  - JSON : Copier formaté (pretty) · Copier compact · Pretty-print affiché
 *  - JWT  : Copier le token · Header + payload décodés affichés
 *  - Color: Copier hex/rgb/hsl · Swatch + équivalents
 *  - Path : Ouvrir dans Explorer · Copier
 */
import type { TextDetectionResult } from '../../../shared/clipboardDetectors';
import { useToast } from '../toast/ToastContext';
import { JsonHighlight } from './JsonHighlight';

interface Props {
  detection: TextDetectionResult;
  /**
   * Appelé après une action réussie qui a vocation à fermer la vue
   * (clear de la query côté ExpandedDashboard, comme pour les autres
   * modes search).
   */
  onAfterAction?: () => void;
}

export function ClipboardDetectionView({ detection, onAfterAction }: Props) {
  switch (detection.type) {
    case 'url':
      return <UrlDetection detection={detection} onAfterAction={onAfterAction} />;
    case 'json':
      return <JsonDetection detection={detection} />;
    case 'jwt':
      return <JwtDetection detection={detection} />;
    case 'color':
      return <ColorDetection detection={detection} />;
    case 'path':
      return <PathDetection detection={detection} onAfterAction={onAfterAction} />;
    case 'uuid':
      return <UuidDetection detection={detection} />;
    case 'hash':
      return <HashDetection detection={detection} />;
    case 'epoch':
      return <EpochDetection detection={detection} />;
    default:
      return null;
  }
}

/* ───────────── Helpers ───────────── */

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function useCopyToast() {
  const { push } = useToast();
  return (text: string, label: string) =>
    void copy(text).then((ok) => {
      push({
        icon: ok ? 'fa-solid fa-check' : 'fa-solid fa-triangle-exclamation',
        iconColor: ok ? '#34d399' : '#ef4444',
        name: 'Clipboard',
        message: ok ? `${label} copié` : 'Échec de la copie',
      });
    });
}

/* ───────────── URL ───────────── */
function UrlDetection({
  detection,
  onAfterAction,
}: {
  detection: TextDetectionResult;
  onAfterAction?: () => void;
}) {
  const { push } = useToast();
  const url = detection.text;
  const host = typeof detection.meta.host === 'string' ? detection.meta.host : url;

  const open = async () => {
    const res = await window.notch.shell.openExternal(url);
    if (res.ok) {
      push({
        icon: 'fa-solid fa-arrow-up-right-from-square',
        iconColor: 'var(--accent-blue, #60a5fa)',
        name: 'URL',
        message: 'Ouverte dans le navigateur',
      });
      onAfterAction?.();
    } else {
      push({
        icon: 'fa-solid fa-triangle-exclamation',
        iconColor: '#ef4444',
        name: 'URL',
        message: res.error ?? "Échec de l'ouverture",
      });
    }
  };

  const copyToast = useCopyToast();

  return (
    <div className="cb-det-view">
      <div className="cb-det-head">
        <i className="fa-solid fa-globe cb-det-icon" data-color="#60a5fa" />
        <div className="cb-det-head-text">
          <div className="cb-det-title">{host}</div>
          <div className="cb-det-sub">{url}</div>
        </div>
      </div>
      <div className="cb-det-actions">
        <button type="button" className="cb-det-btn is-primary" onClick={() => void open()}>
          <i className="fa-solid fa-arrow-up-right-from-square" />
          Ouvrir
        </button>
        <button
          type="button"
          className="cb-det-btn"
          onClick={() => copyToast(url, 'URL')}
        >
          <i className="fa-regular fa-copy" />
          Copier
        </button>
      </div>
    </div>
  );
}

/* ───────────── JSON ───────────── */
function JsonDetection({ detection }: { detection: TextDetectionResult }) {
  const pretty =
    typeof detection.meta.pretty === 'string'
      ? detection.meta.pretty
      : detection.text;
  const isArray = detection.meta.isArray === true;
  const length =
    typeof detection.meta.length === 'number' ? detection.meta.length : 0;
  const copyToast = useCopyToast();

  return (
    <div className="cb-det-view">
      <div className="cb-det-head">
        <i className="fa-solid fa-brackets-curly cb-det-icon" data-color="#f59e0b" />
        <div className="cb-det-head-text">
          <div className="cb-det-title">
            JSON {isArray ? 'array' : 'object'}
          </div>
          <div className="cb-det-sub">
            {length} {isArray ? 'élément' : 'clé'}
            {length > 1 ? 's' : ''}
          </div>
        </div>
      </div>
      <JsonHighlight source={pretty} className="cb-det-pre" />
      <div className="cb-det-actions">
        <button
          type="button"
          className="cb-det-btn is-primary"
          onClick={() => copyToast(pretty, 'JSON formaté')}
        >
          <i className="fa-regular fa-copy" />
          Copier formaté
        </button>
        <button
          type="button"
          className="cb-det-btn"
          onClick={() => copyToast(detection.text, 'JSON compact')}
        >
          <i className="fa-solid fa-minimize" />
          Copier compact
        </button>
      </div>
    </div>
  );
}

/* ───────────── JWT ───────────── */
function JwtDetection({ detection }: { detection: TextDetectionResult }) {
  const header = detection.meta.header as Record<string, unknown> | undefined;
  const payload = detection.meta.payload as Record<string, unknown> | null;
  const expIso =
    typeof detection.meta.expIso === 'string' ? detection.meta.expIso : null;
  const copyToast = useCopyToast();

  const alg = (header?.alg as string | undefined) ?? '?';
  const relExp = expIso ? relativeFromNow(expIso) : null;

  return (
    <div className="cb-det-view">
      <div className="cb-det-head">
        <i className="fa-solid fa-key cb-det-icon" data-color="#a78bfa" />
        <div className="cb-det-head-text">
          <div className="cb-det-title">JWT · {alg}</div>
          {relExp && (
            <div className="cb-det-sub">
              <span
                className={
                  'cb-jwt-exp ' + (relExp.expired ? 'is-expired' : 'is-valid')
                }
              >
                {relExp.expired ? 'expiré ' + relExp.text : 'expire ' + relExp.text}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="cb-det-jwt-grid">
        {/* Ordre volontairement Payload → Header : c'est le payload qui
            contient l'info utile au debug (claims, expiration, scope),
            le header sert juste à confirmer l'algo. Le user le veut
            ainsi même si c'est inverse de la sérialisation `h.p.s`. */}
        <div className="cb-det-jwt-col">
          <div className="cb-det-jwt-label">Payload</div>
          <JsonHighlight
            source={JSON.stringify(payload ?? {}, null, 2)}
            className="cb-det-pre"
          />
        </div>
        <div className="cb-det-jwt-col">
          <div className="cb-det-jwt-label">Header</div>
          <JsonHighlight
            source={JSON.stringify(header ?? {}, null, 2)}
            className="cb-det-pre"
          />
        </div>
      </div>
      <div className="cb-det-actions">
        <button
          type="button"
          className="cb-det-btn is-primary"
          onClick={() => copyToast(detection.text, 'Token')}
        >
          <i className="fa-regular fa-copy" />
          Copier le token
        </button>
        <button
          type="button"
          className="cb-det-btn"
          onClick={() =>
            copyToast(
              JSON.stringify({ header, payload }, null, 2),
              'JSON décodé',
            )
          }
        >
          <i className="fa-solid fa-code" />
          Copier décodé
        </button>
      </div>
    </div>
  );
}

/* ───────────── Color ───────────── */
function ColorDetection({ detection }: { detection: TextDetectionResult }) {
  const r = typeof detection.meta.r === 'number' ? detection.meta.r : 0;
  const g = typeof detection.meta.g === 'number' ? detection.meta.g : 0;
  const b = typeof detection.meta.b === 'number' ? detection.meta.b : 0;
  const a = typeof detection.meta.a === 'number' ? detection.meta.a : 1;
  const hex = typeof detection.meta.hex === 'string' ? detection.meta.hex : '#000';

  const rgbStr = a < 1 ? `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})` : `rgb(${r}, ${g}, ${b})`;
  const hsl = rgbToHsl(r, g, b);
  const hslStr =
    a < 1
      ? `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, ${a.toFixed(2)})`
      : `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;

  const copyToast = useCopyToast();

  return (
    <div className="cb-det-view">
      <div className="cb-det-head">
        <span
          className="cb-det-color-swatch"
          style={{ background: `rgba(${r}, ${g}, ${b}, ${a})` }}
        />
        <div className="cb-det-head-text">
          <div className="cb-det-title">{hex}</div>
          <div className="cb-det-sub">
            {a < 1 ? `Avec alpha ${(a * 100).toFixed(0)} %` : 'Opaque'}
          </div>
        </div>
      </div>
      <div className="cb-det-color-grid">
        <CopyRow label="HEX" value={hex} onCopy={() => copyToast(hex, 'HEX')} />
        <CopyRow label="RGB" value={rgbStr} onCopy={() => copyToast(rgbStr, 'RGB')} />
        <CopyRow label="HSL" value={hslStr} onCopy={() => copyToast(hslStr, 'HSL')} />
      </div>
    </div>
  );
}

function CopyRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="cb-det-copy-row">
      <span className="cb-det-copy-label">{label}</span>
      <span className="cb-det-copy-value">{value}</span>
      <button
        type="button"
        className="cb-det-btn"
        onClick={onCopy}
        title={`Copier ${label}`}
      >
        <i className="fa-regular fa-copy" />
      </button>
    </div>
  );
}

/* ───────────── Path ───────────── */
function PathDetection({
  detection,
  onAfterAction,
}: {
  detection: TextDetectionResult;
  onAfterAction?: () => void;
}) {
  const { push } = useToast();
  const path = detection.text;
  const basename = path.split('\\').filter(Boolean).pop() ?? path;

  const open = async () => {
    const res = await window.notch.shell.openPath(path);
    if (res.ok) {
      push({
        icon: 'fa-regular fa-folder-open',
        iconColor: '#34d399',
        name: 'Explorer',
        message: 'Ouvert',
      });
      onAfterAction?.();
    } else {
      push({
        icon: 'fa-solid fa-triangle-exclamation',
        iconColor: '#ef4444',
        name: 'Explorer',
        message: res.error ?? "Échec de l'ouverture",
      });
    }
  };

  const copyToast = useCopyToast();

  return (
    <div className="cb-det-view">
      <div className="cb-det-head">
        <i className="fa-regular fa-folder cb-det-icon" data-color="#34d399" />
        <div className="cb-det-head-text">
          <div className="cb-det-title">{basename}</div>
          <div className="cb-det-sub cb-det-sub-mono">{path}</div>
        </div>
      </div>
      <div className="cb-det-actions">
        <button
          type="button"
          className="cb-det-btn is-primary"
          onClick={() => void open()}
        >
          <i className="fa-regular fa-folder-open" />
          Ouvrir dans Explorer
        </button>
        <button
          type="button"
          className="cb-det-btn"
          onClick={() => copyToast(path, 'Chemin')}
        >
          <i className="fa-regular fa-copy" />
          Copier
        </button>
      </div>
    </div>
  );
}

/* ───────────── UUID ───────────── */
function UuidDetection({ detection }: { detection: TextDetectionResult }) {
  const lower =
    typeof detection.meta.lower === 'string'
      ? detection.meta.lower
      : detection.text.toLowerCase();
  const upper =
    typeof detection.meta.upper === 'string'
      ? detection.meta.upper
      : detection.text.toUpperCase();
  const version =
    typeof detection.meta.version === 'number' ? detection.meta.version : null;
  const copyToast = useCopyToast();

  return (
    <div className="cb-det-view">
      <div className="cb-det-head">
        <i className="fa-solid fa-fingerprint cb-det-icon" data-color="#c084fc" />
        <div className="cb-det-head-text">
          <div className="cb-det-title">UUID{version ? ` v${version}` : ''}</div>
          <div className="cb-det-sub cb-det-sub-mono">{lower}</div>
        </div>
      </div>
      <div className="cb-det-actions">
        <button
          type="button"
          className="cb-det-btn is-primary"
          onClick={() => copyToast(lower, 'UUID minuscules')}
        >
          <i className="fa-regular fa-copy" />
          Copier minuscules
        </button>
        <button
          type="button"
          className="cb-det-btn"
          onClick={() => copyToast(upper, 'UUID MAJUSCULES')}
        >
          <i className="fa-regular fa-copy" />
          Copier MAJUSCULES
        </button>
      </div>
    </div>
  );
}

/* ───────────── Hash ───────────── */
function HashDetection({ detection }: { detection: TextDetectionResult }) {
  const algo = typeof detection.meta.algo === 'string' ? detection.meta.algo : 'Hash';
  const bits = typeof detection.meta.bits === 'number' ? detection.meta.bits : null;
  const value = detection.text;
  const copyToast = useCopyToast();

  return (
    <div className="cb-det-view">
      <div className="cb-det-head">
        <i className="fa-solid fa-hashtag cb-det-icon" data-color="#fb923c" />
        <div className="cb-det-head-text">
          <div className="cb-det-title">{algo}</div>
          <div className="cb-det-sub">
            {bits ? `${bits} bits · ` : ''}
            {value.length} caractères hex
          </div>
        </div>
      </div>
      <div className="cb-det-color-grid">
        <CopyRow
          label={algo}
          value={value}
          onCopy={() => copyToast(value, algo)}
        />
      </div>
    </div>
  );
}

/* ───────────── Epoch ───────────── */
function EpochDetection({ detection }: { detection: TextDetectionResult }) {
  const epochMs =
    typeof detection.meta.epochMs === 'number' ? detection.meta.epochMs : NaN;
  const copyToast = useCopyToast();

  if (Number.isNaN(epochMs)) return null;
  const d = new Date(epochMs);
  const iso = d.toISOString();
  const local = d.toLocaleString('fr-FR', {
    dateStyle: 'full',
    timeStyle: 'medium',
  });
  const rel = relativeFromNow(iso);
  const sec = Math.floor(epochMs / 1000);

  return (
    <div className="cb-det-view">
      <div className="cb-det-head">
        <i className="fa-solid fa-clock cb-det-icon" data-color="#38bdf8" />
        <div className="cb-det-head-text">
          <div className="cb-det-title">{local}</div>
          <div className="cb-det-sub">{rel.text}</div>
        </div>
      </div>
      <div className="cb-det-color-grid">
        <CopyRow label="UTC ISO" value={iso} onCopy={() => copyToast(iso, 'ISO')} />
        <CopyRow
          label="Epoch (s)"
          value={String(sec)}
          onCopy={() => copyToast(String(sec), 'Epoch secondes')}
        />
        <CopyRow
          label="Epoch (ms)"
          value={String(epochMs)}
          onCopy={() => copyToast(String(epochMs), 'Epoch ms')}
        />
      </div>
    </div>
  );
}

/* ───────────── Utils ───────────── */

function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h *= 60;
  }
  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

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
