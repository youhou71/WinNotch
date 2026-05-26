/**
 * Helpers OAuth 2.0 Authorization Code + PKCE pour app desktop.
 *
 * Stratégie loopback (RFC 8252) :
 *  1. Le main process choisit un port libre et lance un mini HTTP server
 *     sur `http://127.0.0.1:<port>/callback`
 *  2. On génère un PKCE verifier + challenge S256
 *  3. On ouvre le navigateur de l'utilisateur sur l'URL d'autorisation
 *     du provider, en passant `redirect_uri=http://127.0.0.1:<port>/callback`
 *  4. L'utilisateur s'authentifie chez le provider, qui redirige vers
 *     notre loopback avec `?code=…&state=…`
 *  5. Le mini server capture le code, ferme l'onglet (page de remerciement),
 *     puis on échange le code contre des tokens via POST sur le token endpoint
 *
 * Pas de SDK lourd (msal-node, googleapis) : on parle directement HTTPS
 * avec les endpoints standards. Plus léger, plus compréhensible.
 */
import { shell } from 'electron';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { createHash, randomBytes } from 'crypto';

/** Résultat normalisé du flow OAuth. */
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Date d'expiration absolue (Unix ms). */
  expiresAt: number;
  /** Scopes effectivement accordés (peut différer de la demande). */
  scope: string;
}

/** Paramètres du provider OAuth. */
export interface OAuthProviderConfig {
  /** URL de la page d'autorisation (ex. `https://accounts.google.com/o/oauth2/v2/auth`). */
  authUrl: string;
  /** URL d'échange code → tokens (ex. `https://oauth2.googleapis.com/token`). */
  tokenUrl: string;
  /** clientId fourni par l'utilisateur. */
  clientId: string;
  /** clientSecret (Google obligatoire, Outlook absent). */
  clientSecret?: string;
  /** Scopes demandés, séparés par espaces. */
  scope: string;
  /**
   * Paramètres additionnels propres au provider (ex. `prompt=consent`,
   * `access_type=offline` pour Google, `response_mode` pour MS).
   */
  extraAuthParams?: Record<string, string>;
}

