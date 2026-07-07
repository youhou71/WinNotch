/**
 * Page Settings (drilldown) rendue dans le dashboard étendu quand
 * l'utilisateur clique sur le bouton gear de la search bar.
 *
 * Navigation interne :
 *  - Home (liste modules + apparence)
 *  - Page module (back → Home)
 *
 * La fermeture complète de la SettingsView est gérée par
 * `ExpandedDashboard` qui détient le state `settingsOpen`. On reçoit
 * `onClose` pour signaler la fermeture (clic sur la croix du header
 * uniquement présent en Home).
 */
import { useCallback, useState } from 'react';
import type { ModuleId } from '../../../shared/types';
import { SettingsHome } from './SettingsHome';
import { SettingsModulePage } from './SettingsModulePage';
import { SettingsLayoutPage } from './SettingsLayoutPage';
import { SettingsQuicklinksPage } from './SettingsQuicklinksPage';
import { SettingsSnippetsPage } from './SettingsSnippetsPage';
import { SettingsSearchRootsPage } from './SettingsSearchRootsPage';
import { useMouseBackButton } from '../../hooks/useMouseBackButton';
import { useEscapeKey } from '../../hooks/useEscapeKey';

/**
 * Page sélectionnée dans le drilldown Settings.
 *
 *  - `null` → Home
 *  - `'layout'` → page Disposition du dashboard (réordonnancement + largeur)
 *  - `'quicklinks'` → page Quicklinks & bangs (mode `!` de la search bar)
 *  - `'snippets'` → page Snippets (mode `:` de la search bar)
 *  - `'searchRoots'` → page Dossiers de recherche (modes `vs` et `/`)
 *  - `ModuleId` → page de configuration d'un module
 */
type SettingsPageId =
  | ModuleId
  | 'layout'
  | 'quicklinks'
  | 'snippets'
  | 'searchRoots';

interface Props {
  onClose: () => void;
}

export function SettingsView({ onClose }: Props) {
  const [page, setPage] = useState<SettingsPageId | null>(null);

  // Bouton "Précédent" de la souris (XButton1) :
  //  - dans une sous-page → retour à la liste racine
  //  - sur la liste racine → ferme la SettingsView complètement
  //
  // Note : la SettingsLayoutPage et SettingsModulePage installent aussi
  // leurs propres handlers back via `useMouseBackButton` interne, mais on
  // les évite ici en branchant sur le state — `useMouseBackButton` du
  // parent reste muet quand `page !== null` (handler null = pas de listener).
  const handleBack = useCallback(() => {
    if (page) setPage(null);
    else onClose();
  }, [page, onClose]);
  useMouseBackButton(page === null ? handleBack : null);
  useEscapeKey(page === null ? handleBack : null);

  return (
    <div className="settings-view" data-notch-hit="true">
      {page === null && (
        <>
          <div className="settings-header">
            <div className="settings-header-title">Réglages</div>
            <button
              type="button"
              className="settings-header-btn"
              onClick={onClose}
              aria-label="Fermer les réglages"
              title="Fermer"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
          <SettingsHome
            onSelectModule={(id) => setPage(id)}
            onOpenLayout={() => setPage('layout')}
            onOpenQuicklinks={() => setPage('quicklinks')}
            onOpenSnippets={() => setPage('snippets')}
            onOpenSearchRoots={() => setPage('searchRoots')}
          />
        </>
      )}
      {page === 'layout' && (
        <SettingsLayoutPage onBack={() => setPage(null)} />
      )}
      {page === 'quicklinks' && (
        <SettingsQuicklinksPage onBack={() => setPage(null)} />
      )}
      {page === 'snippets' && (
        <SettingsSnippetsPage onBack={() => setPage(null)} />
      )}
      {page === 'searchRoots' && (
        <SettingsSearchRootsPage onBack={() => setPage(null)} />
      )}
      {page !== null &&
        page !== 'layout' &&
        page !== 'quicklinks' &&
        page !== 'snippets' &&
        page !== 'searchRoots' && (
          <SettingsModulePage moduleId={page} onBack={() => setPage(null)} />
        )}
    </div>
  );
}
