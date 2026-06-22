/**
 * Lecture/écriture du volume système via le binaire bundlé par `loudness`.
 *
 * `loudness` embarque un petit binaire Windows
 * (`adjust_get_current_system_volume_vista_plus.exe`) qui parle directement
 * à l'API Windows Core Audio. Pas de dépendance utilisateur (pas besoin
 * d'installer un module PowerShell, pas d'admin). Protocole du binaire
 * (cf. `loudness/impl/windows/index.js`) :
 *   - sans argument            → stdout `"<volume> <muted>"`
 *   - argument `"<n>"`         → règle le volume à n
 *   - argument `mute`/`unmute` → coupe / réactive le son
 *
 * On appelle ce binaire DIRECTEMENT pour les trois opérations (au lieu de
 * passer par l'API JS de `loudness`) pour deux raisons :
 *  1. Lecture : l'API publique force DEUX spawns (`getVolume()` +
 *     `getMuted()`), alors qu'un appel sans argument retourne les deux
 *     valeurs d'un coup — UN seul spawn par lecture, c'est le chemin chaud
 *     du polling audio (audit perf P2, chaque spawn est scanné par l'AV).
 *  2. Chemin asar : un `.exe` ne peut PAS être spawné depuis l'intérieur
 *     d'une archive `app.asar` (CreateProcess ne lit pas dans le blob ;
 *     Electron ne patche que `fs`, pas le spawn de process). En prod, le
 *     module `loudness` est dépaqueté dans `app.asar.unpacked` mais son
 *     code interne calcule le chemin du binaire via `__dirname`, qui pointe
 *     vers le chemin VIRTUEL `…\app.asar\…` → ENOENT silencieux, volume
 *     bloqué à 0 %. En résolvant nous-mêmes le chemin et en le réécrivant
 *     vers `.unpacked`, lecture ET écriture visent le fichier réel.
 *
 * Les setters sont tolérants aux pannes : en cas d'erreur, on absorbe
 * plutôt que de propager. `getVolumeInfo()` en revanche THROW en cas
 * d'échec : l'appelant (audioService) conserve ainsi son dernier état
 * connu au lieu d'écraser le cache avec des valeurs neutres.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { dirname, join, sep } from 'path';
import { createRequire } from 'module';

const execFileAsync = promisify(execFile);

export interface VolumeInfo {
  /** Volume système [0..100]. */
  level: number;
  muted: boolean;
}

/**
 * Résout (une seule fois) le chemin du binaire bundlé par `loudness`.
 * `createRequire` car le bundle main est ESM. En prod le chemin résolu
 * pointe à l'intérieur de l'asar (`…\app.asar\node_modules\loudness\…`) ;
 * on le réécrit vers `…\app.asar.unpacked\…` (où electron-builder a
 * réellement extrait le binaire, cf. `asarUnpack` dans electron-builder.yml)
 * afin que `CreateProcess` trouve un fichier sur disque. En dev, le chemin
 * ne contient pas `app.asar` → la réécriture est un no-op.
 */
let exePath: string | null = null;
function loudnessExePath(): string {
  if (!exePath) {
    const require = createRequire(import.meta.url);
    exePath = join(
      dirname(require.resolve('loudness/impl/windows/index.js')),
      'adjust_get_current_system_volume_vista_plus.exe',
    ).replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
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
    await execFileAsync(loudnessExePath(), [String(clamped)], {
      windowsHide: true,
      timeout: 5000,
    });
  } catch {
    // Échec silencieux : peut arriver si une permission de session
    // Bluetooth/casque est manquante. L'UI reflétera simplement l'état
    // non modifié au prochain polling.
  }
}

/** Active ou coupe le son système. */
export async function setMuted(muted: boolean): Promise<void> {
  try {
    await execFileAsync(loudnessExePath(), [muted ? 'mute' : 'unmute'], {
      windowsHide: true,
      timeout: 5000,
    });
  } catch {
    // Idem setVolume : on absorbe l'erreur pour ne pas casser le polling.
  }
}
