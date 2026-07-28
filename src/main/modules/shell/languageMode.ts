/**
 * Sonde du **mode de langage** PowerShell du poste.
 *
 * Pourquoi : AppLocker/WDAC impose `ConstrainedLanguage` aux scripts situés
 * dans les dossiers inscriptibles par l'utilisateur — dont `%LOCALAPPDATA%`,
 * donc l'application installée. Le même fichier lancé depuis un dépôt sous
 * `C:\` tourne, lui, en `FullLanguage` : un script qui marche en développement
 * peut donc être totalement inopérant une fois installé.
 *
 * `persistent-loop.ps1` et les scripts métier ont été réécrits pour tenir en
 * ConstrainedLanguage, mais `fullscreen-detector.ps1` ne le peut pas : il fait
 * du P/Invoke `user32` via `Add-Type`, et définir un type est interdit dans ce
 * mode par conception. Le sonder évite de spawner un `powershell.exe` qui
 * mourra à coup sûr, et permet de le dire clairement plutôt que de laisser
 * l'utilisateur face à un Alt-Peek qui ne réagit jamais.
 *
 * Coût : **zéro spawn supplémentaire**. La sonde passe par le PowerShell
 * résident (qui subit exactement la même politique) et se réduit à un accès de
 * propriété, autorisé dans tous les modes.
 */
import { runPersistentPowershell } from './persistentPowershell';

export type PsLanguageMode =
  | 'FullLanguage'
  | 'ConstrainedLanguage'
  | 'RestrictedLanguage'
  | 'NoLanguage';

const PROBE_TIMEOUT_MS = 20_000;
const KNOWN_MODES: readonly string[] = [
  'FullLanguage',
  'ConstrainedLanguage',
  'RestrictedLanguage',
  'NoLanguage',
];

let cached: PsLanguageMode | null = null;
let inFlight: Promise<PsLanguageMode | null> | null = null;

/** Mode déjà sondé, ou `null` si la sonde n'a pas encore abouti. */
export function getCachedLanguageMode(): PsLanguageMode | null {
  return cached;
}

/**
 * Sonde le mode de langage (une seule fois par session, résultat mémoïsé).
 * Renvoie `null` si la sonde n'a pas pu aboutir — cas dans lequel les
 * appelants doivent se comporter comme avant, sans rien désactiver.
 */
export async function probePowershellLanguageMode(): Promise<PsLanguageMode | null> {
  if (cached) return cached;
  if (inFlight) return inFlight;
  const task = (async (): Promise<PsLanguageMode | null> => {
    const { stdout, error } = await runPersistentPowershell(
      '$ExecutionContext.SessionState.LanguageMode',
      PROBE_TIMEOUT_MS,
    );
    if (error) return null;
    const mode = stdout.trim();
    if (!KNOWN_MODES.includes(mode)) return null;
    cached = mode as PsLanguageMode;
    return cached;
  })();
  inFlight = task;
  try {
    return await task;
  } finally {
    inFlight = null;
  }
}

/**
 * `Add-Type` (donc tout P/Invoke) est-il utilisable ?
 *
 * En cas de sonde infructueuse (`null`), on répond `true` : mieux vaut tenter
 * et échouer proprement que désactiver une fonctionnalité sur une supposition.
 */
export function canDefineTypes(mode: PsLanguageMode | null): boolean {
  return mode === null || mode === 'FullLanguage';
}
