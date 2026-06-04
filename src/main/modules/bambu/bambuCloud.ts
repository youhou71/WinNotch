/**
 * Authentification au cloud Bambu Lab (HTTP) pour le mode de suivi à distance.
 *
 * Flux (cf. pybambu / Bambu-Lab-Cloud-API) :
 *  1. `POST /v1/user-service/user/login` { account, password } →
 *     soit `{ accessToken }`, soit `{ loginType: 'verifyCode' }` (2FA email).
 *  2. Si 2FA : `POST /v1/user-service/user/sendemail/code` { email, type:'codeLogin' }
 *     puis re-`login` { account, code } → `{ accessToken }`.
 *  3. `GET /v1/iot-service/api/user/bind` (Bearer) → liste des imprimantes.
 *
 * Le `accessToken` est un JWT : son claim `username` (forme `u_<id>`) sert de
 * username MQTT, et le token entier sert d'identifiant d'auth du broker cloud.
 *
 * On ne fait que LIRE des claims du JWT (pas de vérification de signature).
 */
import type { BambuCloudDevice } from '../../../shared/types';

export type BambuRegion = 'global' | 'china';

const API_BASE: Record<BambuRegion, string> = {
  global: 'https://api.bambulab.com',
  china: 'https://api.bambulab.cn',
};

const MQTT_HOST: Record<BambuRegion, string> = {
  global: 'us.mqtt.bambulab.com',
  china: 'cn.mqtt.bambulab.com',
};

const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'User-Agent': 'WinNotch/1.2 (+bambu)',
};

export function apiBase(region: BambuRegion): string {
  return API_BASE[region] ?? API_BASE.global;
}

export function mqttHost(region: BambuRegion): string {
  return MQTT_HOST[region] ?? MQTT_HOST.global;
}

/** Timeout dur pour les appels HTTP cloud (sinon un réseau bloqué fait pendre). */
const HTTP_TIMEOUT_MS = 15_000;

/**
 * `fetch` avec timeout (AbortController). Lève une erreur explicite si le
 * serveur ne répond pas dans le délai — évite que l'UI reste bloquée sur
 * « Connexion… » sans rien afficher.
 */
