/**
 * Service du module Tasks (liste de tâches locales).
 *
 * Persistance : `Task[]` au top-level de `Settings` (electron-store). Le
 * champ `tasks` survit aux refontes des autres modules — pas besoin d'un
 * fichier dédié.
 *
 * Pourquoi un service séparé plutôt que de garder la logique dans
 * `settingsService` ? Cohérence inter-modules : chaque domaine fonctionnel
 * a son service + Context (cleanup v1). Settings continue d'agréger la
 * lecture (`getAll()` retourne aussi `tasks`), mais les mutations passent
 * désormais par `tasks:*` et déclenchent un broadcast `tasks:change`
 * spécifique (au lieu de re-pousser tout `Settings`).
 *
 * Aucun polling — purement event-driven (mutations utilisateur). L'analyse
 * Claude Code des tâches vit dans `tasksAnalyzer.ts` ; ce service se
 * contente de la planifier à chaque ajout / changement de libellé.
 */
import { ipcMain, shell } from 'electron';
import Store from 'electron-store';
import { randomUUID } from 'crypto';
import {
  DEFAULT_SETTINGS,
  IpcChannel,
  type Settings,
  type Task,
} from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import {
  analyzeNow,
  discardConclusions,
  scheduleAnalysis,
  startAnalyzer,
} from './tasksAnalyzer';

const store = new Store<Settings>({
  defaults: DEFAULT_SETTINGS,
  name: 'config',
});

export function getTasks(): Task[] {
  return store.get('tasks');
}

/** Réglage « analyse automatique » (lu à chaque fois : modifiable à chaud). */
export function isAutoAnalyzeEnabled(): boolean {
  return store.get('moduleConfig').tasks?.autoAnalyze !== false;
}

/** Dossier des conclusions tel que réglé (chaîne vide = défaut userData). */
export function getConfiguredConclusionsDir(): string {
  return store.get('moduleConfig').tasks?.conclusionsDir?.trim() ?? '';
}

function broadcast(tasks: Task[]): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.TasksChange, tasks);
}

/**
 * Applique `patch` à chaque tâche dont l'id est dans `ids`, relue fraîche
 * depuis le store — l'analyseur l'appelle à la fin d'un `claude -p` qui a
 * pu durer plusieurs minutes, pendant lesquelles l'utilisateur a pu
 * éditer, cocher ou supprimer des tâches. Une tâche supprimée entre-temps
 * est simplement ignorée.
 */
export function patchTasks(
  ids: string[],
  patch: (task: Task) => Task,
): Task[] {
  const set = new Set(ids);
  const tasks = getTasks().map((t) => (set.has(t.id) ? patch(t) : t));
  store.set('tasks', tasks);
  broadcast(tasks);
  return tasks;
}

function addTask(text: string): Task[] {
  const trimmed = text.trim();
  if (!trimmed) return getTasks();
  const task: Task = {
    id: randomUUID(),
    text: trimmed,
    done: false,
    createdAt: Date.now(),
  };
  const tasks = [task, ...getTasks()];
  store.set('tasks', tasks);
  broadcast(tasks);
  scheduleAnalysis();
  return tasks;
}

/**
 * Réécrit le libellé d'une tâche.
 *
 * Un texte vide est **ignoré** plutôt que traité comme une suppression :
 * l'utilisateur qui efface tout dans le champ inline puis valide par
 * inadvertance ne doit pas perdre sa tâche — il a la croix pour ça.
 * `done` et `createdAt` sont préservés (une correction de libellé n'est
 * pas une nouvelle tâche). L'analyse, elle, est conservée : c'est
 * `analyzedText` ≠ `text` qui la marque comme périmée et la replanifie.
 */
function updateTask(id: string, text: string): Task[] {
  const trimmed = text.trim();
  if (!trimmed) return getTasks();
  const tasks = getTasks().map((t) =>
    t.id === id ? { ...t, text: trimmed } : t,
  );
  store.set('tasks', tasks);
  broadcast(tasks);
  scheduleAnalysis();
  return tasks;
}

/**
 * Réordonne selon `ids` (ordre voulu). Défensif vis-à-vis d'une liste
 * désynchronisée (broadcast croisé pendant un drag) : les ids inconnus
 * sont ignorés et les tâches absentes de `ids` sont recollées à la fin,
 * dans leur ordre relatif d'origine — aucune tâche ne peut être perdue.
 */
function reorderTasks(ids: string[]): Task[] {
  if (!Array.isArray(ids)) return getTasks();
  const current = getTasks();
  const byId = new Map(current.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const ordered: Task[] = [];
  for (const id of ids) {
    const t = byId.get(id);
    if (t && !seen.has(id)) {
      ordered.push(t);
      seen.add(id);
    }
  }
  for (const t of current) if (!seen.has(t.id)) ordered.push(t);
  store.set('tasks', ordered);
  broadcast(ordered);
  return ordered;
}

/**
 * Ouvre la conclusion Markdown avec l'application associée à `.md`.
 * Le chemin vient du store (écrit par l'analyseur), jamais du renderer :
 * seul l'id transite par l'IPC.
 */
async function openConclusion(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const path = getTasks().find((t) => t.id === id)?.analysis?.conclusionPath;
  if (!path) return { ok: false, error: 'Aucune conclusion pour cette tâche' };
  const err = await shell.openPath(path);
  return err ? { ok: false, error: err } : { ok: true };
}

function toggleTask(id: string): Task[] {
  const tasks = getTasks().map((t) =>
    t.id === id ? { ...t, done: !t.done } : t,
  );
  store.set('tasks', tasks);
  broadcast(tasks);
  return tasks;
}

function removeTask(id: string): Task[] {
  const all = getTasks();
  discardConclusions(all.filter((t) => t.id === id));
  const tasks = all.filter((t) => t.id !== id);
  store.set('tasks', tasks);
  broadcast(tasks);
  return tasks;
}

function clearDoneTasks(): Task[] {
  const all = getTasks();
  discardConclusions(all.filter((t) => t.done));
  const tasks = all.filter((t) => !t.done);
  store.set('tasks', tasks);
  broadcast(tasks);
  return tasks;
}

export function registerTasksIpc(): void {
  ipcMain.handle(IpcChannel.TasksGetState, () => getTasks());
  ipcMain.handle(IpcChannel.TasksAdd, (_e, text: string) => addTask(text));
  ipcMain.handle(IpcChannel.TasksUpdate, (_e, id: string, text: string) =>
    updateTask(id, text),
  );
  ipcMain.handle(IpcChannel.TasksToggle, (_e, id: string) => toggleTask(id));
  ipcMain.handle(IpcChannel.TasksRemove, (_e, id: string) => removeTask(id));
  ipcMain.handle(IpcChannel.TasksClearDone, () => clearDoneTasks());
  ipcMain.handle(IpcChannel.TasksReorder, (_e, ids: string[]) =>
    reorderTasks(ids),
  );
  ipcMain.handle(IpcChannel.TasksAnalyze, () => analyzeNow());
  ipcMain.handle(IpcChannel.TasksOpenConclusion, (_e, id: string) =>
    openConclusion(id),
  );
  startAnalyzer();
}

export { stopAnalyzer as stopTasks } from './tasksAnalyzer';
