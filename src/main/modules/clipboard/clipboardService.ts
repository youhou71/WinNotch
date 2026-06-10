/**
 * Service IPC du module Clipboard.
 *
 * Responsabilités :
 *  - Démarre le watcher du presse-papier (polling 700 ms)
 *  - À chaque changement détecté, fait passer le contenu dans le
 *    pipeline de détection (`detectors/`) pour typer l'entrée
 *  - Maintient un cache mémoire de `ClipboardState` + persistance
 *    chiffrée (`clipboardStore`)
 *  - Stocke les images en PNG sur disque (`imageStore`)
 *  - Expose les handlers IPC (getState, pin/unpin, copyAgain, remove,
 *    clear, markSeen, unfurl, saveImage, openPath)
 *
 * Lecture des settings : on relit `moduleConfig.clipboard` à chaque
 * usage (cheap, et évite de gérer un cache invalidé par les updates
 * utilisateur). Le store electron-store partage le fichier `config.json`
 * avec settingsService.
 */
import { clipboard, dialog, ipcMain, nativeImage, shell } from 'electron';
import { copyFileSync, existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import Store from 'electron-store';
import {
  DEFAULT_SETTINGS,
  IpcChannel,
  type ClipboardEntry,
  type ClipboardState,
  type ModuleConfig,
  type Settings,
} from '../../../shared/types';
import { getNotchWindow } from '../../window/notchWindow';
import { detectClipboard } from './detectors';
import {
  flushHistory,
  loadHistory,
  loadLastSeenAt,
  saveHistory,
  saveLastSeenAt,
} from './clipboardStore';
import { deleteImage, saveImage } from './imageStore';
import { unfurl as fetchUnfurl } from './urlUnfurl';
import {
  markSelfWrite,
  startClipboardWatcher,
  stopClipboardWatcher,
} from './clipboardWatcher';

// Store partagé avec settingsService (même fichier `config.json`). On lit
// uniquement `moduleConfig.clipboard` — pas d'écriture ici, pour
// préserver l'autorité de settingsService sur les Settings.
const settingsStore = new Store<Settings>({
  defaults: DEFAULT_SETTINGS,
  name: 'config',
});

function getConfig(): ModuleConfig['clipboard'] {
  const cfg = settingsStore.get('moduleConfig');
  return cfg.clipboard ?? DEFAULT_SETTINGS.moduleConfig.clipboard;
}

function isModuleEnabled(): boolean {
  const modules = settingsStore.get('modules');
  return modules.clipboard ?? true;
}

/* ───────────── Cache mémoire ───────────── */

let cached: ClipboardState = { entries: [], lastSeenAt: 0 };

function sortEntries(entries: ClipboardEntry[]): ClipboardEntry[] {
  // Épinglés en tête, puis non-épinglés ; au sein de chaque groupe,
  // tri antéchronologique par copiedAt.
  return [...entries].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.copiedAt - a.copiedAt;
  });
}

function evictOverLimit(entries: ClipboardEntry[]): ClipboardEntry[] {
  const { maxItems } = getConfig();
  const pinned = entries.filter((e) => e.pinned);
  const unpinned = entries.filter((e) => !e.pinned);
  if (unpinned.length <= maxItems) return entries;
  // Tri par copiedAt DESC sur les non-épinglés, on garde les maxItems
  // plus récents, on supprime les autres (avec leurs PNG).
  unpinned.sort((a, b) => b.copiedAt - a.copiedAt);
  const kept = unpinned.slice(0, maxItems);
  const dropped = unpinned.slice(maxItems);
  for (const d of dropped) deleteImage(d.imagePath);
  return [...pinned, ...kept];
}

function broadcast(): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.ClipboardChange, cached);
}

function commit(nextEntries: ClipboardEntry[]): ClipboardState {
  const trimmed = evictOverLimit(nextEntries);
  const sorted = sortEntries(trimmed);
  cached = { ...cached, entries: sorted };
  saveHistory(sorted);
  broadcast();
  return cached;
}

/* ───────────── Watcher → nouvelle entrée ───────────── */

/**
 * Au-delà de cette taille, un texte copié n'entre pas dans l'historique :
 * chaque commit re-chiffre (DPAPI) et re-sérialise l'historique COMPLET —
 * un blob de plusieurs Mo (dump SQL, gros JSON…) ferait exploser le coût
 * de chaque copie suivante. On ne tronque pas (un « Copier à nouveau »
 * collerait silencieusement un contenu amputé) : on ignore l'entrée.
 */
const MAX_TEXT_ENTRY_BYTES = 256 * 1024;