/** Page HTML rendue dans le navigateur quand l'auth réussit. */
const SUCCESS_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8" />
<title>Connexion réussie</title>
<style>
  body { margin:0;display:grid;place-items:center;height:100vh;font-family:system-ui,sans-serif;background:#0a0a0c;color:#f4f4f5; }
  .box { text-align:center;padding:40px;max-width:420px; }
  .box .check { font-size:48px;color:#34d399;margin-bottom:16px; }
  h1 { font-size:18px;font-weight:600;margin:0 0 8px; }
  p { font-size:13px;color:rgba(244,244,245,0.55);margin:0;line-height:1.5; }
</style></head><body><div class="box">
<div class="check">✓</div>
<h1>Connecté à WinNotch</h1>
<p>Vous pouvez fermer cet onglet et revenir à l'application.</p>
</div></body></html>`;

const FAILURE_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8" />
<title>Erreur de connexion</title>
<style>
  body { margin:0;display:grid;place-items:center;height:100vh;font-family:system-ui,sans-serif;background:#0a0a0c;color:#f4f4f5; }
  .box { text-align:center;padding:40px;max-width:420px; }
  .box .cross { font-size:48px;color:#ef4444;margin-bottom:16px; }
  h1 { font-size:18px;font-weight:600;margin:0 0 8px; }
  p { font-size:13px;color:rgba(244,244,245,0.55);margin:0;line-height:1.5; }
</style></head><body><div class="box">
<div class="cross">✕</div>
<h1>La connexion a échoué</h1>
<p>{{ERROR}}</p>
</div></body></html>`;

/**
 * Génère un PKCE verifier (43-128 chars) + challenge S256.
 * Le verifier est gardé en mémoire le temps de l'exchange, jamais persisté.
 */
function generatePkce(): { verifier: string; challenge: string } {
  // 32 octets aléatoires → base64url → ~43 chars (respecte la spec PKCE).
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Récupère le port d'écoute du server une fois en listening state.
 * Utile car `server.listen(0)` assigne un port dynamique qui n'est connu
 * qu'après l'event `listening`.
 */
function getPortFromServer(
  server: ReturnType<typeof createServer>,
): Promise<number> {
  return new Promise((resolve) => {
    const check = () => {
      const addr = server.address() as AddressInfo | null;
      if (addr && addr.port) resolve(addr.port);
      else setTimeout(check, 10);
    };
    check();
  });
}

/**
 * Flow OAuth complet : démarre le server, ouvre le navigateur, attend le
 * code, l'échange contre des tokens, ferme le server, retourne les tokens.
 */
export async function startAuthFlow(
  cfg: OAuthProviderConfig,
): Promise<OAuthTokens> {
  // 1. Lance le server loopback. On a besoin du port AVANT d'ouvrir le
  //    navigateur, donc on crée manuellement pour pouvoir le récupérer.
  const { verifier, challenge } = generatePkce();
  const state = randomBytes(16).toString('hex');

  // Server qu'on va piloter à la main pour pouvoir lire le port.
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = await getPortFromServer(server);
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // Promise qui résout sur le callback HTTP.
  const callbackPromise = new Promise<{ code: string; state: string }>(
    (resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { server.close(); } catch { /* ignore */ }
        reject(new Error('OAuth timeout — aucun callback reçu (2 min).'));
      }, 120_000);

      server.on('request', (req, res) => {
        if (!req.url) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
          res.statusCode = 404;
          res.end();
          return;
        }
        const code = url.searchParams.get('code');
        const stateBack = url.searchParams.get('state') ?? '';
        const error = url.searchParams.get('error');
        if (error) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(FAILURE_HTML.replace('{{ERROR}}', error));
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            setTimeout(() => server.close(), 200);
            reject(new Error(`OAuth error: ${error}`));
          }
          return;
        }
        if (!code) {
          res.statusCode = 400;
          res.end('Missing code');
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(SUCCESS_HTML);
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          setTimeout(() => server.close(), 200);
          resolve({ code, state: stateBack });
        }
      });
    },
  );

  // 2. Construit l'URL d'autorisation et ouvre le navigateur système.
  const authUrl = new URL(cfg.authUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', cfg.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', cfg.scope);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  for (const [k, v] of Object.entries(cfg.extraAuthParams ?? {})) {
    authUrl.searchParams.set(k, v);
  }
  await shell.openExternal(authUrl.toString());

  // 3. Attend le callback.
  const { code, state: stateBack } = await callbackPromise;
  if (stateBack !== state) {
    throw new Error('OAuth state mismatch — possible CSRF attempt');
  }

  // 4. Échange code → tokens.
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    code_verifier: verifier,
  });
  if (cfg.clientSecret) {
    tokenBody.set('client_secret', cfg.clientSecret);
  }
  const tokenRes = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '');
    throw new Error(
      `Token exchange failed (${tokenRes.status}): ${body || tokenRes.statusText}`,
    );
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };

  return {
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token ?? null,
    expiresAt: Date.now() + (tokenJson.expires_in - 60) * 1000, // marge 60 s
    scope: tokenJson.scope ?? cfg.scope,
  };
}

/**
 * Renouvelle un access token à partir d'un refresh token.
 * Retourne les nouveaux tokens — attention, le provider peut retourner
 * un nouveau refresh token (ou pas), à propager dans la persistance.
 */
export async function refreshAccessToken(
  cfg: Pick<OAuthProviderConfig, 'tokenUrl' | 'clientId' | 'clientSecret'>,
  refreshToken: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: cfg.clientId,
  });
  if (cfg.clientSecret) {
    body.set('client_secret', cfg.clientSecret);
  }
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(
      `Refresh failed (${res.status}): ${txt || res.statusText}`,
    );
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
    scope: json.scope ?? '',
  };
}
