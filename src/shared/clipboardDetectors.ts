/**
 * Détecteurs de type de contenu textuels — partagés main ↔ renderer.
 *
 * Ce module est volontairement sans dépendance Node-only (pas de
 * `Buffer`, pas de `crypto`) pour pouvoir être importé dans le bundle
 * renderer. Les opérations base64 utilisent un fallback `atob` quand
 * `Buffer` n'est pas disponible.
 *
 * Les détecteurs image (qui nécessitent `NativeImage`) restent dans
 * `main/modules/clipboard/detectors/image.ts` — ils n'ont pas de sens
 * dans la search bar (on n'y colle pas une image).
 *
 * Ordre de priorité du pipeline : `jwt` > `url` > `json` > `color` >
 * `path` > `text`. Cf. doc du pipeline pour les raisons.
 */
import type { ClipboardEntryType } from './types';

export interface TextDetectorMatch {
  type: ClipboardEntryType;
  /** Aperçu court (≤120 chars) pour l'affichage chip/ligne. */
  preview: string;
  /** Texte canonique (= input trim ; jamais null pour les détecteurs text). */
  text: string;
  /** Métadonnées spécifiques au type. */
  meta: Record<string, unknown>;
}

export interface TextDetectionResult extends TextDetectorMatch {
  sensitive: boolean;
}

type TextDetector = (text: string) => TextDetectorMatch | null;

/* ───────────── Helpers base64 (portable Node + browser) ───────────── */

function decodeBase64Url(segment: string): string | null {
  try {
    const padded = segment
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(segment.length + ((4 - (segment.length % 4)) % 4), '=');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const B = (globalThis as any).Buffer as
      | { from: (s: string, enc: string) => { toString: (enc: string) => string } }
      | undefined;
    if (typeof B !== 'undefined') {
      return B.from(padded, 'base64').toString('utf8');
    }
    if (typeof atob !== 'undefined') {
      const bin = atob(padded);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }
    return null;
  } catch {
    return null;
  }
}

function parseJson<T = unknown>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/* ───────────── JWT ───────────── */

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

interface JwtHeader {
  alg?: string;
  typ?: string;
}

interface JwtPayload {
  exp?: number;
  iss?: string;
  sub?: string;
  [k: string]: unknown;
}

export const detectJwt: TextDetector = (text) => {
  const trimmed = text.trim();
  if (!JWT_SHAPE.test(trimmed)) return null;

  const [h, p] = trimmed.split('.');
  const headerStr = decodeBase64Url(h);
  if (!headerStr) return null;
  const header = parseJson<JwtHeader>(headerStr);
  if (!header || typeof header !== 'object' || !header.alg) return null;

  const payloadStr = decodeBase64Url(p);
  const payload = payloadStr ? parseJson<JwtPayload>(payloadStr) : null;

  const expIso =
    payload && typeof payload.exp === 'number'
      ? new Date(payload.exp * 1000).toISOString()
      : undefined;

  const subject =
    payload && typeof payload.sub === 'string'
      ? payload.sub
      : payload && typeof payload.iss === 'string'
        ? payload.iss
        : header.alg;

  return {
    type: 'jwt',
    preview: `JWT ${header.alg} · ${subject}`,
    text: trimmed,
    meta: {
      header,
      payload: payload ?? null,
      expIso,
    },
  };
};

/* ───────────── URL ───────────── */

const URL_RE = /^https?:\/\/[^\s]+$/i;

export const detectUrl: TextDetector = (text) => {
  const trimmed = text.trim();
  if (!URL_RE.test(trimmed)) return null;
  let host: string;
  try {
    host = new URL(trimmed).host;
  } catch {
    return null;
  }
  return {
    type: 'url',
    preview: host,
    text: trimmed,
    meta: { host },
  };
};

/* ───────────── JSON ───────────── */

const JSON_MAX_BYTES = 256 * 1024;

export const detectJson: TextDetector = (text) => {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > JSON_MAX_BYTES) return null;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (!((first === '{' && last === '}') || (first === '[' && last === ']'))) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const isArray = Array.isArray(parsed);
  const length = isArray
    ? (parsed as unknown[]).length
    : typeof parsed === 'object' && parsed !== null
      ? Object.keys(parsed).length
      : 0;
  const pretty = JSON.stringify(parsed, null, 2).slice(0, JSON_MAX_BYTES);
  const preview = isArray
    ? `JSON array · ${length} élément${length > 1 ? 's' : ''}`
    : `JSON object · ${length} clé${length > 1 ? 's' : ''}`;
  return {
    type: 'json',
    preview,
    text: trimmed,
    meta: { pretty, isArray, length },
  };
};

/* ───────────── Color ───────────── */

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE =
  /^rgba?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(-?\d+(?:\.\d+)?%?))?\s*\)$/i;
const HSL_RE =
  /^hsla?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%(?:\s*,\s*(-?\d+(?:\.\d+)?%?))?\s*\)$/i;