function onClipboardChange(text: string, image: Electron.NativeImage | null): void {
  if (!isModuleEnabled()) return;

  if (!image && Buffer.byteLength(text, 'utf8') > MAX_TEXT_ENTRY_BYTES) {
    console.log(
      `[clipboard] texte copié > ${MAX_TEXT_ENTRY_BYTES / 1024} Ko — non historisé (le presse-papier système n'est pas affecté)`,
    );
    return;
  }

  const detection = detectClipboard(text, image);
  if (!detection) return;

  // Si l'entrée existe déjà à l'identique en haut de la liste (texte +
  // type), on ne crée pas de doublon — on remonte juste son timestamp.
  // Utile quand l'utilisateur fait Ctrl+C plusieurs fois sur la même
  // sélection.
  const head = cached.entries[0];
  if (
    head &&
    !head.pinned &&
    detection.type !== 'image' &&
    head.type === detection.type &&
    head.text === detection.text
  ) {
    const updated: ClipboardEntry = { ...head, copiedAt: Date.now() };
    commit([updated, ...cached.entries.slice(1)]);
    return;
  }

  const id = randomUUID();
  let imagePath: string | null = null;
  const meta: Record<string, unknown> = { ...detection.meta };

  if (detection.type === 'image' && image) {
    try {
      const { path, bytes } = saveImage(id, image);
      imagePath = path;
      meta.bytes = bytes;
    } catch (err) {
      console.warn('[clipboard] sauvegarde PNG échouée — entrée ignorée:', err);
      return;
    }
  }

  const { maskSensitive } = getConfig();
  const entry: ClipboardEntry = {
    id,
    type: detection.type,
    preview: detection.preview,
    text: detection.text,
    imagePath,
    copiedAt: Date.now(),
    pinned: false,
    sensitive: maskSensitive && detection.sensitive,
    meta,
  };

  commit([entry, ...cached.entries]);
}

/* ───────────── Mutations IPC ───────────── */

function pin(id: string): ClipboardState {
  const next = cached.entries.map((e) =>
    e.id === id ? { ...e, pinned: true } : e,
  );
  return commit(next);
}

function unpin(id: string): ClipboardState {
  const next = cached.entries.map((e) =>
    e.id === id ? { ...e, pinned: false } : e,
  );
  return commit(next);
}

function copyAgain(id: string): ClipboardState {
  const entry = cached.entries.find((e) => e.id === id);
  if (!entry) return cached;
  try {
    if (entry.type === 'image' && entry.imagePath && existsSync(entry.imagePath)) {
      const img = nativeImage.createFromPath(entry.imagePath);
      if (!img.isEmpty()) clipboard.writeImage(img);
    } else if (entry.text !== null) {
      clipboard.writeText(entry.text);
    }
    // Signale au watcher de ne pas re-créer une nouvelle entrée pour
    // cette écriture.
    markSelfWrite();
  } catch (err) {
    console.warn('[clipboard] copyAgain échoué:', err);
  }
  // On remonte aussi l'entrée en tête (comportement attendu de la
  // plupart des clipboard managers — la dernière chose copiée
  // réapparait en premier).
  const others = cached.entries.filter((e) => e.id !== id);
  const updated: ClipboardEntry = { ...entry, copiedAt: Date.now() };
  return commit([updated, ...others]);
}

function remove(id: string): ClipboardState {
  const target = cached.entries.find((e) => e.id === id);
  if (target) deleteImage(target.imagePath);
  const next = cached.entries.filter((e) => e.id !== id);
  return commit(next);
}

function clear(keepPinned: boolean): ClipboardState {
  for (const e of cached.entries) {
    if (keepPinned && e.pinned) continue;
    deleteImage(e.imagePath);
  }
  const next = keepPinned ? cached.entries.filter((e) => e.pinned) : [];
  return commit(next);
}

function markSeen(): ClipboardState {
  const ts = Date.now();
  cached = { ...cached, lastSeenAt: ts };
  saveLastSeenAt(ts);
  broadcast();
  return cached;
}

/* ───────────── Unfurl URL ───────────── */

async function unfurl(id: string) {
  if (!getConfig().enableUnfurl) return null;
  const entry = cached.entries.find((e) => e.id === id);
  if (!entry || entry.type !== 'url' || !entry.text) return null;
  const result = await fetchUnfurl(entry.text);
  if (result) {
    // Persiste l'unfurl dans la meta de l'entrée (cache durable côté
    // store, en plus du cache mémoire de urlUnfurl.ts).
    const next = cached.entries.map((e) =>
      e.id === id
        ? {
            ...e,
            meta: {
              ...e.meta,
              title: result.title,
              favicon: result.favicon,
              unfurledAt: result.fetchedAt,
            },
          }
        : e,
    );
    commit(next);
  }
  return result;
}

