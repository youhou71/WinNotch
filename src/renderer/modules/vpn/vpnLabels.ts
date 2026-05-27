/**
 * Helpers d'affichage partagés entre la chip et la card VPN.
 */
import type { VpnClient, VpnConnection } from '../../../shared/types';

const CLIENT_LABELS: Record<VpnClient, string> = {
  protonvpn: 'ProtonVPN',
  nordvpn: 'NordVPN',
  openvpn: 'OpenVPN',
  wireguard: 'WireGuard',
  'windows-native': 'VPN Windows',
  unknown: 'VPN',
};

export function clientLabel(client: VpnClient): string {
  return CLIENT_LABELS[client] ?? 'VPN';
}

/**
 * Format compact "1 h 23", "12 min", "42 s". Renvoie `null` si la durée
 * est marquée comme approximative (le composant masquera alors la valeur).
 */
export function formatDuration(conn: VpnConnection, now: number): string | null {
  if (conn.connectedSinceIsApprox) return null;
  const seconds = Math.max(0, Math.round((now - conn.connectedSince) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes - hours * 60;
  if (remaining === 0) return `${hours} h`;
  return `${hours} h ${remaining}`;
}

/**
 * Construit un sous-titre court : "tunnel-perso · France · 42 min" en
 * concaténant les infos disponibles. Les segments absents sont sautés
 * pour éviter les " ·  · " disgracieux.
 */
export function buildSubtitle(conn: VpnConnection, now: number): string {
  const parts: string[] = [];
  if (conn.connectionName) parts.push(conn.connectionName);
  if (conn.country) parts.push(conn.country);
  const duration = formatDuration(conn, now);
  if (duration) parts.push(duration);
  return parts.join(' · ');
}
