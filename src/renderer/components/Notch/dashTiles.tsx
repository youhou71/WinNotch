/**
 * Mapping partagé des tuiles du dashboard : `tile.id` → composant Card, et
 * filtre de visibilité d'une tuile.
 *
 * Source de vérité UNIQUE consommée par :
 *  - `ExpandedDashboard` (rendu réel du dashboard)
 *  - `SettingsLayoutPage` (éditeur WYSIWYG « Disposition du dashboard »)
 *
 * Garder ces deux usages alignés est l'enjeu : l'éditeur doit montrer
 * EXACTEMENT les mêmes tuiles, dans la même forme, que le dashboard réel.
 * Tout ajout de tuile se fait ici (et dans `DashTileId` / `dashboardLayout`).
 */
import type { ReactNode } from 'react';
import type { DashTile, DashTileId, Settings } from '../../../shared/types';
import { TasksCounterCard } from '../../modules/tasks/TasksCounterCard';
import { MeetingsCard } from '../../modules/meetings/MeetingsCard';
import { MusicCard } from '../../modules/music/MusicCard';
import { GitLabCard } from '../../modules/gitlab/GitLabCard';
import { ClaudeCard } from '../../modules/claude/ClaudeCard';
import { ClaudeUsageCard } from '../../modules/claudeUsage/ClaudeUsageCard';
import { GitLocalCard } from '../../modules/gitlocal/GitLocalCard';
import { VpnCard } from '../../modules/vpn/VpnCard';
import { TeamsCard } from '../../modules/teams/TeamsCard';
import { SystemCard } from '../../modules/system/SystemCard';
import { BambuCard } from '../../modules/bambu/BambuCard';

/**
 * Callbacks d'ouverture passés aux cards qui drillent vers une page plein
 * dashboard. Optionnels : en mode édition on les omet (les cards sont rendues
 * inertes de toute façon).
 */
export interface TileCallbacks {
  onOpenTasks?: () => void;
  onOpenGitlab?: () => void;
  onOpenGitlocal?: () => void;
}

const noop = () => {};

/**
 * Rend le composant Card correspondant à une tuile du dashboard.
 * Appeler sans `cb` (mode édition) rend des cards aux callbacks no-op.
 */
export function renderTileCard(id: DashTileId, cb: TileCallbacks = {}): ReactNode {
  switch (id) {
    case 'tasks':
      return <TasksCounterCard onOpen={cb.onOpenTasks ?? noop} />;
    case 'meetings':
      return <MeetingsCard />;
    case 'music':
      return <MusicCard />;
    case 'gitlab':
      return <GitLabCard onOpen={cb.onOpenGitlab ?? noop} />;
    case 'claude.live':
      return <ClaudeCard />;
    case 'claude.usage':
      return <ClaudeUsageCard />;
    case 'gitlocal':
      return <GitLocalCard onOpen={cb.onOpenGitlocal ?? noop} />;
    case 'vpn':
      return <VpnCard />;
    case 'teams':
      return <TeamsCard />;
    case 'system':
      return <SystemCard />;
    case 'bambu':
      return <BambuCard />;
    default:
      return null;
  }
}

/**
 * Contexte minimal nécessaire pour décider si une tuile est affichée.
 * `hasMusic` = piste en cours ; `hasClaude` = au moins une session active
 * ET la card Claude n'est pas masquée (cf. ExpandedDashboard).
 */
export interface TileVisibilityCtx {
  modules: Settings['modules'];
  moduleConfig: Settings['moduleConfig'];
  hasMusic: boolean;
  hasClaude: boolean;
}

/**
 * Vrai si la tuile doit apparaître dans le dashboard (et donc dans
 * l'éditeur). Mêmes règles que le rendu réel :
 *  - module activé
 *  - card non masquée (`showCard !== false`)
 *  - music : seulement avec une piste en cours
 *  - claude.live : seulement avec une session active
 */
export function isTileVisible(tile: DashTile, ctx: TileVisibilityCtx): boolean {
  if (!ctx.modules[tile.id]) return false;
  const cfg = ctx.moduleConfig[tile.id] as { showCard?: boolean } | undefined;
  if (cfg?.showCard === false) return false;
  if (tile.id === 'music' && !ctx.hasMusic) return false;
  if (tile.id === 'claude.live' && !ctx.hasClaude) return false;
  return true;
}