/* ───────────── Save image ───────────── */

async function saveImageDialog(id: string): Promise<{ ok: boolean; error?: string }> {
  const entry = cached.entries.find((e) => e.id === id);
  if (!entry || entry.type !== 'image' || !entry.imagePath) {
    return { ok: false, error: "Entrée introuvable ou n'est pas une image." };
  }
  if (!existsSync(entry.imagePath)) {
    return { ok: false, error: 'Fichier image manquant sur le disque.' };
  }
  const win = getNotchWindow();
  const options = {
    title: "Enregistrer l'image",
    defaultPath: `clipboard-${new Date(entry.copiedAt)
      .toISOString()
      .replace(/[:.]/g, '-')}.png`,
    filters: [{ name: 'Image PNG', extensions: ['png'] }],
  };
  const res = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);
  if (res.canceled || !res.filePath) return { ok: false };
  try {
    copyFileSync(entry.imagePath, res.filePath);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Échec de la copie.',
    };
  }
}

/* ───────────── Get image data URL ───────────── */

async function getImageDataUrl(id: string): Promise<string | null> {
  const entry = cached.entries.find((e) => e.id === id);
  if (!entry || entry.type !== 'image' || !entry.imagePath) return null;
  if (!existsSync(entry.imagePath)) return null;
  try {
    const buf = await readFile(entry.imagePath);
    return 'data:image/png;base64,' + buf.toString('base64');
  } catch (err) {
    console.warn('[clipboard] lecture image échouée:', err);
    return null;
  }
}

/* ───────────── Open path ───────────── */

function openPath(id: string): { ok: boolean; error?: string } {
  const entry = cached.entries.find((e) => e.id === id);
  if (!entry || entry.type !== 'path' || !entry.text) {
    return { ok: false, error: "Entrée introuvable ou n'est pas un chemin." };
  }
  if (!existsSync(entry.text)) {
    return { ok: false, error: 'Le chemin n\'existe plus sur le disque.' };
  }
  try {
    // showItemInFolder ouvre l'Explorer parent avec l'item sélectionné.
    // Pour un dossier, ouvre le parent et sélectionne le dossier.
    shell.showItemInFolder(entry.text);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Échec de l\'ouverture.',
    };
  }
}

/* ───────────── Lifecycle ───────────── */

export function registerClipboardIpc(): void {
  // Restaure l'historique chiffré + le lastSeenAt avant le premier
  // tick — sinon le watcher pourrait pousser un broadcast vide avant
  // que l'UI ait reçu le snapshot persistant.
  cached = {
    entries: sortEntries(loadHistory()),
    lastSeenAt: loadLastSeenAt(),
  };

  ipcMain.handle(IpcChannel.ClipboardGetState, () => cached);
  ipcMain.handle(IpcChannel.ClipboardPin, (_e, id: string) => pin(id));
  ipcMain.handle(IpcChannel.ClipboardUnpin, (_e, id: string) => unpin(id));
  ipcMain.handle(IpcChannel.ClipboardCopyAgain, (_e, id: string) => copyAgain(id));
  ipcMain.handle(IpcChannel.ClipboardRemove, (_e, id: string) => remove(id));
  ipcMain.handle(IpcChannel.ClipboardClear, (_e, keepPinned: boolean) => clear(keepPinned));
  ipcMain.handle(IpcChannel.ClipboardMarkSeen, () => markSeen());
  ipcMain.handle(IpcChannel.ClipboardUnfurl, (_e, id: string) => unfurl(id));
  ipcMain.handle(IpcChannel.ClipboardSaveImage, (_e, id: string) => saveImageDialog(id));
  ipcMain.handle(IpcChannel.ClipboardGetImageDataUrl, (_e, id: string) =>
    getImageDataUrl(id),
  );
  ipcMain.handle(IpcChannel.ClipboardOpenPath, (_e, id: string) => openPath(id));

  startClipboardWatcher(onClipboardChange);
}

export function stopClipboard(): void {
  stopClipboardWatcher();
  // L'écriture de l'historique est débouncée (2 s) : flush explicite pour
  // ne pas perdre les copies des 2 dernières secondes à la fermeture.
  flushHistory();
}

/**
 * Demande au renderer d'afficher la card Clipboard avec focus sur la
 * recherche. Appelé par le raccourci global Ctrl+Shift+V (cf.
 * `shortcuts/globalShortcuts.ts`).
 */
export function focusClipboardCard(): void {
  const win = getNotchWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcChannel.ClipboardFocusCard);
}
