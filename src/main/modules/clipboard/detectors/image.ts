/**
 * Détecteur d'image dans le presse-papier.
 *
 * Priorité maximale : si Windows expose une image bitmap, on l'enregistre
 * comme tel sans regarder le texte (Windows met souvent un fallback texte
 * du genre `[Image]` ou un chemin de fichier — on l'ignore).
 */
import type { Detector } from './types';

export const detect: Detector = (_text, image) => {
  if (!image || image.isEmpty()) return null;

  const size = image.getSize();
  // toBitmap() est plus rapide que toPNG() pour mesurer la taille, mais
  // on a besoin du PNG pour persister. Le service appelant fera la
  // conversion une seule fois (cf. clipboardService.ts).
  // Ici on se contente d'exposer les dimensions dans `meta`.
  return {
    type: 'image',
    preview: `Image ${size.width}×${size.height}`,
    text: null,
    meta: {
      width: size.width,
      height: size.height,
    },
  };
};
