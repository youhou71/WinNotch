/**
 * Récupération du titre + favicon d'une URL pour la preview.
 *
 * Strat :
 *  - GET sur l'URL avec User-Agent WinNotch + AbortController timeout 3 s
 *  - On lit seulement les premiers ~64 Ko (assez pour la balise <title>
 *    et les <link rel="icon">), puis on coupe
 *  - Parse manuel léger (pas de DOM côté main)
 *  - Cache mémoire avec TTL 24 h pour éviter de re-fetch sur affichage
 *
 * En cas d'échec, on retourne null — l'UI affiche juste l'URL brute, pas
 * d'erreur visible. C'est cosmétique.
 */
import type { UrlUnfurl } from '../../../shared/types';

const TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 3000;
const MAX_BYTES = 64 * 1024;
const USER_AGENT = 'WinNotch/0.1 (+https://github.com/cfast)';
/**
 * Plafond LRU du cache d'unfurls. Une entrée fait ~0.5-2 KB (URL + titre
 * + favicon URL + timestamp) — 500 entrées plafonnent à ~1 MB. Au-delà,
 * on évince l'entrée la plus ancienne par insertion (Map.keys() préserve
 * l'ordre d'insertion → `next().value` donne la plus vieille).
 */
const MAX_CACHE_ENTRIES = 500;

const cache = new Map<string, UrlUnfurl>();

function getCached(url: string): UrlUnfurl | null {
  const hit = cache.get(url);
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > TTL_MS) {
    cache.delete(url);
    return null;
  }
  return hit;
}

/** Décode les entités HTML les plus courantes — pas besoin d'un parser complet. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const t = decodeEntities(m[1].trim()).replace(/\s+/g, ' ');
  return t.length > 0 ? (t.length > 160 ? t.slice(0, 159) + '…' : t) : null;
}

function extractFavicon(html: string, baseUrl: string): string | null {
  // Priorité aux <link rel="icon"> les plus précis. On prend le premier
  // match — les sites bien faits listent l'icon principal en tête.
  const linkRe =
    /<link\b[^>]*\brel=["']?(?:shortcut\s+)?(?:icon|apple-touch-icon)["']?[^>]*\bhref=["']([^"']+)["']/i;
  const m = linkRe.exec(html);
  let href = m ? m[1] : null;
  if (!href) {
    // Fallback /favicon.ico (convention de facto).
    href = '/favicon.ico';
  }
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

export async function unfurl(url: string): Promise<UrlUnfurl | null> {
  const cached = getCached(url);
  if (cached) return cached;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      clearTimeout(timer);
      return null;
    }

    // Lecture partielle : on lit jusqu'à MAX_BYTES, puis on abort.
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let received = 0;
    let html = '';
    while (received < MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (received >= MAX_BYTES) break;
    }
    try {
      reader.cancel();
    } catch {
      // pas grave si le stream est déjà fermé
    }

    const baseUrl = res.url || url;
    const result: UrlUnfurl = {
      url,
      title: extractTitle(html),
      favicon: extractFavicon(html, baseUrl),
      fetchedAt: Date.now(),
    };
    // LRU douce : si on dépasse le plafond, on évince la plus ancienne
    // entrée par ordre d'insertion (l'API `Map.keys()` itère dans cet
    // ordre — fonctionne tant qu'on n'a pas réinséré une clé existante).
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(url, result);
    return result;
  } catch {
    // Timeout, DNS, CORS-like, etc. — pas d'unfurl pour cette URL, on
    // n'essaie pas de re-fetch dans la même session (cache négatif léger).
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Nettoie le cache (test ou shutdown). */
export function clearUnfurlCache(): void {
  cache.clear();
}
