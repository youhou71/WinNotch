/**
 * Métadonnées d'affichage des **groupes** de modules dans Settings.
 *
 * Un groupe est une famille de modules logiquement liés, qui partagent
 * la même section repliée dans Settings → Modules. Chaque sous-module du
 * groupe garde son propre toggle, sa propre config et sa propre page
 * drilldown — le groupe n'apporte qu'un en-tête visuel et un mécanisme
 * d'extension propre pour des futures familles (Communication = Teams +
 * Slack, Code review = GitLab + GitHub, etc.).
 *
 * Les IDs ici doivent matcher la partie avant le `.` dans les `ModuleId`
 * hiérarchiques (cf. `shared/types.ts`).
 */
import type { ModuleGroupId } from '../../../shared/types';

export interface ModuleGroupMeta {
  id: ModuleGroupId;
  label: string;
  icon: string;
  color: string;
  description: string;
}

export const MODULE_GROUPS: Record<ModuleGroupId, ModuleGroupMeta> = {
  claude: {
    id: 'claude',
    label: 'Claude',
    icon: 'fa-solid fa-robot',
    color: '#a78bfa',
    description:
      "Sessions Claude Code actives et suivi des limites d'usage Pro / Max.",
  },
};
