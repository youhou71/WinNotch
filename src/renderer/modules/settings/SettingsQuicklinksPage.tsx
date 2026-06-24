/**
 * Page Settings → Recherche → Quicklinks (mode `!` de la search bar).
 *
 * Éditeur texte (une ligne = `alias url [| label]`), commit au blur — même
 * pattern que `WatchedLabelsField` (GitLab). Le parsing / la validation
 * vivent dans `shared/quicklinks.ts` (pur) ; le main revalide et déduplique
 * à la persistance.
 */
import { useEffect, useRef, useState } from 'react';
import { useSettingsContext } from './SettingsContext';
import { parseQuicklinksText, serializeQuicklinks } from '../../../shared/quicklinks';
import { useMouseBackButton } from '../../hooks/useMouseBackButton';
import { useEscapeKey } from '../../hooks/useEscapeKey';

interface Props {
  onBack: () => void;
}

const PLACEHOLDER = `npm https://www.npmjs.com/search?q={} | npm
mdn https://developer.mozilla.org/en-US/search?q={} | MDN
gl https://gitlab.exemple.fr/search?search={} | GitLab`;

export function SettingsQuicklinksPage({ onBack }: Props) {
  const { settings, setQuicklinks } = useSettingsContext();
  useMouseBackButton(onBack);
  useEscapeKey(onBack);

  const [text, setText] = useState(() => serializeQuicklinks(settings.quicklinks));
  const dirtyRef = useRef(false);

  // Resync si la liste change ailleurs (rare), sauf édition en cours.
  useEffect(() => {
    if (dirtyRef.current) return;
    setText(serializeQuicklinks(settings.quicklinks));
  }, [settings.quicklinks]);

  const commit = () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    void setQuicklinks(parseQuicklinksText(text));
  };

  const handleReset = () => {
    dirtyRef.current = false;
    setText('');
    void setQuicklinks([]);
  };

  return (
    <>
      <div className="settings-header">
        <button
          type="button"
          className="settings-header-btn"
          onClick={onBack}
          aria-label="Retour"
        >
          <i className="fa-solid fa-chevron-left" />
        </button>
        <div
          className="settings-row-icon"
          style={{ background: '#22d3ee22', color: '#22d3ee' }}
        >
          <i className="fa-solid fa-bolt" />
        </div>
        <div className="settings-header-title">Quicklinks & bangs</div>
        <button
          type="button"
          className="settings-header-btn settings-header-btn-text"
          onClick={handleReset}
          title="Tout supprimer"
        >
          Vider
        </button>
      </div>

      <div className="settings-credentials">
        <label className="settings-field">
          <span className="settings-field-label">
            Une entrée par ligne : <code>alias url [| libellé]</code>. Utilise{' '}
            <code>{'{}'}</code> pour l'emplacement de la requête.
          </span>
          <textarea
            className="settings-field-input settings-field-textarea"
            value={text}
            onChange={(e) => {
              dirtyRef.current = true;
              setText(e.target.value);
            }}
            onBlur={commit}
            placeholder={PLACEHOLDER}
            rows={8}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <div className="settings-credentials-hint">
          Dans la barre de recherche, tape <code>!alias requête</code> (ex.{' '}
          <code>!npm vite</code>). Si l'alias est inconnu, un repli{' '}
          <strong>DuckDuckGo</strong> (<code>!bang</code>) est proposé
          automatiquement. Seules les URL <code>http(s)://</code> sont
          acceptées ; les alias en double sont ignorés.
        </div>
      </div>
    </>
  );
}
