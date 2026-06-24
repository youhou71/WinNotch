/**
 * Snippets à placeholders (Lot 2 #8) — sigil `:` de la search bar.
 *
 * Un snippet a un `name` (clé de filtre + affichage) et un `body`
 * multi-ligne pouvant contenir des placeholders résolus À LA COPIE :
 *   - `{clipboard}` : contenu actuel du presse-papier
 *   - `{date}` / `{time}` / `{datetime}` : date/heure locale
 *   - `{uuid}` : UUID v4 (un nouveau par occurrence)
 *
 * Helpers PURS (sans dépendance Node) — `Intl`/`crypto` dispo des deux côtés.
 *
 * ⚠️ Synergie Clipboard chiffré : `{clipboard}` n'est résolu qu'au moment
 * de la copie — sa valeur (potentiellement un secret) n'est JAMAIS rendue
 * dans l'UI (les lignes du panneau montrent le body BRUT, placeholder
 * littéral). Aucun secret n'est donc exposé à l'écran.
 */
import type { Snippet } from './types';

/** Placeholders reconnus, pour l'aide. */
export const SNIPPET_PLACEHOLDERS = ['{clipboard}', '{date}', '{time}', '{datetime}', '{uuid}'];

/** Valide la forme d'un snippet (name + body non vides). */
export function isValidSnippet(s: Snippet): boolean {
  return (
    typeof s.name === 'string' &&
    s.name.trim().length > 0 &&
    typeof s.body === 'string' &&
    s.body.length > 0
  );
}

/**
 * Résout les placeholders d'un body. `{clipboard}` vient du contexte
 * (lu par l'appelant), `{date}`/`{time}`/`{datetime}` de `ctx.date`,
 * `{uuid}` est régénéré à chaque occurrence.
 */
export function resolveSnippet(
  body: string,
  ctx: { clipboard: string; date: Date },
): string {
  return body.replace(/\{(clipboard|date|time|datetime|uuid)\}/g, (_m, tok: string) => {
    switch (tok) {
      case 'clipboard':
        return ctx.clipboard;
      case 'date':
        return ctx.date.toLocaleDateString('fr-FR');
      case 'time':
        return ctx.date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      case 'datetime':
        return ctx.date.toLocaleString('fr-FR');
      case 'uuid':
        return globalThis.crypto.randomUUID();
      default:
        return _m;
    }
  });
}

/** Aperçu compact (1 ligne) du body, placeholders littéraux conservés. */
export function snippetPreview(body: string, max = 80): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}

/** Filtre les snippets dont le nom contient `query` (insensible à la casse). */
export function matchSnippets(snippets: Snippet[], query: string): Snippet[] {
  const q = query.trim().toLowerCase();
  if (!q) return snippets;
  return snippets.filter((s) => s.name.toLowerCase().includes(q));
}

/* ───────────── Édition texte (Settings) ───────────── */

/**
 * Format de l'éditeur : UNE ligne par snippet, `nom body`, où le `nom` est
 * le premier token (sans espace, comme un alias quicklink) et le `body` est
 * le reste de la ligne, avec les sauts de ligne encodés `\n` (deux
 * caractères : antislash + n).
 *
 * Ce format est volontairement SANS délimiteur en début de ligne (pas de
 * `## nom`) : un body markdown contenant une ligne `## Titre` ne peut donc
 * jamais être confondu avec un en-tête de snippet — la ligne commence
 * toujours par le nom. Cf. revue Lot 2 (perte de données au round-trip).
 *
 * Lignes vides et commentaires (`#` en tête) ignorés. Dédup par nom
 * (premier gagne).
 */
export function parseSnippetsText(text: string): Snippet[] {
  const out: Snippet[] = [];
  const seen = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(\S+)\s+([\s\S]+)$/.exec(line);
    if (!m) continue;
    const name = m[1];
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    const body = m[2].replace(/\\n/g, '\n');
    if (!body) continue;
    seen.add(key);
    out.push({ name, body });
  }
  return out;
}

/** Sérialise pour l'éditeur (une ligne `nom body` par snippet, `\n` échappés). */
export function serializeSnippets(snippets: Snippet[]): string {
  return snippets.map((s) => `${s.name} ${s.body.replace(/\n/g, '\\n')}`).join('\n');
}
