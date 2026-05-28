/**
 * Métadonnées d'affichage des modules dans la page Settings.
 *
 * Centralisé ici plutôt qu'embarqué dans chaque composant pour rester
 * cohérent entre la home Settings, les pages module, et un futur Tweaks
 * panel ou changelog.
 */
import type { ModuleId } from '../../../shared/types';

export interface ModuleMeta {
  id: ModuleId;
  label: string;
  icon: string;
  color: string;
  description: string;
}

export const SETTINGS_MODULES: ModuleMeta[] = [
  {
    id: 'music',
    label: 'Musique',
    icon: 'fa-solid fa-music',
    color: '#f472b6',
    description: 'Lecteur audio en cours (Spotify, navigateur, etc.).',
  },
  {
    id: 'meetings',
    label: 'Prochains rendez-vous',
    icon: 'fa-regular fa-calendar',
    color: '#60a5fa',
    description: "Agenda du jour (à venir).",
  },
  {
    id: 'gitlab',
    label: 'GitLab',
    icon: 'fa-brands fa-gitlab',
    color: '#FC6D26',
    description: 'MR, pipelines, commentaires (à venir).',
  },
  {
    id: 'gitlocal',
    label: 'Git local',
    icon: 'fa-solid fa-code-branch',
    color: '#f97316',
    description: 'Suivi de tes repos locaux (branche, uncommitted, ahead/behind).',
  },
  {
    id: 'claude',
    label: 'Claude Code',
    icon: 'fa-solid fa-sparkles',
    color: '#a78bfa',
    description: 'Sessions actives multi-projets (à venir).',
  },
  {
    id: 'tasks',
    label: 'Tâches',
    icon: 'fa-solid fa-list-check',
    color: '#34d399',
    description: 'Liste rapide via le préfixe « - ».',
  },
  {
    id: 'messages',
    label: 'Messages',
    icon: 'fa-solid fa-comment',
    color: '#60a5fa',
    description: 'Boîte unifiée WhatsApp, Messenger, etc. (à venir).',
  },
  {
    id: 'clipboard',
    label: 'Presse-papier intelligent',
    icon: 'fa-solid fa-clipboard',
    color: '#a78bfa',
    description:
      'Historique chiffré, détection URL/JSON/couleur/image, Ctrl+Shift+V.',
  },
  {
    id: 'vpn',
    label: 'VPN',
    icon: 'fa-solid fa-shield-halved',
    color: '#06b6d4',
    description:
      'État de connexion VPN (ProtonVPN, NordVPN, OpenVPN, WireGuard).',
  },
  {
    id: 'teams',
    label: 'Teams (présence)',
    icon: 'fa-solid fa-users',
    color: '#7c3aed',
    description:
      'Statut Microsoft Teams (Disponible / Occupé / NPD…) lu et écrit via Graph.',
  },
  {
    id: 'system',
    label: 'Système live',
    icon: 'fa-solid fa-gauge-high',
    color: '#34d399',
    description:
      'Utilisation CPU, RAM et réseau en temps réel avec sparkline.',
  },
];

export const MODULE_META_BY_ID: Record<ModuleId, ModuleMeta> =
  SETTINGS_MODULES.reduce(
    (acc, m) => {
      acc[m.id] = m;
      return acc;
    },
    {} as Record<ModuleId, ModuleMeta>,
  );
