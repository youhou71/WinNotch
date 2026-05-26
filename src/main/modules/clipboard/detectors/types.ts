/**
 * Contrat des détecteurs de type de contenu du presse-papier.
 *
 * Chaque détecteur exporte une fonction `detect(text, image)` qui :
 *  - retourne un `DetectorMatch` si le contenu matche son type
 *  - retourne `null` sinon
 *
 * Le pipeline orchestre l'appel dans un ordre fixe (cf. `./index.ts`) ;
 * le premier match gagne. Cet ordre est important — un JWT ressemble à
 * une URL ponctuée, un JSON court peut contenir une couleur, etc.
 */
import type { NativeImage } from 'electron';
import type { ClipboardEntryType } from '../../../../shared/types';

/**
 * Résultat d'une détection réussie.
 *
 * `meta` est laissé volontairement souple côté contrat (Record<string,
 * unknown>) — chaque détecteur peuple les clefs qu'il choisit, le
 * renderer connaît les conventions par type.
 */
export interface DetectorMatch {
  type: ClipboardEntryType;
  /**
   * Aperçu court (≤120 chars) pour l'affichage chip + ligne de card.
   * Le détecteur choisit ce qui a du sens : pour une URL, le host ;
   * pour une couleur, le hex ; pour un JSON, la première paire clé:valeur.
   */
  preview: string;
  /**
   * Texte canonique à recopier au clic "Copier" et à persister en
   * tant que valeur de l'entrée. Vaut `null` uniquement pour les images
   * (le contenu binaire est sauvegardé en PNG sur disque par ailleurs).
   */
  text: string | null;
  /** Métadonnées spécifiques au type (cf. doc de `ClipboardEntry`). */
  meta: Record<string, unknown>;
}

/**
 * Signature commune à tous les détecteurs.
 *
 * `text` est le texte brut du presse-papier ('' si rien). `image` est
 * non-null uniquement si `clipboard.readImage().isEmpty() === false`
 * (image bitmap dans le presse-papier).
 */
export type Detector = (text: string, image: NativeImage | null) => DetectorMatch | null;
