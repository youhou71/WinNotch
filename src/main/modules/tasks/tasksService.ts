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
 * Aucun polling — purement event-driven (mutations utilisateur).
 */
import { ipcMain } from 'electron';
import Store from 'electron-store';
import { randomUUID } from 'crypto';
import {
  DEFAULT_SETTINGS,
  IpcChannel,
  type Settings,
  type Task,
} from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';

const store = new Store<Settings>({
  defaults: DEFAULT_SETTINGS,
  name: 'config',
});

function getTasks(): Task[] {
  return store.get('tasks');
}

function broadcast(tasks: Task[]): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.TasksChange, tasks);
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
  return tasks;
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
  const tasks = getTasks().filter((t) => t.id !== id);
  store.set('tasks', tasks);
  broadcast(tasks);
  return tasks;
}

function clearDoneTasks(): Task[] {
  const tasks = getTasks().filter((t) => !t.done);
  store.set('tasks', tasks);
  broadcast(tasks);
  return tasks;
}

export function registerTasksIpc(): void {
  ipcMain.handle(IpcChannel.TasksGetState, () => getTasks());
  ipcMain.handle(IpcChannel.TasksAdd, (_e, text: string) => addTask(text));
  ipcMain.handle(IpcChannel.TasksToggle, (_e, id: string) => toggleTask(id));
  ipcMain.handle(IpcChannel.TasksRemove, (_e, id: string) => removeTask(id));
  ipcMain.handle(IpcChannel.TasksClearDone, () => clearDoneTasks());
}

export function stopTasks(): void {
  // Pas de timer ni de ressource externe à libérer — purement event-driven.
}