function parseHex(hex: string): { r: number; g: number; b: number; a: number } {
  const body = hex.slice(1);
  const expand = (s: string) => parseInt(s.length === 1 ? s + s : s, 16);
  if (body.length === 3 || body.length === 4) {
    const r = expand(body[0]);
    const g = expand(body[1]);
    const b = expand(body[2]);
    const a = body.length === 4 ? expand(body[3]) / 255 : 1;
    return { r, g, b, a };
  }
  const r = parseInt(body.slice(0, 2), 16);
  const g = parseInt(body.slice(2, 4), 16);
  const b = parseInt(body.slice(4, 6), 16);
  const a = body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else if (hp < 6) [r, g, b] = [c, 0, x];
  const m = lNorm - c / 2;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function buildColor(
  text: string,
  format: 'hex' | 'rgb' | 'hsl',
  r: number,
  g: number,
  b: number,
  a: number,
): TextDetectorMatch {
  const hex =
    '#' +
    [r, g, b]
      .map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0'))
      .join('');
  return {
    type: 'color',
    preview: a < 1 ? `${hex} · ${(a * 100).toFixed(0)}%` : hex,
    text,
    meta: {
      format,
      r: clamp(Math.round(r), 0, 255),
      g: clamp(Math.round(g), 0, 255),
      b: clamp(Math.round(b), 0, 255),
      a,
      hex,
    },
  };
}

export const detectColor: TextDetector = (text) => {
  const trimmed = text.trim();

  if (HEX_RE.test(trimmed)) {
    const { r, g, b, a } = parseHex(trimmed);
    return buildColor(trimmed, 'hex', r, g, b, a);
  }

  let m = RGB_RE.exec(trimmed);
  if (m) {
    const r = parseFloat(m[1]);
    const g = parseFloat(m[2]);
    const b = parseFloat(m[3]);
    let a = 1;
    if (m[4] !== undefined) {
      a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    }
    return buildColor(trimmed, 'rgb', r, g, b, clamp(a, 0, 1));
  }

  m = HSL_RE.exec(trimmed);
  if (m) {
    const h = parseFloat(m[1]);
    const s = parseFloat(m[2]);
    const l = parseFloat(m[3]);
    let a = 1;
    if (m[4] !== undefined) {
      a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    }
    const { r, g, b } = hslToRgb(h, s, l);
    return buildColor(trimmed, 'hsl', r, g, b, clamp(a, 0, 1));
  }

  return null;
};

/* ───────────── Path ───────────── */

const PATH_LOCAL_RE = /^[a-zA-Z]:\\[^<>"|?*\r\n]*$/;
const PATH_UNC_RE = /^\\\\[^\\<>"|?*\r\n]+\\[^<>"|?*\r\n]+/;

export const detectPath: TextDetector = (text) => {
  const trimmed = text.trim();
  if (!PATH_LOCAL_RE.test(trimmed) && !PATH_UNC_RE.test(trimmed)) return null;
  const basename = trimmed.split('\\').filter(Boolean).pop() ?? trimmed;
  return {
    type: 'path',
    preview: basename || trimmed,
    text: trimmed,
    meta: {},
  };
};

/* ───────────── Text (fallback) ───────────── */

const TEXT_PREVIEW_MAX = 120;

export const detectText: TextDetector = (text) => {
  if (!text || !text.trim()) return null;
  const previewSrc = text.replace(/\s+/g, ' ').trim();
  const preview =
    previewSrc.length > TEXT_PREVIEW_MAX
      ? previewSrc.slice(0, TEXT_PREVIEW_MAX - 1) + '…'
      : previewSrc;
  return {
    type: 'text',
    preview,
    text,
    meta: {},
  };
};

/* ───────────── Sensitive heuristic ───────────── */

const LABELED_SECRET_RE =
  /\b(token|password|passwd|secret|api[_-]?key|authorization)\b\s*[:=]\s*\S+/i;

const KNOWN_PREFIXES = [
  'bearer ',
  'glpat-',
  'ghp_',
  'gho_',
  'ghs_',
  'ghu_',
  'github_pat_',
  'sk-',
  'rk_live_',
  'pk_live_',
  'xoxb-',
  'xoxp-',
  'AIza',
];

const LONG_OPAQUE_RE = /^[A-Za-z0-9+/_=-]{32,}$/;

export function isSensitive(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (LABELED_SECRET_RE.test(trimmed)) return true;

  const lower = trimmed.toLowerCase();
  for (const prefix of KNOWN_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }

  if (LONG_OPAQUE_RE.test(trimmed)) {
    const hasUpper = /[A-Z]/.test(trimmed);
    const hasLower = /[a-z]/.test(trimmed);
    if (hasUpper && hasLower) return true;
  }

  return false;
}

/* ───────────── Pipeline texte ───────────── */

const TEXT_PIPELINE: TextDetector[] = [
  detectJwt,
  detectUrl,
  detectJson,
  detectColor,
  detectPath,
  detectText,
];

/**
 * Orchestre les détecteurs textuels dans l'ordre figé. Retourne `null`
 * si tout est vide (rien à enregistrer / rien à proposer).
 *
 * Le flag `sensitive` est calculé en bonus — l'appelant peut décider
 * de masquer ou non.
 */
export function detectFromText(text: string): TextDetectionResult | null {
  for (const fn of TEXT_PIPELINE) {
    const m = fn(text);
    if (m) {
      return { ...m, sensitive: isSensitive(m.text) };
    }
  }
  return null;
}
