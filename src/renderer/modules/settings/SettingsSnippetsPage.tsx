/**
 * Page Settings → Recherche → Snippets (mode `:` de la search bar).
 *
 * Éditeur texte multi-snippets : chaque snippet commence par une ligne
 * d'en-tête `## nom`, suivie de son body (multi-ligne). Commit au blur,
 * même pattern que la page Quicklinks. Parsing dans `shared/snippets.ts`.
 */
import { useEffect, useRef, useState } from 'react';
import { useSettingsContext } from './SettingsContext';
import { parseSnippetsText, serializeSnippets } from '../../../shared/snippets';
import { useMouseBackButton } from '../../hooks/useMouseBackButton';
import { useEscapeKey } from '../../hooks/useEscapeKey';

interface Props {
  onBack: () => void;
}

const PLACEHOLDER = `lgtm LGTM ✅ — relu le {date}, bon pour moi.
quote > {clipboard}
sig Cordialement,\\n— {date}`;

export function SettingsSnippetsPage({ onBack }: Props) {
  const { settings, setSnippets } = useSettingsContext();
  useMouseBackButton(onBack);
  useEscapeKey(onBack);

  const [text, setText] = useState(() => serializeSnippets(settings.snippets));
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (dirtyRef.current) return;
    setText(serializeSnippets(settings.snippets));
  }, [settings.snippets]);

  const commit = () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    void setSnippets(parseSnippetsText(text));
  };

  const handleReset = () => {
    dirtyRef.current = false;
    setText('');
    void setSnippets([]);
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
          style={{ background: '#34d39922', color: '#34d399' }}
        >
          <i className="fa-solid fa-paste" />
        </div>
        <div className="settings-header-title">Snippets</div>
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
            Un snippet par ligne : <code>nom contenu</code> (le nom est le
            premier mot). Saut de ligne dans le contenu = <code>\n</code>.
            Placeholders : <code>{'{clipboard}'}</code>,{' '}
            <code>{'{date}'}</code>, <code>{'{time}'}</code>,{' '}
            <code>{'{uuid}'}</code>.
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
            rows={12}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <div className="settings-credentials-hint">
          Dans la barre, tape <code>:nom</code> pour filtrer, puis ↑↓ et
          Entrée pour copier le snippet (placeholders résolus). La valeur de{' '}
          <code>{'{clipboard}'}</code> n'est jamais affichée à l'écran —
          uniquement insérée au moment de la copie.
        </div>
      </div>
    </>
  );
}
