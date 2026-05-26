/**
 * Ré-export des types audio depuis le contrat partagé.
 * Permet aux composants du module d'importer en chemin court
 * (`./types` plutôt que `../../../shared/types`).
 */
export type { AudioDevice, AudioState } from '../../../shared/types';
