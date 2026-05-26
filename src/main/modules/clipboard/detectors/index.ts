/**
 * Pipeline de détection (main process).
 *
 * Le pipeline texte est entièrement délégué à `shared/clipboardDetectors.ts`
 * qui contient la vraie logique (réutilisable côté renderer pour la
 * détection live dans la search bar). Ce fichier ajoute seulement la
 * détection d'image (specific NativeImage) qui domine tout : si
 * Windows expose un bitmap, on ignore le texte de fallback éventuel.
 */
import type { NativeImage } from 'electron';
import {
  detectFromText,
  isSensitive,
} from '../../../../shared/clipboardDetectors';
import { detect as detectImage } from './image';
import type { DetectorMatch } from './types';

export interface DetectionResult extends DetectorMatch {
  sensitive: boolean;
}

export function detectClipboard(
  text: string,
  image: NativeImage | null,
): DetectionResult | null {
  // L'image l'emporte sur le texte (Windows met parfois un fallback
  // texte du genre "[Image]" ou un chemin temp — à ignorer).
  const img = detectImage(text, image);
  if (img) {
    return { ...img, sensitive: false };
  }

  const t = detectFromText(text);
  if (!t) return null;
  // detectFromText calcule déjà sensitive ; on le ré-applique au cas
  // où la logique evolue côté shared (idempotent).
  return {
    type: t.type,
    preview: t.preview,
    text: t.text,
    meta: t.meta,
    sensitive: t.sensitive ?? isSensitive(t.text),
  };
}
