/**
 * Générateur d'utilitaires dev (Lot 2 #7) — sigil `;` de la search bar.
 *
 * Helpers PURS (sans dépendance Node : `btoa`/`atob`/`TextEncoder` existent
 * côté Node 18+ ET renderer). Le **hash** (MD5/SHA·) n'est PAS ici : il
 * passe par l'IPC `search:transform` (crypto Node), cf. searchService.
 *
 * ⚠️ Le décodage base64 n'est exposé QUE derrière ce sigil — jamais en
 * détection passive (collision avec le détecteur `sensitive` qui masque les
 * chaînes opaques, cf. clipboardDetectors).
 */

/** Une ligne de sortie copiable. */
export interface GenRow {
  label: string;
  value: string;
}

export interface GenOutput {
  rows: GenRow[];
  /** Renseigné si l'opération a échoué (ex. base64 invalide). */
  error?: string;
}

/** Opérations de hash déléguées au main (crypto Node). */
export type SearchHashOp = 'md5' | 'sha1' | 'sha256' | 'sha512';

/** Métadonnées des commandes, pour l'aide affichée quand la commande manque. */
export const GEN_COMMANDS: { name: string; desc: string; example: string }[] = [
  { name: 'uuid', desc: 'Génère un UUID v4', example: ';uuid' },
  { name: 'b64', desc: 'Encode en base64', example: ';b64 hello' },
  { name: 'b64d', desc: 'Décode du base64', example: ';b64d aGVsbG8=' },
  { name: 'url', desc: 'Encode pour URL', example: ';url a b&c' },
  { name: 'urld', desc: 'Décode une URL', example: ';urld a%20b' },
  { name: 'case', desc: 'Toutes les casses (snake/camel/kebab/Pascal/CONST)', example: ';case fooBar' },
  { name: 'md5', desc: 'Hash MD5', example: ';md5 hello' },
  { name: 'sha1', desc: 'Hash SHA-1', example: ';sha1 hello' },
  { name: 'sha256', desc: 'Hash SHA-256', example: ';sha256 hello' },
  { name: 'sha512', desc: 'Hash SHA-512', example: ';sha512 hello' },
];

/** Sépare `";cmd reste"` → `{cmd:"cmd", input:"reste"}`. Le sigil est déjà retiré. */
export function parseGenInput(payload: string): { cmd: string; input: string } {
  const trimmed = payload.replace(/^\s+/, '');
  const m = /^(\S+)\s+([\s\S]*)$/.exec(trimmed);
  if (m) return { cmd: m[1].toLowerCase(), input: m[2] };
  return { cmd: trimmed.toLowerCase(), input: '' };
}

const HASH_OPS: SearchHashOp[] = ['md5', 'sha1', 'sha256', 'sha512'];

/** Retourne l'op de hash si `cmd` en est une, sinon `null`. */
export function hashOpFor(cmd: string): SearchHashOp | null {
  return (HASH_OPS as string[]).includes(cmd) ? (cmd as SearchHashOp) : null;
}

/* ───────────── base64 (UTF-8 sûr) ───────────── */

function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decode(s: string): string {
  const bin = atob(s.trim());
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/* ───────────── Casse ───────────── */

function words(input: string): string[] {
  // Unicode-aware : on découpe sur les frontières de casse (minuscule/chiffre
  // → Majuscule) et sur tout ce qui n'est ni lettre ni chiffre, SANS perdre
  // les lettres accentuées (`\p{L}` plutôt que `[a-zA-Z]`).
  return input
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function cap(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function caseRows(input: string): GenRow[] {
  const w = words(input);
  if (w.length === 0) return [];
  return [
    { label: 'camelCase', value: w.map((x, i) => (i === 0 ? x.toLowerCase() : cap(x))).join('') },
    { label: 'PascalCase', value: w.map(cap).join('') },
    { label: 'snake_case', value: w.map((x) => x.toLowerCase()).join('_') },
    { label: 'kebab-case', value: w.map((x) => x.toLowerCase()).join('-') },
    { label: 'CONSTANT_CASE', value: w.map((x) => x.toUpperCase()).join('_') },
  ];
}

/* ───────────── UUID ───────────── */

/** UUID v4 via l'API crypto (disponible Node + renderer Electron). */
export function generateUuid(): string {
  return globalThis.crypto.randomUUID();
}

/* ───────────── Dispatch synchrone ───────────── */

/**
 * Exécute une commande SYNCHRONE (tout sauf les hash). Retourne `null` si
 * `cmd` n'est pas une commande sync connue (l'appelant gère hash / aide).
 */
export function runSyncTool(cmd: string, input: string): GenOutput | null {
  switch (cmd) {
    case 'uuid':
      return { rows: [{ label: 'UUID v4', value: generateUuid() }] };
    case 'b64':
    case 'base64':
    case 'b64e':
      return { rows: [{ label: 'base64', value: b64encode(input) }] };
    case 'b64d':
    case 'base64d':
    case 'unb64':
      try {
        return { rows: [{ label: 'décodé', value: b64decode(input) }] };
      } catch {
        return { rows: [], error: 'base64 invalide' };
      }
    case 'url':
    case 'urlenc':
      return { rows: [{ label: 'URL-encodé', value: encodeURIComponent(input) }] };
    case 'urld':
    case 'urldec':
      try {
        return { rows: [{ label: 'URL-décodé', value: decodeURIComponent(input) }] };
      } catch {
        return { rows: [], error: 'séquence URL invalide' };
      }
    case 'case': {
      const rows = caseRows(input);
      return rows.length ? { rows } : { rows: [], error: 'rien à convertir' };
    }
    default:
      return null;
  }
}
