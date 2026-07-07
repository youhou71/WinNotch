/**
 * Page Settings → Recherche → Dossiers de recherche.
 *
 * Éditeur texte (une ligne = un dossier racine), commit au blur — même
 * pattern que `SettingsQuicklinksPage`. Ces racines pilotent DEUX modes de
 * la search bar : le scan des `.sln`/`.slnx` (mode `vs`) et le filtre des
 * workspaces récents VS Code (mode `/`). La validation / dédup vit côté main
 * (`mergeSearchRoots`).
 */
import { useEffect, useRef, useState } from 'react';
import { useSettingsContext } from './SettingsContext';
import { useMouseBackButton } from '../../hooks/useMouseBackButton';
import { useEscapeKey } from '../../hooks/useEscapeKey';

interface Props {
  onBack: () => void;
}

const PLACEHOLDER = `C:/Projets
D:/Work
C:/Users/moi/source/repos`;

/** Sérialise les racines pour l'affichage (une par ligne). */
function serialize(roots: string[]): string {
  return roots.join('\n');
}

/** Parse le textarea en liste de racines (trim + lignes non vides). */
function parse(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export function SettingsSearchRootsPage({ onBack }: Props) {
  const { settings, setSearchRoots } = useSettingsContext();
  useMouseBackButton(onBack);
  useEscapeKey(onBack);

  const [text, setText] = useState(() => serialize(settings.searchRoots));
  const dirtyRef = useRef(false);

  // Resync si la liste change ailleurs (rare), sauf édition en cours.
  useEffect(() => {
    if (dirtyRef.current) return;
    setText(serialize(settings.searchRoots));
  }, [settings.searchRoots]);

  const commit = () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    void setSearchRoots(parse(text));
  };

  const handleReset = () => {
    dirtyRef.current = false;
    setText('');
    void setSearchRoots([]);
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
          style={{ background: '#a16ce822', color: '#a16ce8' }}
        >
          <i className="fa-solid fa-folder-tree" />
        </div>
        <div className="settings-header-title">Dossiers de recherche</div>
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
            Un dossier racine par ligne (ex. <code>C:/Projets</code>).
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
            rows={6}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <div className="settings-credentials-hint">
          Ces dossiers sont scannés récursivement pour les solutions Visual
          Studio (mode <code>vs</code>) et servent à filtrer les workspaces
          récents VS Code (mode <code>/</code>) : seuls ceux situés sous l'une
          de ces racines sont affichés. Liste vide = aucun résultat{' '}
          <code>vs</code> et aucun filtre <code>/</code> (tous les récents sont
          montrés).
        </div>
      </div>
    </>
  );
}
