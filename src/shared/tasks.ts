/**
 * Règles partagées du module Tasks — helpers PURS, utilisés côté main
 * (`tasksAnalyzer.ts`, choix des tâches à soumettre) et côté renderer
 * (pastille « en attente », bouton « Analyser »), pour qu'une tâche ne
 * soit jamais « en attente » à l'écran sans l'être pour l'analyseur.
 */
import type { Task } from './types';

/**
 * La tâche a-t-elle besoin d'une (nouvelle) analyse Claude ?
 *  - jamais analysée, ou libellé modifié depuis la dernière analyse ;
 *  - `force` (bouton manuel) : aussi les tâches en erreur, même inchangées.
 * Une erreur n'est pas retentée automatiquement tant que le libellé ne
 * bouge pas — sinon une panne (claude introuvable…) tournerait en boucle.
 */
export function needsAnalysis(task: Task, force = false): boolean {
  if (task.done) return false;
  const a = task.analysis;
  if (!a) return true;
  if (a.status === 'running') return false;
  if (a.analyzedText !== task.text) return true;
  return force && a.status === 'error';
}
