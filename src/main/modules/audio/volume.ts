/**
 * Wrapper sur le package `loudness` pour lire/écrire le volume système.
 *
 * `loudness` embarque un petit binaire natif Windows
 * (`adjust_get_current_system_volume_vista_plus.exe`) qui parle directement
 * à l'API Windows Core Audio. Pas de dépendance utilisateur (pas besoin
 * d'installer un module PowerShell, pas d'admin).
 *
 * Lecture : l'API publique de `loudness` force DEUX spawns pour lire l'état
 * (`getVolume()` + `getMuted()`), alors que le binaire appelé sans argument
 * retourne les deux valeurs dans le même stdout (`"<volume> <muted>"`, cf.
 * `loudness/impl/windows/index.js`). `getVolumeInfo()` exécute donc le
 * binaire directement : UN seul spawn par lecture — c'est le chemin chaud
 * du polling audio (audit perf P2, chaque spawn est scanné par l'AV).
 *
 * Écriture : `setVolume`/`setMuted` restent sur l'API `loudness` (un seul
 * spawn chacun, rien à optimiser).
 *
 * Les setters sont tolérants aux pannes : en cas d'erreur, on absorbe
 * plutôt que de propager. `getVolumeInfo()` en revanche THROW en cas
 * d'échec : l'appelant (audioService) conserve ainsi son dernier état
 * connu au lieu d'écraser le cache avec des valeurs neutres.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import loudness from 'loudness';

const execFileAsync = promisify(execFile);

export interface VolumeInfo {
  /** Volume système [0..100]. */
  level: number;
  muted: boolean;
}

/**
 * Résout (une seule fois) le chemin du binaire bundlé par `loudness`.
 * `createRequire` car le bundle main est ESM ; `loudness` est dans
 * `asarUnpack` donc Electron redirige l'exécution vers le fichier réel
 * (`app.asar.unpacked`) en prod — même mécanisme que l'API `loudness`
 * elle-même.
 */
let exePath: string | null = null;
function loudnessExePath(): string {
  if (!exePath) {
    const require = createRequire(import.meta.url);
    exePath = join(
      dirname(require.resolve('loudness/impl/windows/index.js')),
      'adjust_get_current_system_volume_vista_plus.exe',
    );
  }
  return exePath;
}

/**
 * Lit volume + muted en UN SEUL spawn du binaire loudness.
 * @throws si le spawn échoue ou si la sortie est inexploitable — ne JAMAIS
 *         retourner de valeur neutre ici (l'appelant garde son cache).
 */
export async function getVolumeInfo(): Promise<VolumeInfo> {
  const { stdout } = await execFileAsync(loudnessExePath(), [], {
    windowsHide: true,
    timeout: 5000,
  });
  const [levelRaw, mutedRaw] = stdout.trim().split(/\s+/);
  const level = Number.parseInt(levelRaw ?? '', 10);
  if (!Number.isFinite(level)) {
    throw new Error(`Sortie inattendue du binaire loudness: "${stdout.trim()}"`);
  }
  return { level, muted: mutedRaw === '1' };
}

/** Règle le volume système. Valeur clampée à [0..100], arrondie à l'entier. */
export async function setVolume(level: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(level)));
  try {
    await loudness.setVolume(clamped);
  } catch {
    // Échec silencieux : peut arriver si une permission de session
    // Bluetooth/casque est manquante. L'UI reflétera simplement l'état
    // non modifié au prochain polling.
  }
}

/** Active ou coupe le son système. */
export async function setMuted(muted: boolean): Promise<void> {
  try {
    await loudness.setMuted(muted);
  } catch {
    // Idem setVolume : on absorbe l'erreur pour ne pas casser le polling.
  }
}
