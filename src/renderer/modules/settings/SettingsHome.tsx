/**
 * Page racine du drilldown Settings.
 *
 * Sections rendues :
 *  - Apparence : choix de densité (dense / normal / airy)
 *  - Modules : 1 row par module, clic ouvre la page module, switch
 *    inline pour activer/désactiver
 *  - Notifications : toggle DND (peut aussi être togglé via Ctrl+Shift+D)
 */
import type { ModuleId } from '../../../shared/types';
import {
  SettingsSection,
  SettingsRadioRow,
  SettingsRow,
  SettingsToggle,
  SettingsToggleRow,
} from './atoms';
import { useSettingsContext } from './SettingsContext';
import { SETTINGS_MODULES } from './modulesMeta';
import { UpdaterRow } from '../updater/UpdaterRow';

interface Props {
  /** Ouvre la page d'un module spécifique. */
  onSelectModule: (id: ModuleId) => void;
  /** Ouvre la page "Disposition du dashboard" (drag-and-drop des tuiles). */
  onOpenLayout: () => void;
}

export function SettingsHome({ onSelectModule, onOpenLayout }: Props) {
  const { settings, setDensity, setModule, toggleDnd, setAutoStart } =
    useSettingsContext();

  return (
    <>
      <SettingsSection title="Apparence">
        <SettingsRadioRow
          icon="fa-solid fa-up-right-and-down-left-from-center"
          iconColor="var(--accent)"
          label="Densité du dashboard"
          description="Espacement interne des cards et de la grille."
          value={settings.density}
          options={[
            { value: 'dense', label: 'Dense' },
            { value: 'normal', label: 'Normal' },
            { value: 'airy', label: 'Aéré' },
          ]}
          onChange={(d) => void setDensity(d)}
        />
        <SettingsRow
          icon="fa-solid fa-table-cells-large"
          iconColor="#60a5fa"
          label="Disposition du dashboard"
          description="Réordonne les tuiles et ajuste leur largeur sur 12 colonnes."
          onClick={onOpenLayout}
          right={<i className="fa-solid fa-chevron-right settings-chevron" />}
        />
      </SettingsSection>

      <SettingsSection title="Système">
        <SettingsToggleRow
          icon="fa-solid fa-power-off"
          iconColor="var(--accent-green)"
          label="Démarrer avec Windows"
          description="Lance WinNotch automatiquement à l'ouverture de session."
          value={settings.autoStart}
          onChange={(next) => void setAutoStart(next)}
        />
        <SettingsRow
          icon="fa-solid fa-right-from-bracket"
          iconColor="#f87171"
          label="Quitter WinNotch"
          description="Ferme l'application. Aucun processus ne reste actif en arrière-plan."
          onClick={() => window.notch.shell.quit()}
        />
      </SettingsSection>

      <SettingsSection title="Notifications">
        <SettingsToggleRow
          icon="fa-solid fa-moon"
          iconColor="var(--accent-violet)"
          label="Ne pas déranger"
          description="Masque les pills de notifications et bloque les toasts."
          value={settings.dnd}
          onChange={() => void toggleDnd()}
        />
      </SettingsSection>

      <SettingsSection title="À propos">
        <UpdaterRow />
      </SettingsSection>

      <SettingsSection title="Modules">
        {SETTINGS_MODULES.map((m) => {
          const enabled = settings.modules[m.id];
          return (
            <SettingsRow
              key={m.id}
              icon={m.icon}
              iconColor={m.color}
              label={m.label}
              description={m.description}
              onClick={() => onSelectModule(m.id)}
              right={
                <>
                  <SettingsToggle
                    value={enabled}
                    onChange={(next) => void setModule(m.id, next)}
                    ariaLabel={`Activer ${m.label}`}
                  />
                  <i className="fa-solid fa-chevron-right settings-chevron" />
                </>
              }
            />
          );
        })}
      </SettingsSection>
    </>
  );
}
