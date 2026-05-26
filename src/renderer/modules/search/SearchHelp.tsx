/**
 * Vue d'aide affichée quand la search bar passe en mode `?`.
 *
 * Liste tout ce que l'utilisateur peut faire depuis la search bar et
 * depuis l'app en général. Le contenu est filtré selon `settings.modules`
 * (pas la peine d'afficher le préfixe `-` si Tasks est désactivé, etc.).
 *
 * ────────────────────────────────────────────────────────────────────
 *  ⚠ À METTRE À JOUR À CHAQUE :
 *    - Nouveau module (ajouter sa section)
 *    - Nouveau préfixe dans la search bar (ajouter dans PREFIX_ITEMS)
 *    - Nouveau détecteur live (ajouter dans DETECTION_ITEMS)
 *    - Nouveau raccourci global (ajouter dans SHORTCUT_ITEMS)
 *  Pour rester en phase avec la doc utilisateur, ne pas oublier
 *  d'amender aussi README.md (section Search bar / Raccourcis).
 * ────────────────────────────────────────────────────────────────────
 */
import type { ReactNode } from 'react';
import type { Settings } from '../../../shared/types';
import { useSettingsContext } from '../settings/SettingsContext';

interface DocItem {
  /** Ce que l'utilisateur tape ou la touche/séquence. */
  symbol: string;
  /** Libellé court de l'action / fonctionnalité. */
  label: string;
  /** Description (1-2 lignes). */
  description: string;
  /** Affiché uniquement si la prédicate retourne true. */
  enabled?: (s: Settings) => boolean;
}

interface DocSection {
  title: string;
  hint?: string;
  items: DocItem[];
  /** Section masquée si tous ses items sont désactivés. */
}

/* ──────────────────────────────────────────────────────────────────
 *  Préfixes explicites (ce que l'utilisateur tape comme 1er caractère)
 * ────────────────────────────────────────────────────────────────── */
const PREFIX_ITEMS: DocItem[] = [
  {
    symbol: '?',
    label: 'Aide',
    description: 'Affiche ce panneau (ce que tu lis maintenant).',
  },
  {
    symbol: '-',
    label: 'Tâche rapide',
    description:
      'Ajoute une tâche éphémère à la liste locale. Garde le préfixe pour enchaîner les ajouts.',
    enabled: (s) => s.modules.tasks,
  },
  {
    symbol: '>',
    label: 'Lance Claude',
    description:
      'Ouvre un nouveau terminal Windows et exécute `claude "<prompt>"` avec le texte saisi.',
    enabled: (s) => s.modules.claude,
  },
  {
    symbol: '/',
    label: 'VS Code',
    description:
      'Liste les workspaces récents et les ouvre via la CLI `code <path>`. ↑↓ pour naviguer, Entrée pour ouvrir.',
  },
  {
    symbol: 'vs',
    label: 'Visual Studio',
    description:
      'Liste les solutions `.sln` / `.slnx` détectées sur la machine, ouvre via l\'association de fichier.',
  },
];

/* ──────────────────────────────────────────────────────────────────
 *  Détection automatique de contenu (sans préfixe)
 * ────────────────────────────────────────────────────────────────── */
const DETECTION_ITEMS: DocItem[] = [
  {
    symbol: 'https://…',
    label: 'URL',
    description:
      'Affiche host + URL, bouton « Ouvrir » dans le navigateur. Entrée ouvre directement.',
  },
  {
    symbol: 'C:\\… · \\\\serveur\\…',
    label: 'Chemin Windows',
    description:
      'Affiche le basename. Bouton « Ouvrir dans Explorer » (ou Entrée). Dossier → entre dedans, fichier → sélectionné dans le parent.',
  },
  {
    symbol: '{…} · […]',
    label: 'JSON',
    description:
      'Pretty-print coloré, boutons « Copier formaté » / « Copier compact ».',
  },
  {
    symbol: 'h.p.s',
    label: 'JWT',
    description:
      'Décode header + payload, affiche l\'expiration relative. Boutons « Copier le token » / « Copier décodé ».',
  },
  {
    symbol: '#fff · rgb() · hsl()',
    label: 'Code couleur',
    description:
      'Swatch + équivalents HEX/RGB/HSL avec bouton copier sur chacun.',
  },
];

/* ──────────────────────────────────────────────────────────────────
 *  Raccourcis clavier globaux
 * ────────────────────────────────────────────────────────────────── */
const SHORTCUT_ITEMS: DocItem[] = [
  {
    symbol: 'Ctrl + Shift + Space',
    label: 'Ouvrir / fermer le notch',
    description: 'Bascule collapsed ↔ expanded depuis n\'importe quelle app.',
  },
  {
    symbol: 'Ctrl + Shift + V',
    label: 'Ouvrir le presse-papier',
    description:
      'Ouvre le notch directement sur la card Clipboard avec focus sur sa recherche.',
    enabled: (s) => s.modules.clipboard,
  },
  {
    symbol: 'Ctrl + Shift + D',
    label: 'Ne pas Déranger',
    description: 'Active / désactive le mode DND (masque chips notifs + toasts).',
  },
  {
    symbol: 'Alt (maintenu)',
    label: 'Mode Peek',
    description:
      'Rend le notch à 15 % d\'opacité et click-through. Utile pour vérifier ce qui est derrière.',
  },
  {
    symbol: 'Esc · souris Précédent',
    label: 'Back contextuel',
    description:
      'Ferme un overlay (Settings, GitLab panel), vide la search, ou collapse le notch.',
  },
];

const SECTIONS: DocSection[] = [
  {
    title: 'Préfixes',
    hint: 'Tape ces caractères en premier dans la barre de recherche.',
    items: PREFIX_ITEMS,
  },
  {
    title: 'Détection automatique',
    hint: 'Le notch reconnaît ce que tu colles ou tapes et propose les actions adaptées.',
    items: DETECTION_ITEMS,
  },
  {
    title: 'Raccourcis clavier',
    items: SHORTCUT_ITEMS,
  },
];

interface RowProps {
  symbol: string;
  label: string;
  description: ReactNode;
}

function HelpRow({ symbol, label, description }: RowProps) {
  return (
    <div className="search-help-row">
      <kbd className="search-help-kbd">{symbol}</kbd>
      <div className="search-help-body">
        <div className="search-help-label">{label}</div>
        <div className="search-help-desc">{description}</div>
      </div>
    </div>
  );
}

export function SearchHelp() {
  const { settings } = useSettingsContext();

  return (
    <div className="search-help">
      <div className="search-help-intro">
        <i className="fa-regular fa-circle-question search-help-intro-icon" />
        <div>
          <div className="search-help-title">Que peut-on faire ?</div>
          <div className="search-help-sub">
            Tape un préfixe ci-dessous, ou colle un contenu (URL, JSON,
            chemin, couleur, JWT) — la barre s’adapte automatiquement.
          </div>
        </div>
      </div>

      {SECTIONS.map((section) => {
        const visibleItems = section.items.filter(
          (it) => !it.enabled || it.enabled(settings),
        );
        if (visibleItems.length === 0) return null;
        return (
          <div key={section.title} className="search-help-section">
            <div className="search-help-section-title">{section.title}</div>
            {section.hint && (
              <div className="search-help-section-hint">{section.hint}</div>
            )}
            <div className="search-help-section-body">
              {visibleItems.map((it) => (
                <HelpRow
                  key={it.symbol + it.label}
                  symbol={it.symbol}
                  label={it.label}
                  description={it.description}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
