/**
 * Résolution best-effort du pays d'une IP via `ipapi.co`.
 *
 * - Cache en mémoire avec TTL 6 h pour éviter de spammer l'API (limite
 *   gratuite : 1000 requêtes / jour, on ne s'en approche pas en pratique).
 * - Pas de retry agressif : 1 tentative par IP, et même les échecs sont
 *   cachés négativement (sentinel `null`) pour ne pas hammer une IP qui
 *   répond toujours mal.
 * - Pas de dépendance externe — `node:https` suffit.
 *
 * Le module est désactivable globalement par l'utilisateur (config
 * `vpn.lookupCountry`) — l'appelant ne nous interroge alors simplement
 * pas.
 */
import https from 'https';

const TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 3000;

interface CacheEntry {
  country: string | null;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string | null>>();

function isValidIp(ip: string): boolean {
  // IPv4 simple. On évite IPv6 ici car ipapi.co requiert un format précis
  // et les VPN exposent quasi toujours une IPv4. On filtre aussi les
  // ranges RFC1918 / loopback pour ne pas faire d'appel inutile.
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1).map((n) => Number(n));
  if (parts.some((n) => n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return false;
  if (a === 127) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  if (a === 0) return false;
  return true;
}

/**
 * Effectue l'appel HTTPS. Retourne le nom du pays trimé, ou `null` en
 * cas d'erreur réseau, timeout, ou statut HTTP ≠ 200.
 */
function fetchCountry(ip: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const req = https.get(
      {
        hostname: 'ipapi.co',
        path: `/${encodeURIComponent(ip)}/country_name/`,
        headers: { 'User-Agent': 'WinNotch/VPN-status' },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          finish(null);
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => {
          const trimmed = body.trim();
          // ipapi.co renvoie parfois "Undefined" pour des IP inconnues
          if (!trimmed || trimmed.toLowerCase() === 'undefined') {
            finish(null);
            return;
          }
          finish(trimmed);
        });
        res.on('error', () => finish(null));
      },
    );

    req.on('timeout', () => {
      req.destroy();
      finish(null);
    });
    req.on('error', () => finish(null));
  });
}

/**
 * Résolution publique. Renvoie le pays cached (frais) ou déclenche un
 * fetch. Coalesce les appels concurrents sur la même IP pour ne pas
 * en envoyer plusieurs en parallèle.
 *
 * `null` = inconnu / IP privée / erreur réseau ; l'appelant doit le
 * traiter comme « pas d'info », pas comme une erreur fatale.
 */
export async function lookupCountry(ip: string | undefined | null): Promise<string | null> {
  if (!ip || !isValidIp(ip)) return null;
  const now = Date.now();
  const cached = cache.get(ip);
  if (cached && now - cached.fetchedAt < TTL_MS) {
    return cached.country;
  }
  const existing = inFlight.get(ip);
  if (existing) return existing;

  const promise = (async () => {
    const country = await fetchCountry(ip);
    cache.set(ip, { country, fetchedAt: Date.now() });
    inFlight.delete(ip);
    return country;
  })();
  inFlight.set(ip, promise);
  return promise;
}
