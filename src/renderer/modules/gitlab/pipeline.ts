/**
 * Helpers renderer pour le pipeline GitLab (Lot 3 #9) :
 *  - `pipelineMeta` : mapping statut → libellé / couleur / icône Font Awesome.
 *  - `fetchMrDetailCached` : appel IPC `gitlab:mrDetail` mémoïsé (TTL 60 s,
 *    clé `projectId:iid`) pour le tooltip au survol — déduplique aussi les
 *    survols concurrents (on cache la PROMESSE, pas seulement la valeur).
 */
import type { GitLabMrDetail } from '../../../shared/types';

export interface PipelineMeta {
  label: string;
  color: string;
  /** Classe Font Awesome (sans le `fa-solid` préfixe). */
  icon: string;
}

export function pipelineMeta(status: string | null): PipelineMeta | null {
  switch (status) {
    case null:
    case undefined:
    case '':
      return null;
    case 'success':
      return { label: 'pipeline OK', color: '#34d399', icon: 'fa-circle-check' };
    case 'failed':
      return { label: 'pipeline échoué', color: '#ef4444', icon: 'fa-circle-xmark' };
    case 'running':
      return { label: 'pipeline en cours', color: '#60a5fa', icon: 'fa-circle-notch fa-spin' };
    case 'pending':
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
    case 'scheduled':
      return { label: 'pipeline en attente', color: '#fbbf24', icon: 'fa-clock' };
    case 'canceled':
      return { label: 'pipeline annulé', color: '#94a3b8', icon: 'fa-ban' };
    case 'skipped':
      return { label: 'pipeline ignoré', color: '#94a3b8', icon: 'fa-forward-step' };
    case 'manual':
      return { label: 'action manuelle', color: '#a78bfa', icon: 'fa-hand-pointer' };
    default:
      return { label: `pipeline ${status}`, color: '#94a3b8', icon: 'fa-circle' };
  }
}

const TTL_MS = 60_000;
/**
 * Plafond du cache. Le notch est un widget always-on qui n'est jamais
 * rechargé : sans borne, une entrée serait ajoutée par MR distincte survolée
 * et jamais libérée (croissance mémoire monotone sur des jours d'uptime).
 */
const MAX_CACHE_ENTRIES = 100;
const cache = new Map<string, { at: number; promise: Promise<GitLabMrDetail> }>();

/** Détail MR mémoïsé (TTL 60 s). Réutilise une requête en vol pour la même MR. */
export function fetchMrDetailCached(
  projectId: number,
  iid: number,
): Promise<GitLabMrDetail> {
  const key = `${projectId}:${iid}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  // Entrée périmée : on la retire d'abord pour qu'un éventuel re-cache reparte
  // en fin d'ordre d'insertion (Map.set sur une clé existante conserverait sa
  // position d'origine et fausserait l'éviction FIFO ci-dessous).
  if (hit) cache.delete(key);
  const promise = window.notch.gitlab.mrDetail(projectId, iid);
  // LRU douce : évince la plus ancienne entrée par ordre d'insertion si on
  // atteint le plafond (même pattern que urlUnfurl.ts).
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), promise });
  return promise;
}
