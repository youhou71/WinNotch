/**
 * Persistance des images du presse-papier sur disque.
 *
 * Les bitmaps ne passent pas par safeStorage (chiffrer un PNG de 5 Mo à
 * chaque copie ferait stutter le main process à chaque écriture). Ils
 * sont stockés en clair dans `%APPDATA%/winnotch/clipboard-images/<id>.png`.
 *
 * La référence vers le PNG (le `imagePath`) est, elle, dans l'historique
 * chiffré — donc même si l'attaquant accède au PNG il ne sait pas à
 * quoi il correspondait (timestamp, ordre, type détecté).
 *
 * Cleanup : à chaque eviction d'entrée (limite maxItems atteinte ou clear),
 * le PNG correspondant est supprimé du disque pour éviter une fuite
 * silencieuse de stockage.
 */
import { app } from 'electron';
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { NativeImage } from 'electron';

let cachedDir: string | null = null;

function getDir(): string {
  if (cachedDir) return cachedDir;
  const dir = join(app.getPath('userData'), 'clipboard-images');
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.warn('[clipboard] création du dossier images échouée:', err);
  }
  cachedDir = dir;
  return dir;
}

/**
 * Sérialise le NativeImage en PNG et l'écrit sous `<id>.png`. Retourne
 * le chemin absolu du fichier créé.
 */
export function saveImage(id: string, image: NativeImage): { path: string; bytes: number } {
  const buf = image.toPNG();
  const path = join(getDir(), `${id}.png`);
  writeFileSync(path, buf);
  return { path, bytes: buf.length };
}

/** Supprime le PNG associé à une entrée. Ne lève pas si le fichier est absent. */
export function deleteImage(imagePath: string | null): void {
  if (!imagePath) return;
  try {
    if (existsSync(imagePath)) unlinkSync(imagePath);
  } catch (err) {
    console.warn('[clipboard] suppression d\'image échouée:', err);
  }
}

export function getImagesDir(): string {
  return getDir();
}
