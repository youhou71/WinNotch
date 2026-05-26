/**
 * Wrapper sur `SoundVolumeView.exe` (NirSoft) pour énumérer et changer le
 * périphérique de sortie audio par défaut.
 *
 * Le binaire est bundlé dans `resources/` (freeware redistribuable). Il
 * communique via :
 *  - `/sjson <fichier>` pour lister les devices au format JSON (UTF-16 LE
 *    avec BOM)
 *  - `/SetDefault "<id>" all` pour changer le périphérique par défaut
 *
 * Pièges et défenses :
 *  - SVV est un binaire GUI : son stdout est peu fiable, on passe donc
 *    par un fichier temporaire.
 *  - Le JSON sorti est UTF-16 LE alors que la doc dit UTF-8 → on détecte
 *    le BOM et on décode correctement.
 *  - Les caractères accentués dans le chemin temp utilisateur peuvent
 *    déclencher un popup "Error 5" → on préfère C:\Windows\Temp.
 *  - Si SVV échoue plus de 3 fois, on désactive complètement l'appel
 *    (circuit breaker) pour éviter une cascade de popups.
 *  - Bypass total via la variable d'env WINNOTCH_DISABLE_SVV=1.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { is } from '@electron-toolkit/utils';
import type { AudioDevice } from '../../../shared/types';

const execFileAsync = promisify(execFile);

/**
 * Résout le chemin du binaire SVV selon l'environnement.
 * En dev : `<repo>/resources/`. En prod : `process.resourcesPath` (où
 * electron-builder copie le contenu de `resources/` via `extraResources`).
 */
function resolveSvvPath(): string {
  if (is.dev) {
    return join(app.getAppPath(), 'resources', 'SoundVolumeView.exe');
  }
  return join(process.resourcesPath, 'SoundVolumeView.exe');
}

/**
 * Structure d'une ligne JSON produite par `SoundVolumeView /sjson`.
 * Les noms de colonnes sont volontairement les libellés exacts de NirSoft
 * (espaces et casse inclus) pour éviter toute confusion lors du parsing.
 */
interface SvvRow {
  Name?: string;
  ['Device Name']?: string;
  Direction?: string;
  ['Default']?: string;
  ['Default Multimedia']?: string;
  Type?: string;
  ['Device State']?: string;
  ['Item ID']?: string;
  ['Command-Line Friendly ID']?: string;
}

/**
 * Heuristique de catégorisation par nom de device. Utilisée uniquement pour
 * choisir l'icône Font Awesome dans l'UI ; aucune logique fonctionnelle ne
 * dépend de cette classification.
 */
function classifyDevice(row: SvvRow): AudioDevice['type'] {
  const name = (row.Name || row['Device Name'] || '').toLowerCase();
  if (name.includes('headphone') || name.includes('airpod') || name.includes('écouteur') || name.includes('casque')) {
    return 'headphones';
  }
  if (name.includes('display') || name.includes('hdmi') || name.includes('monitor') || name.includes('écran')) {
    return 'display';
  }
  if (name.includes('speaker') || name.includes('haut-parleur') || name.includes('realtek')) {
    return 'speakers';
  }
  return 'other';
}

/** Compteur d'échecs SVV pour le circuit breaker. Reset à 0 sur succès. */
let svvFailCount = 0;
const SVV_MAX_FAILURES = 3;

/**
 * Sélectionne un dossier temporaire ASCII-only en priorité.
 *
 * SoundVolumeView peut déclencher un popup "Error 5: Access denied" quand
 * le chemin du fichier de sortie contient des caractères non ASCII
 * (typique pour le dossier `Temp` sous un compte avec accents).
 * On tente donc des dossiers neutres avant le tmpdir par défaut.
 */
function pickTempDir(): string {
  const candidates = ['C:\\Windows\\Temp', 'C:\\Temp', tmpdir()];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch { /* ignore */ }
  }
  return tmpdir();
}

/**
 * Exécute SVV en JSON et parse le résultat. Tolère plusieurs encodages
 * et nettoie le BOM si présent.
 *
 * @throws si SVV est introuvable, si la commande échoue ou si le JSON
 *         est mal formé. L'appelant (listOutputDevices) attrape ces
 *         erreurs et retourne une liste vide.
 */
