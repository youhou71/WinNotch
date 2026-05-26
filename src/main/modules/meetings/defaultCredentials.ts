/**
 * Credentials OAuth embarqués au build (injection via electron-vite
 * depuis `.env.local`).
 *
 * Pattern : si `.env.local` définit les variables `MAIN_VITE_*`, elles
 * sont inlinées au build via `import.meta.env`. Le fichier `.env.local`
 * n'est PAS commit (cf. .gitignore), donc les credentials restent privés
 * sur la machine de build. L'installeur produit embarque les valeurs
 * dans son bundle.
 *
 * Précision sécurité : ces valeurs ne sont pas réellement "secrètes" au
 * sens cryptographique. Quiconque a accès à l'installeur ou au binaire
 * Electron peut les extraire (les strings sont en clair dans le bundle
 * JS du main process). C'est la pratique standard pour les desktop apps
 * publiques (VS Code, Slack, Discord embarquent leurs propres client_id
 * de la même manière).
 *
 * Le service meetings utilise ces valeurs comme **fallback** : si
 * l'utilisateur a saisi ses propres credentials dans les Settings,
 * ils prennent le pas sur ceux embarqués.
 */
import type {
  CalendarProviderId,
  OAuthClientCredentials,
} from '../../../shared/types';

/**
 * Lit les variables d'environnement injectées au build par
 * electron-vite. Retourne null si la variable est absente ou vide
 * (ex. l'utilisateur n'a pas configuré `.env.local`).
 */
function envOrNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Credentials Azure (Outlook) embarqués au build, ou null si absents.
 * `tenantId` par défaut "common" pour supporter à la fois les comptes
 * Microsoft 365 (work/school) et les comptes Microsoft personnels.
 */
function azureDefault(): OAuthClientCredentials | null {
  const clientId = envOrNull(import.meta.env.MAIN_VITE_AZURE_CLIENT_ID);
  if (!clientId) return null;
  return {
    clientId,
    tenantId: envOrNull(import.meta.env.MAIN_VITE_AZURE_TENANT_ID) ?? 'common',
  };
}

/**
 * Credentials Google embarqués au build, ou null si absents.
 * Le clientSecret est requis pour Google même en desktop app (il n'est
 * pas réellement secret, mais le flow l'exige).
 */
function googleDefault(): OAuthClientCredentials | null {
  const clientId = envOrNull(import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID);
  const clientSecret = envOrNull(
    import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET,
  );
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

const DEFAULTS: Record<CalendarProviderId, OAuthClientCredentials | null> = {
  outlook: azureDefault(),
  google: googleDefault(),
};

/** Retourne les credentials par défaut pour un provider, ou null. */
export function getDefaultCredentials(
  provider: CalendarProviderId,
): OAuthClientCredentials | null {
  return DEFAULTS[provider];
}

/** True si des credentials par défaut sont embarqués au build. */
export function hasDefaultCredentials(provider: CalendarProviderId): boolean {
  return DEFAULTS[provider] !== null;
}
