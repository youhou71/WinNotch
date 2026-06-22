/**
 * Détection du mode d'une saisie dans la search bar.
 *
 * Deux familles de modes :
 *
 * 1. **Préfixes explicites** (l'utilisateur tape un caractère initial pour
 *    activer le mode) :
 *  - `>`   → mode Claude (lance une session CLI)
 *  - `/`   → mode VS Code (workspaces récents)
 *  - `vs`  → mode Visual Studio (solutions récentes)
 *  - `-`   → mode Tâches (ajout rapide)
 *  - `=`   → mode Calc & Convert (calcul / conversion inline)
 *
 * 2. **Détection de contenu live** (la search bar regarde ce qui est tapé/
 *    collé et propose une vue adaptée si elle reconnaît un type). Cf.
 *    `shared/clipboardDetectors.ts`. Les types reconnus :
 *  - URL  → titre + favicon + bouton "Ouvrir"
 *  - JSON → pretty-print + bouton "Copier formaté"
 *  - JWT  → header + payload décodés + indicateur d'expiration
 *  - Color → swatch + équivalents hex/rgb/hsl
 *  - Path → bouton "Ouvrir dans Explorer"
 *  - UUID → version + Copier minuscules/MAJUSCULES
 *  - Hash → label MD5/SHA-1/SHA-256 + Copier
 *  - Epoch → date locale + UTC + relatif + Copier ISO
 *
 * Renvoie `payload` (la partie après le préfixe pour les modes 1, ou la
 * query complète pour les modes 2) pour que l'appelant n'ait pas à
 * re-parser. Pour les modes 2, `detection` porte le résultat des
 * détecteurs avec meta typée.
 */
import type { SearchMode } from '../../../shared/types';
import {
  detectFromText,
  type TextDetectionResult,
} from '../../../shared/clipboardDetectors';

export interface DetectedMode {
  mode: SearchMode;
  payload: string;
  /**
   * Résultat des détecteurs textuels, présent uniquement pour les modes
   * `url` | `json` | `color` | `jwt` | `path`.
   */
  detection?: TextDetectionResult;
}

export function detectMode(query: string): DetectedMode | null {
  if (!query) return null;

  // Ordre important : `vs` doit être testé avant `v` ou les préfixes
  // mono-caractère.
  if (/^vs(?=\b|\s|$|[^a-zA-Z])/i.test(query)) {
    return { mode: 'visualstudio', payload: query.slice(2).trim() };
  }
  const first = query[0];
  switch (first) {
    case '>':
      return { mode: 'claude', payload: query.slice(1).trim() };
    case '/':
      return { mode: 'vscode', payload: query.slice(1).trim() };
    case '-':
      return { mode: 'task', payload: query.slice(1).trim() };
    case '=':
      return { mode: 'calc', payload: query.slice(1).trim() };
    case '?':
      return { mode: 'help', payload: query.slice(1).trim() };
  }

  // Détection de contenu live : on ignore le mode `text` (fallback du
  // pipeline shared) pour ne pas court-circuiter le dashboard normal
  // dès que l'utilisateur tape une lettre.
  const det = detectFromText(query);
  if (det && det.type !== 'text' && det.type !== 'image') {
    return { mode: det.type, payload: query, detection: det };
  }

  return null;
}

/**
 * Métadonnées visuelles par mode (utilisées par la chip et le panneau
 * de résultats).
 */
export const MODE_META: Record<
  SearchMode,
  { label: string; icon: string; color: string; placeholder: string }
> = {
  claude: {
    label: 'Claude',
    icon: 'fa-solid fa-sparkles',
    color: '#a78bfa',
    placeholder: 'Prompt pour une nouvelle session Claude…',
  },
  vscode: {
    label: 'VS Code',
    icon: 'fa-solid fa-code',
    color: '#60a5fa',
    placeholder: 'Ouvrir un workspace VS Code…',
  },
  visualstudio: {
    label: 'Visual Studio',
    icon: 'fa-solid fa-cube',
    color: '#9b6efa',
    placeholder: 'Ouvrir une solution Visual Studio…',
  },
  task: {
    label: 'Tâche',
    icon: 'fa-solid fa-list-check',
    color: '#34d399',
    placeholder: 'Ajouter une tâche rapide…',
  },
  calc: {
    label: 'Calc',
    icon: 'fa-solid fa-calculator',
    color: '#fbbf24',
    placeholder: '(1920/3)*2 · 20px to rem · 1.5MB to KB · 0xFF to dec · 1700000000 to date',
  },
  help: {
    label: 'Aide',
    icon: 'fa-regular fa-circle-question',
    color: '#94a3b8',
    placeholder: 'Que peut-on faire ?',
  },
  url: {
    label: 'URL',
    icon: 'fa-solid fa-globe',
    color: '#60a5fa',
    placeholder: '',
  },
  json: {
    label: 'JSON',
    icon: 'fa-solid fa-brackets-curly',
    color: '#f59e0b',
    placeholder: '',
  },
  color: {
    label: 'Couleur',
    icon: 'fa-solid fa-palette',
    color: '#f472b6',
    placeholder: '',
  },
  jwt: {
    label: 'JWT',
    icon: 'fa-solid fa-key',
    color: '#a78bfa',
    placeholder: '',
  },
  path: {
    label: 'Chemin',
    icon: 'fa-regular fa-folder',
    color: '#34d399',
    placeholder: '',
  },
  uuid: {
    label: 'UUID',
    icon: 'fa-solid fa-fingerprint',
    color: '#c084fc',
    placeholder: '',
  },
  hash: {
    label: 'Hash',
    icon: 'fa-solid fa-hashtag',
    color: '#fb923c',
    placeholder: '',
  },
  epoch: {
    label: 'Epoch',
    icon: 'fa-solid fa-clock',
    color: '#38bdf8',
    placeholder: '',
  },
};
