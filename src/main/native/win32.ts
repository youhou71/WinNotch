/**
 * Accès direct aux API Win32 nécessaires au détecteur plein écran / Alt-Peek,
 * via `koffi` (FFI) — donc **dans le process**, sans `powershell.exe`.
 *
 * Pourquoi : `fullscreen-detector.ps1` fait du P/Invoke `user32` par
 * `Add-Type`, interdit en `ConstrainedLanguage`. Or AppLocker/WDAC impose ce
 * mode aux scripts situés sous `%LOCALAPPDATA%`, donc à l'application
 * INSTALLÉE — alors que le même script lancé depuis le dépôt tourne en
 * `FullLanguage`. Résultat sur poste bridé : Alt-Peek et le masquage plein
 * écran ne fonctionnent pas, et rien ne l'explique. Le mode de langage ne
 * contraint que le moteur PowerShell : appeler `user32` depuis le process
 * contourne le problème par le haut.
 *
 * Coûts mesurés sur machine réelle (cf. `scripts/check-native-win32.cjs`) :
 * ~1 µs par appel, soit ~0,019 ms/s pour les cadences du détecteur (Alt toutes
 * les 75 ms, fenêtre toutes les 750 ms) — 0,002 % d'un cœur. À comparer aux
 * ~200 ms que coûte une seule création de process sur un poste avec EDR.
 *
 * Contrat de ce module : **aucune logique métier**, aucune dépendance à
 * Electron. Il expose des lectures brutes du système et ne décide de rien ;
 * l'interprétation (est-ce du plein écran ?) vit dans `fullscreenLogic.ts`.
 */
import { createRequire } from 'module';

/** Rectangle de fenêtre + PID propriétaire, tel que renvoyé par `user32`. */
export interface ForegroundWindowInfo {
  left: number;
  top: number;
  right: number;
  bottom: number;
  pid: number;
}

/** Code virtuel de la touche Alt — couvre Alt gauche ET droite. */
const VK_MENU = 0x12;
/** Bit de poids fort de `GetAsyncKeyState` = touche actuellement enfoncée. */
const KEY_DOWN_MASK = 0x8000;

interface Win32Api {
  getForegroundWindow: () => unknown;
  getWindowRect: (hwnd: unknown, out: Record<string, number>) => boolean;
  getWindowThreadProcessId: (hwnd: unknown, out: number[]) => number;
  getAsyncKeyState: (vKey: number) => number;
  addressOf: (ptr: unknown) => number | bigint;
}

let api: Win32Api | null = null;
let attempted = false;
let loadError: string | null = null;

/**
 * Charge koffi et déclare les fonctions `user32`. **Paresseux et tolérant** :
 * une seule tentative par session, et tout échec est capturé.
 *
 * Le chargement doit impérativement rester hors du chemin d'import du module :
 * un `import koffi from 'koffi'` en tête de fichier ferait échouer le
 * démarrage complet de l'app si le binaire natif manquait (asar mal
 * dépaqueté) ou si une politique WDAC durcie en bloquait le chargement.
 * `createRequire` est le pattern déjà utilisé dans le projet pour les modules
 * natifs CJS depuis un bundle ESM (cf. `audio/volume.ts`).
 */
function load(): Win32Api | null {
  if (attempted) return api;
  attempted = true;

  if (process.platform !== 'win32') {
    loadError = 'plateforme non Windows';
    return null;
  }

  try {
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');

    // RECT = 4 LONG contigus. `_Out_` demande à koffi de traiter le pointeur
    // comme une sortie : l'objet passé à l'appel est rempli par la fonction.
    koffi.struct('RECT', {
      left: 'long',
      top: 'long',
      right: 'long',
      bottom: 'long',
    });

    api = {
      getForegroundWindow: user32.func('void *GetForegroundWindow()'),
      getWindowRect: user32.func('bool GetWindowRect(void *hWnd, _Out_ RECT *lpRect)'),
      getWindowThreadProcessId: user32.func(
        'uint32 GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *lpdwProcessId)',
      ),
      getAsyncKeyState: user32.func('int16 GetAsyncKeyState(int vKey)'),
      addressOf: koffi.address,
    };
    return api;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    api = null;
    return null;
  }
}

/**
 * True si la couche native est utilisable. Déclenche le chargement au premier
 * appel — à interroger une fois au démarrage pour choisir l'implémentation du
 * détecteur.
 */
export function isNativeWin32Available(): boolean {
  return load() !== null;
}

/**
 * Raison de l'indisponibilité, ou `null`. Sert à tracer *pourquoi* on est
 * retombé sur PowerShell, plutôt que de le laisser deviner.
 */
export function getNativeWin32Error(): string | null {
  load();
  return loadError;
}

/**
 * Rectangle et PID de la fenêtre au premier plan. `null` si la couche native
 * est indisponible, s'il n'y a pas de fenêtre au premier plan (bureau, écran
 * de verrouillage) ou si `GetWindowRect` échoue (fenêtre disparue entre les
 * deux appels — cas normal, à ignorer silencieusement).
 */
export function readForegroundWindow(): ForegroundWindowInfo | null {
  const win32 = load();
  if (!win32) return null;

  const hwnd = win32.getForegroundWindow();
  // Handle nul = aucune fenêtre au premier plan (bureau, verrouillage).
  if (!hwnd || Number(win32.addressOf(hwnd)) === 0) return null;

  const rect: Record<string, number> = {};
  if (!win32.getWindowRect(hwnd, rect)) return null;

  const pidOut = [0];
  win32.getWindowThreadProcessId(hwnd, pidOut);

  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    pid: pidOut[0],
  };
}

/**
 * True si Alt est enfoncé à cet instant. `false` si la couche native est
 * indisponible — un mode Peek muet est préférable à un notch bloqué en
 * transparence.
 */
export function isAltDown(): boolean {
  const win32 = load();
  if (!win32) return false;
  return (win32.getAsyncKeyState(VK_MENU) & KEY_DOWN_MASK) !== 0;
}
