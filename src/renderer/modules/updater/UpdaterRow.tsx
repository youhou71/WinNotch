/**
 * Section "À propos" / "Mises à jour" dans Settings → Home.
 *
 * Affiche :
 *  - la version installée
 *  - l'état courant (idle / checking / available / downloading / downloaded / error)
 *  - un bouton contextuel selon l'état :
 *      • `idle`/`no-update`/`error` → "Vérifier maintenant"
 *      • `available`                → "Télécharger v{x}"
 *      • `downloading`              → "{percent} %"  (désactivé)
 *      • `downloaded`               → "Redémarrer et installer"
 *
 * En dev, electron-updater renvoie une erreur explicite — affichée
 * telle quelle dans la description pour que le développeur comprenne
 * pourquoi le bouton ne fait rien.
 */
import { useState } from 'react';
import { SettingsRow } from '../settings/atoms';
import { useUpdaterContext } from './UpdaterContext';
import { useToast } from '../toast/ToastContext';

/**
 * Libellé descriptif sous le titre — résume l'état pour l'utilisateur
 * sans avoir besoin de regarder l'icône du bouton.
 */
function describe(state: ReturnType<typeof useUpdaterContext>['state']): string {
  switch (state.status) {
    case 'idle':
      return `Version ${state.currentVersion} · à jour`;
    case 'checking':
      return 'Vérification en cours…';
    case 'no-update':
      return `Version ${state.currentVersion} · à jour`;
    case 'available':
      return `Mise à jour disponible · v${state.latestVersion ?? '?'}`;
    case 'downloading':
      return `Téléchargement · ${state.downloadPercent ?? 0} %`;
    case 'downloaded':
      return `Prêt à installer · v${state.latestVersion ?? '?'}`;
    case 'error':
      return state.error ?? 'Erreur';
  }
}

export function UpdaterRow() {
  const { state, checkNow, download, quitAndInstall } = useUpdaterContext();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  const handlePrimary = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (state.status === 'available') {
        const res = await download();
        if (!res.ok) {
          push({
            icon: 'fa-solid fa-triangle-exclamation',
            iconColor: '#ef4444',
            name: 'WinNotch',
            message: res.error ?? 'Échec du téléchargement',
          });
        }
      } else if (state.status === 'downloaded') {
        const res = await quitAndInstall();
        if (!res.ok) {
          push({
            icon: 'fa-solid fa-triangle-exclamation',
            iconColor: '#ef4444',
            name: 'WinNotch',
            message: res.error ?? "Échec de l'installation",
          });
        }
      } else {
        await checkNow();
      }
    } finally {
      setBusy(false);
    }
  };

  // Libellé du bouton selon l'état. Le bouton est désactivé pendant les
  // états intermédiaires (checking, downloading) car il n'y a aucune
  // action utile à offrir à l'utilisateur — la transition se fera seule.
  const buttonProps = (() => {
    switch (state.status) {
      case 'checking':
        return { label: 'Vérification…', disabled: true };
      case 'available':
        return { label: 'Télécharger', disabled: busy };
      case 'downloading':
        return { label: `${state.downloadPercent ?? 0} %`, disabled: true };
      case 'downloaded':
        return { label: 'Redémarrer', disabled: busy };
      case 'idle':
      case 'no-update':
      case 'error':
      default:
        return { label: 'Vérifier', disabled: busy };
    }
  })();

  return (
    <SettingsRow
      icon="fa-solid fa-arrow-up-from-bracket"
      iconColor="var(--accent)"
      label="WinNotch"
      description={describe(state)}
      right={
        <button
          type="button"
          className="settings-link-btn"
          onClick={() => void handlePrimary()}
          disabled={buttonProps.disabled}
        >
          {buttonProps.label}
        </button>
      }
    />
  );
}
