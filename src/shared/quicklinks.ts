/**
 * Quicklinks & web bangs (Lot 2 #6) — helpers PURS (sans dépendance Node,
 * importables main + renderer comme `clipboardDetectors.ts`).
 *
 * Un quicklink associe un **alias** (tapé après le sigil `!` dans la search
 * bar) à un **template d'URL**. L'emplacement de la requête est marqué par
 * `{}` (ou `{query}`) ; sans placeholder, la requête est ajoutée en
 * paramètre `q=`. Exemple : `!npm vite` → `https://www.npmjs.com/search?q=vite`.
 *
 * Fallback : si l'alias tapé ne correspond à aucun quicklink, on propose un
 * **bang DuckDuckGo** (`https://duckduckgo.com/?q=!alias query`) qui couvre
 * des milliers de raccourcis sans config locale.
 */
import type { Quicklink } from './types';

const URL_RE = /^https?:\/\//i;

/** Un template d'URL quicklink valide (http/https). */
export function isValidQuicklinkUrl(url: string): boolean {
  return URL_RE.test(url.trim());
}

/** Valide la forme d'un quicklink (alias + url http(s)). */
export function isValidQuicklink(q: Quicklink): boolean {
  return (
    typeof q.alias === 'string' &&
    q.alias.trim().length > 0 &&
    typeof q.url === 'string' &&
    isValidQuicklinkUrl(q.url)
  );
}

/**
 * Résout le template d'un quicklink avec la requête fournie.
 *  - `{}` / `{query}` présent → remplacé par la requête encodée.
 *  - sinon, requête non vide → ajoutée en `?q=` / `&q=`.
 *  - sinon → URL de base telle quelle.
 */
export function resolveQuicklink(urlTemplate: string, query: string): string {
  const q = query.trim();
  const enc = encodeURIComponent(q);
  if (urlTemplate.includes('{}')) return urlTemplate.split('{}').join(enc);
  if (urlTemplate.includes('{query}')) return urlTemplate.split('{query}').join(enc);
  if (!q) return urlTemplate;
  const sep = urlTemplate.includes('?') ? '&' : '?';
  return `${urlTemplate}${sep}q=${enc}`;
}

/** URL d'un bang DuckDuckGo (`!alias query`). */
export function ddgBangUrl(alias: string, query: string): string {
  const bang = `!${alias} ${query}`.trim();
  return `https://duckduckgo.com/?q=${encodeURIComponent(bang)}`;
}

/**
 * Sépare une saisie `!`-mode en (alias, query). `"gl 4521"` → `{alias:"gl",
 * query:"4521"}` ; `"np"` → `{alias:"np", query:""}` (alias partiel).
 */
export function splitBangInput(payload: string): { alias: string; query: string } {
  const trimmed = payload.trimStart();
  const m = /^(\S+)\s+([\s\S]*)$/.exec(trimmed);
  if (m) return { alias: m[1], query: m[2].trim() };
  return { alias: trimmed.trim(), query: '' };
}

/**
 * Filtre les quicklinks dont l'alias commence par `aliasPart` (insensible
 * à la casse). `aliasPart` vide → tous.
 */
export function matchQuicklinks(links: Quicklink[], aliasPart: string): Quicklink[] {
  const a = aliasPart.toLowerCase();
  if (!a) return links;
  return links.filter((q) => q.alias.toLowerCase().startsWith(a));
}

/* ───────────── Édition texte (Settings) ───────────── */

/**
 * Parse l'éditeur texte : une ligne = `alias url [| label]`. Lignes vides
 * et commentaires (`#`) ignorés. Alias normalisé en minuscules. Entrées
 * invalides (url non http(s)) écartées. Dédup par alias (première gagne).
 */
export function parseQuicklinksText(text: string): Quicklink[] {
  const out: Quicklink[] = [];
  const seen = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // alias = 1er token ; le RESTE est l'URL (les espaces y sont autorisés —
    // ex. un template `?jql=projet = X {}`). Le libellé optionnel est séparé
    // par ` | ` (espace-pipe-espace) ; `lastIndexOf` laisse un `|` interne à
    // l'URL dans l'URL.
    const m = /^(\S+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const alias = m[1].toLowerCase();
    let url = m[2].trim();
    let label: string | undefined;
    const sep = url.lastIndexOf(' | ');
    if (sep !== -1) {
      label = url.slice(sep + 3).trim() || undefined;
      url = url.slice(0, sep).trim();
    }
    if (!isValidQuicklinkUrl(url) || seen.has(alias)) continue;
    seen.add(alias);
    out.push({ alias, url, label });
  }
  return out;
}

/** Sérialise une liste de quicklinks pour l'éditeur texte. */
export function serializeQuicklinks(links: Quicklink[]): string {
  return links
    .map((q) => `${q.alias} ${q.url}${q.label ? ` | ${q.label}` : ''}`)
    .join('\n');
}