async function runSvvJson(): Promise<SvvRow[]> {
  if (svvFailCount >= SVV_MAX_FAILURES) {
    return [];
  }
  const svvPath = resolveSvvPath();
  if (!existsSync(svvPath)) {
    throw new Error(`SoundVolumeView.exe introuvable à ${svvPath}`);
  }
  // SVV étant un binaire GUI, on ne peut pas se fier à son stdout —
  // on passe par un fichier temporaire JSON.
  const tmpFile = join(pickTempDir(), `winnotch-svv-${randomUUID()}.json`);
  try {
    await execFileAsync(svvPath, ['/sjson', tmpFile], {
      windowsHide: true,
      timeout: 8000,
    });
  } catch (err) {
    svvFailCount++;
    if (svvFailCount === SVV_MAX_FAILURES) {
      console.warn(
        `[audio/devices] SoundVolumeView a échoué ${SVV_MAX_FAILURES} fois — désactivation. Les périphériques resteront vides.`,
      );
    }
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
    throw err;
  }
  if (!existsSync(tmpFile)) return [];
  try {
    const buf = readFileSync(tmpFile);
    if (buf.length === 0) return [];
    let text: string;
    // SVV écrit en UTF-16 LE avec BOM (FF FE).
    if (buf[0] === 0xff && buf[1] === 0xfe) {
      text = buf.slice(2).toString('utf16le');
    }
    // UTF-16 BE (FE FF) : on retourne les paires d'octets avant décodage.
    else if (buf[0] === 0xfe && buf[1] === 0xff) {
      const swapped = Buffer.alloc(buf.length - 2);
      for (let i = 2; i < buf.length; i += 2) {
        swapped[i - 2] = buf[i + 1] ?? 0;
        swapped[i - 1] = buf[i] ?? 0;
      }
      text = swapped.toString('utf16le');
    }
    // UTF-8 BOM (EF BB BF).
    else if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      text = buf.slice(3).toString('utf8');
    }
    // Pas de BOM → on présume UTF-8.
    else {
      text = buf.toString('utf8');
    }
    // U+FEFF résiduel (BOM "logique" laissé après décodage) à retirer.
    const cleaned = text.replace(/^﻿/, '').trim();
    if (!cleaned) return [];
    return JSON.parse(cleaned) as SvvRow[];
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

/**
 * Liste les périphériques de sortie audio actifs.
 *
 * Filtres appliqués :
 *  - Direction == "Render" (sortie, pas capture)
 *  - Device State == "Active" (exclut Disabled/NotPresent/Unplugged)
 *  - Type == "Device" (exclut Subunit / sessions de processus)
 *
 * Le champ `isDefault` accepte plusieurs orthographes du tag (différentes
 * versions de SVV utilisent "Render" ou un libellé enrichi).
 */
export async function listOutputDevices(): Promise<AudioDevice[]> {
  if (process.env.WINNOTCH_DISABLE_SVV === '1') return [];
  try {
    const rows = await runSvvJson();
    // Reset du circuit breaker dès qu'on obtient un résultat exploitable.
    if (rows.length > 0) svvFailCount = 0;
    return rows
      .filter((r) => (r.Direction || '').toLowerCase() === 'render')
      .filter((r) => (r['Device State'] || '').toLowerCase() === 'active')
      .filter((r) => (r.Type || '').toLowerCase() === 'device')
      .map<AudioDevice>((r) => ({
        id: r['Command-Line Friendly ID'] || r['Item ID'] || r.Name || '',
        // `Device Name` est le nom du périphérique physique (ex. "Realtek
        // High Definition Audio", "Casque Sony WH-1000XM5"). `Name` est
        // souvent générique ("Speakers", "Headphones") — on le prend en
        // fallback. Quand les deux existent et diffèrent, l'utilisateur
        // voit l'identité réelle de l'appareil + son rôle via `type`.
        name: r['Device Name'] || r.Name || 'Inconnu',
        type: classifyDevice(r),
        isDefault: (r['Default'] || '').toLowerCase() === 'render' ||
                   (r['Default Multimedia'] || '').toLowerCase() === 'render' ||
                   (r['Default'] || '').toLowerCase().includes('render'),
      }))
      .filter((d) => d.id);
  } catch (err) {
    console.error('[audio/devices] listOutputDevices failed:', err);
    return [];
  }
}

/**
 * Change le périphérique de sortie audio par défaut au niveau Windows.
 *
 * Le second argument `all` couvre les trois rôles audio MMDevice
 * (Console, Multimedia, Communications) pour que toutes les apps suivent
 * le changement.
 */
export async function setDefaultOutput(id: string): Promise<void> {
  const svvPath = resolveSvvPath();
  if (!existsSync(svvPath)) return;
  try {
    await execFileAsync(svvPath, ['/SetDefault', id, 'all'], {
      windowsHide: true,
    });
  } catch {
    // Échec silencieux — la prochaine itération du polling reflétera
    // l'état réel du système si le changement a fini par passer.
  }
}
