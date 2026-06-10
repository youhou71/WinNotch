/**
 * Watcher du presse-papier système.
 *
 * Electron n'expose pas d'événement natif "clipboard change" sur Windows :
 * on polle toutes les 700 ms (compromis réactivité / CPU). Dedup par
 * hash pour ignorer les ticks où rien n'a changé.
 *
 * Pause automatique :
 *  - Le service appelant peut signaler une fenêtre fullscreen via
 *    `setPaused(true)`, ce qui suspend le polling (économise CPU dans
 *    les jeux et présentations).
 *  - Un "self-write" (recopie d'une entrée existante via `Copier à
 *    nouveau`) est ignoré pendant un court délai pour ne pas créer de
 *    doublon immédiat.
 */
import { clipboard, type NativeImage } from 'electron';
import { createHash } from 'crypto';

/**
 * Callback du watcher, appelé quand le contenu du presse-papier a
 * changé. `image` est non-null uniquement si Windows expose un bitmap.
 */
export type ClipboardChangeHandler = (text: string, image: NativeImage | null) => void;

const POLL_INTERVAL_MS = 700;
const SELF_WRITE_IGNORE_MS = 1500;

let timer: NodeJS.Timeout | null = null;
let lastHash = '';
let paused = false;
let selfWriteUntil = 0;
let handler: ClipboardChangeHandler | null = null;

function hashContent(text: string, image: NativeImage | null): string {
  const sha = createHash('sha1');
  // On hash sur (longueur + 4 premiers + 4 derniers Ko de bitmap) pour
  // un compromis vitesse/discrimination — toPNG() complet à chaque tick
  // serait O(taille) inutilement.
  if (image && !image.isEmpty()) {
    const bm = image.toBitmap();
    sha.update('img:' + bm.byteLength + ':');
    sha.update(bm.subarray(0, Math.min(4096, bm.byteLength)));
    if (bm.byteLength > 8192) {
      sha.update(bm.subarray(bm.byteLength - 4096));
    }
  }
  sha.update('txt:' + text);
  return sha.digest('hex');
}

function tick(): void {
  if (paused) return;
  if (Date.now() < selfWriteUntil) return;

  let text = '';
  let image: NativeImage | null = null;
  try {
    // `availableFormats()` est une simple énumération (pas de copie de
    // données) : on ne fait le `readImage()` — qui copie le bitmap complet
    // dans un NativeImage — que si Windows annonce réellement un format
    // image. Le cas ultra-majoritaire (texte ou clipboard inchangé sans
    // image) ne touche plus jamais au bitmap (audit perf P9).
    const formats = clipboard.availableFormats();
    const hasImage = formats.some((f) => f.startsWith('image/'));
    text = clipboard.readText() ?? '';
    if (hasImage) {
      image = clipboard.readImage();
      if (image.isEmpty()) image = null;
    }
  } catch (err) {
    console.warn('[clipboard] lecture du presse-papier échouée:', err);
    return;
  }

  if (!text && !image) {
    // Clipboard vide (sélection effacée par une autre app) — pas
    // d'entrée à créer, mais on resynchronise le hash pour que la
    // prochaine vraie copie soit détectée.
    lastHash = '';
    return;
  }

  const h = hashContent(text, image);
  if (h === lastHash) return;
  lastHash = h;

  if (handler) handler(text, image);
}

export function startClipboardWatcher(cb: ClipboardChangeHandler): void {
  handler = cb;
  // Premier tick immédiat pour capter ce qui est déjà copié au boot,
  // sinon on attendrait 700 ms et la première copie de la session
  // pourrait être manquée par le hash de comparaison.
  tick();
  timer = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopClipboardWatcher(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  handler = null;
  lastHash = '';
  paused = false;
  selfWriteUntil = 0;
}

export function setWatcherPaused(p: boolean): void {
  paused = p;
}

/**
 * Signale au watcher qu'on vient d'écrire dans le presse-papier
 * (action `Copier à nouveau`). Ignore les ticks suivants pendant
 * SELF_WRITE_IGNORE_MS, et resynchronise le hash après ce délai pour
 * éviter de créer un doublon.
 */
export function markSelfWrite(): void {
  selfWriteUntil = Date.now() + SELF_WRITE_IGNORE_MS;
  // On recalcule le hash maintenant : le ticker repartira de là après
  // le délai d'ignore.
  try {
    const formats = clipboard.availableFormats();
    const text = clipboard.readText() ?? '';
    const image = formats.some((f) => f.startsWith('image/'))
      ? clipboard.readImage()
      : null;
    lastHash = hashContent(text, image && !image.isEmpty() ? image : null);
  } catch {
    lastHash = '';
  }
}
