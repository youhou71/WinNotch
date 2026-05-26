/**
 * Wrapper sur le package `loudness` pour lire/écrire le volume système.
 *
 * `loudness` embarque un petit binaire natif Windows
 * (`adjust_get_current_system_volume_vista_plus.exe`) qui parle directement
 * à l'API Windows Core Audio. Pas de dépendance utilisateur (pas besoin
 * d'installer un module PowerShell, pas d'admin).
 *
 * Toutes les fonctions sont tolérantes aux pannes : en cas d'erreur, on
 * retourne une valeur neutre plutôt que de propager. Le polling audio
 * (toutes les 2 s) ne doit jamais crasher l'app.
 */
import loudness from 'loudness';

/**
 * Retourne le volume système courant [0..100].
 * Retourne 0 en cas d'échec (interprété comme muted côté UI).
 */
export async function getVolume(): Promise<number> {
  try {
    return await loudness.getVolume();
  } catch {
    return 0;
  }
}

/** Règle le volume système. Valeur clampée à [0..100], arrondie à l'entier. */
export async function setVolume(level: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(level)));
  try {
    await loudness.setVolume(clamped);
  } catch {
    // Échec silencieux : peut arriver si PowerShell est absent ou si une
    // permission de session Bluetooth/casque est manquante. L'UI reflétera
    // simplement l'état non modifié au prochain polling.
  }
}

/** True si le système est actuellement muté. */
export async function getMuted(): Promise<boolean> {
  try {
    return await loudness.getMuted();
  } catch {
    return false;
  }
}

/** Active ou coupe le son système. */
export async function setMuted(muted: boolean): Promise<void> {
  try {
    await loudness.setMuted(muted);
  } catch {
    // Idem getMuted : on absorbe l'erreur pour ne pas casser le polling.
  }
}
