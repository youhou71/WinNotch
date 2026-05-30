/**
 * Décodage des erreurs HMS (Health Management System) Bambu Lab.
 *
 * Chaque entrée du tableau `print.hms[]` expose deux entiers 32 bits :
 *  - `attr` : identifie le composant/module concerné.
 *  - `code` : identifie l'erreur précise + sa sévérité (bits de poids fort).
 *
 * Le code « humain » affiché dans l'app Bambu / le wiki est la concaténation
 * des 4 demi-mots (16 bits) en hexadécimal majuscule, séparés par `_` :
 *   `{attr>>16}_{attr&0xffff}_{code>>16}_{code&0xffff}`  → ex. `0300_0100_0002_0001`
 *
 * La sévérité est encodée dans les bits de poids fort de `code`
 * (`(code >> 16) & 0xffff`) : 1=fatal, 2=serious, 3=common, 4=info. Mapping
 * issu du reverse-engineering communautaire (ha-bambulab / OpenBambuAPI).
 */
import type { BambuHmsEntry } from '../../../shared/types';

/** Une entrée brute telle que reçue dans le payload MQTT. */
export interface RawHms {
  attr: number;
  code: number;
}

const SEVERITY: Record<number, BambuHmsEntry['level']> = {
  1: 'fatal',
  2: 'serious',
  3: 'common',
  4: 'info',
};

/** Formate un demi-couple (entier 32 bits) en `HHHH_HHHH` hex majuscule. */
function part(n: number): string {
  const hi = ((n >> 16) & 0xffff).toString(16).padStart(4, '0');
  const lo = (n & 0xffff).toString(16).padStart(4, '0');
  return `${hi}_${lo}`.toUpperCase();
}

/**
 * Convertit une entrée HMS brute en entrée enrichie (code lisible, sévérité,
 * lien wiki). Retourne `null` si `attr`/`code` sont absents ou nuls (entrée
 * vide — le P1 peut envoyer un tableau `hms` avec des trous).
 */
export function formatHms(raw: unknown): BambuHmsEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<RawHms>;
  const attr = typeof r.attr === 'number' ? r.attr : 0;
  const code = typeof r.code === 'number' ? r.code : 0;
  if (attr === 0 && code === 0) return null;

  const human = `${part(attr)}_${part(code)}`;
  const level = SEVERITY[(code >> 16) & 0xffff] ?? 'unknown';
  // Le wiki utilise le code en minuscules dans l'URL.
  const wikiUrl = `https://wiki.bambulab.com/en/x1/troubleshooting/hmscode/${human.toLowerCase()}`;
  return { code: human, level, wikiUrl };
}

/** Mappe et filtre un tableau `hms` brut en entrées exploitables. */
export function parseHmsArray(arr: unknown): BambuHmsEntry[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(formatHms)
    .filter((e): e is BambuHmsEntry => e !== null);
}