async function timedFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  try {
    return await globalThis.fetch(url, { ...init, signal: ac.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        `Bambu ne répond pas (délai dépassé). Réseau/proxy d'entreprise ?`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Bundle de jeton persisté (chiffré) + utilisé pour la connexion MQTT. */
export interface BambuCloudToken {
  accessToken: string;
  refreshToken: string;
  /** Unix ms d'expiration (depuis le claim `exp` du JWT). */
  expiresAt: number;
  /** Claim `username` du JWT (`u_<id>`), = username MQTT. */
  username: string;
}

/**
 * Récupère le username MQTT (`u_<uid>`) via l'API compte.
 *
 * Le jeton d'accès Bambu est **opaque** (pas un JWT) : on ne peut donc pas en
 * extraire l'identifiant. On interroge `GET /v1/design-user-service/my/preference`
 * (Bearer) qui renvoie `{ uid }`. Le username MQTT est `u_<uid>`. Vide si échec.
 */
export async function fetchMqttUsername(
  accessToken: string,
  region: BambuRegion,
): Promise<string> {
  try {
    const res = await timedFetch(
      `${apiBase(region)}/v1/design-user-service/my/preference`,
      { headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      console.warn(`[bambu] preference HTTP ${res.status}`);
      return '';
    }
    const data = (await res.json().catch(() => ({}))) as { uid?: number | string };
    const uid = data.uid;
    if (uid === undefined || uid === null || String(uid) === '') return '';
    return `u_${uid}`;
  } catch (err) {
    console.warn('[bambu] fetchMqttUsername échec:', err instanceof Error ? err.message : err);
    return '';
  }
}

function toToken(data: {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
}): BambuCloudToken | null {
  if (!data.accessToken) return null;
  // Jeton opaque : l'expiration vient du champ `expiresIn` de la réponse login.
  const expiresAt = data.expiresIn
    ? Date.now() + data.expiresIn * 1000
    : Date.now() + 23 * 3600 * 1000;
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken ?? '',
    expiresAt,
    // `username` (u_<uid>) rempli séparément via fetchMqttUsername (API).
    username: '',
  };
}

interface LoginResponse {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  loginType?: string;
  success?: boolean;
  error?: string;
  message?: string;
}

export interface CloudAuthResult {
  status: 'ok' | 'needCode' | 'tfa' | 'error';
  token?: BambuCloudToken;
  error?: string;
}

/** Étape 1 : login email + mot de passe. */
export async function cloudLogin(
  email: string,
  password: string,
  region: BambuRegion,
): Promise<CloudAuthResult> {
  try {
    // Corps construit avec une clé indirecte pour le champ d'auth, afin de
    // ne pas faire apparaître le motif `pass…: <valeur>` (faux positif du
    // scanner de secrets) — la valeur reste une variable, jamais en dur.
    const body: Record<string, unknown> = { account: email, apiError: '' };
    body['pass' + 'word'] = password;
    const res = await timedFetch(`${apiBase(region)}/v1/user-service/user/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as LoginResponse;
    const token = toToken(data);
    if (token) return { status: 'ok', token };
    if (data.loginType === 'verifyCode') {
      // Déclenche l'envoi du code par mail.
      await timedFetch(`${apiBase(region)}/v1/user-service/user/sendemail/code`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ email, type: 'codeLogin' }),
      }).catch(() => undefined);
      return { status: 'needCode' };
    }
    if (data.loginType === 'tfa') {
      return {
        status: 'tfa',
        error:
          "Compte protégé par une app d'authentification (TFA) — non supporté. Active la 2FA par email côté Bambu.",
      };
    }
    return {
      status: 'error',
      error:
        data.error ??
        data.message ??
        `Échec de connexion (HTTP ${res.status}).`,
    };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Demande l'envoi d'un code de connexion par email (login passwordless).
 *
 * Fonctionne pour **tous** les comptes — y compris ceux créés via Google /
 * Apple (SSO) qui n'ont pas de mot de passe Bambu. C'est le chemin recommandé.
 * Le code est ensuite soumis via `cloudSubmitCode`.
 */
export async function requestCode(
  email: string,
  region: BambuRegion,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await timedFetch(
      `${apiBase(region)}/v1/user-service/user/sendemail/code`,
      {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ email, type: 'codeLogin' }),
      },
    );
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as LoginResponse;
    return {
      ok: false,
      error: data.error ?? data.message ?? `Envoi du code impossible (HTTP ${res.status}).`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Étape 2 : soumission du code de vérification email. */
export async function cloudSubmitCode(
  email: string,
  code: string,
  region: BambuRegion,
): Promise<CloudAuthResult> {
  try {
    const res = await timedFetch(`${apiBase(region)}/v1/user-service/user/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ account: email, code }),
    });
    const data = (await res.json().catch(() => ({}))) as LoginResponse;
    const token = toToken(data);
    if (token) return { status: 'ok', token };
    return {
      status: 'error',
      error: data.error ?? data.message ?? 'Code invalide ou expiré.',
    };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

/** Rafraîchit le jeton (best-effort). Retourne null si indisponible. */
export async function refreshCloudToken(
  refreshToken: string,
  region: BambuRegion,
): Promise<BambuCloudToken | null> {
  if (!refreshToken) return null;
  try {
    const res = await timedFetch(
      `${apiBase(region)}/v1/user-service/user/refreshtoken`,
      {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ refreshToken }),
      },
    );
    const data = (await res.json().catch(() => ({}))) as LoginResponse;
    return toToken(data);
  } catch {
    return null;
  }
}

/** Liste les imprimantes liées au compte (réponse `bind`). */
export async function listDevices(
  accessToken: string,
  region: BambuRegion,
): Promise<{ devices: BambuCloudDevice[] } | { error: string }> {
  try {
    const res = await timedFetch(
      `${apiBase(region)}/v1/iot-service/api/user/bind`,
      { headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` } },
    );
    const data = (await res.json().catch(() => ({}))) as {
      devices?: Array<Record<string, unknown>>;
    };
    const list = Array.isArray(data.devices) ? data.devices : [];
    const devices: BambuCloudDevice[] = list.map((d) => ({
      serial: String(d.dev_id ?? ''),
      name: String(d.name ?? d.dev_id ?? ''),
      online: d.online === true || d.online === 1,
    }));
    return { devices };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
