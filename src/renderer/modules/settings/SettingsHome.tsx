/**
 * Page racine du drilldown Settings.
 *
 * Sections rendues :
 *  - Apparence : choix de densité (dense / normal / airy)
 *  - Modules : groupés par famille (cf. `moduleGroupsMeta.ts`). Les
 *    modules sans famille tombent dans une section virtuelle « Autres
 *    modules ». Chaque entrée garde son toggle inline et son drilldown.
 *  - Notifications : toggle DND (peut aussi être togglé via Ctrl+Shift+D)
 */
import type { ModuleGroupId, ModuleId } from '../../../shared/types';
import { parseModuleId } from '../../../shared/types';
import {
  SettingsSection,
  SettingsRadioRow,
  SettingsRow,
  SettingsToggle,
  SettingsToggleRow,
} from './atoms';
import { useSettingsContext } from './SettingsContext';
import { SETTINGS_MODULES, type ModuleMeta } from './modulesMeta';
import { MODULE_GROUPS } from './moduleGroupsMeta';
import { UpdaterRow } from '../updater/UpdaterRow';
import { useToast } from '../toast/ToastContext';

interface Props {
  /** Ouvre la page d'un module spécifique. */
  onSelectModule: (id: ModuleId) => void;
  /** Ouvre la page "Disposition du dashboard" (drag-and-drop des tuiles). */
  onOpenLayout: () => void;
  /** Ouvre la page "Quicklinks & bangs" (mode `!` de la search bar). */
  onOpenQuicklinks: () => void;
  /** Ouvre la page "Snippets" (mode `:` de la search bar). */
  onOpenSnippets: () => void;
  /** Ouvre la page "Dossiers de recherche" (modes `vs` et `/`). */
  onOpenSearchRoots: () => void;
}

/**
 * Regroupe les modules par famille pour l'affichage Settings.
 * Préserve l'ordre de déclaration dans `SETTINGS_MODULES`.
 */
function groupModules(modules: ModuleMeta[]): {
  groups: Map<ModuleGroupId, ModuleMeta[]>;
  standalone: ModuleMeta[];
} {
  const groups = new Map<ModuleGroupId, ModuleMeta[]>();
  const standalone: ModuleMeta[] = [];
  for (const meta of modules) {
    const { group } = parseModuleId(meta.id);
    if (group) {
      const list = groups.get(group) ?? [];
      list.push(meta);
      groups.set(group, list);
    } else {
      standalone.push(meta);
    }
  }
  return { groups, standalone };
}

export function SettingsHome({
  onSelectModule,
  onOpenLayout,
  onOpenQuicklinks,
  onOpenSnippets,
  onOpenSearchRoots,
}: Props) {
  const { settings, setDensity, setModule, toggleDnd, setAutoStart } =
    useSettingsContext();
  const { push: pushToast } = useToast();

  const { groups, standalone } = groupModules(SETTINGS_MODULES);

  /**
   * Bascule le démarrage auto et confirme par un toast. L'échec de l'opération
   * système (création/suppression de la tâche planifiée) n'est plus silencieux :
   * `setAutoStart` remonte `ok`/`error`, et l'état réel (`res.settings`)
   * annule l'update optimiste si la tâche n'a pas pu être créée.
   */
  async function handleAutoStart(next: boolean) {
    const res = await setAutoStart(next);
    if (res.ok) {
      pushToast({
        icon: next ? 'fa-solid fa-check' : 'fa-solid fa-power-off',
        iconColor: next ? '#34d399' : '#94a3b8',
        name: 'Démarrage',
        message: next
          ? 'WinNotch démarrera avec Windows'
          : 'Démarrage automatique désactivé',
      });
    } else {
      pushToast({
        icon: 'fa-solid fa-triangle-exclamation',
        iconColor: '#ef4444',
        name: 'Démarrage',
        message: res.error
          ? `Échec : ${res.error}`
          : 'Impossible de modifier le démarrage automatique',
      });
    }
  }

  function renderModuleRow(m: ModuleMeta) {
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
  }

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
          onChange={(next) => void handleAutoStart(next)}
        />
        <SettingsRow
          icon="fa-solid fa-right-from-bracket"
          iconColor="#f87171"
          label="Quitter WinNotch"
          description="Ferme l'application. Aucun processus ne reste actif en arrière-plan."
          onClick={() => window.notch.shell.quit()}
        />
      </SettingsSection>

      <SettingsSection title="Recherche">
        <SettingsRow
          icon="fa-solid fa-bolt"
          iconColor="#22d3ee"
          label="Quicklinks & bangs"
          description="Raccourcis web déclenchés par « ! » dans la barre de recherche (ex. !npm vite)."
          onClick={onOpenQuicklinks}
          right={<i className="fa-solid fa-chevron-right settings-chevron" />}
        />
        <SettingsRow
          icon="fa-solid fa-paste"
          iconColor="#34d399"
          label="Snippets"
          description="Modèles de texte à placeholders, déclenchés par « : » dans la barre (ex. :sig)."
          onClick={onOpenSnippets}
          right={<i className="fa-solid fa-chevron-right settings-chevron" />}
        />
        <SettingsRow
          icon="fa-solid fa-folder-tree"
          iconColor="#a16ce8"
          label="Dossiers de recherche"
          description="Racines scannées pour les solutions VS (« vs ») et filtre des workspaces récents VS Code (« / »)."
          onClick={onOpenSearchRoots}
          right={<i className="fa-solid fa-chevron-right settings-chevron" />}
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

      {/* Sections de modules groupés par famille (Claude, …). */}
      {[...groups.entries()].map(([groupId, members]) => {
        const groupMeta = MODULE_GROUPS[groupId];
        return (
          <SettingsSection
            key={`group-${groupId}`}
            title={groupMeta.label}
            description={groupMeta.description}
          >
            {members.map(renderModuleRow)}
          </SettingsSection>
        );
      })}

      {/* Modules autonomes (sans `.` dans leur ID). */}
      <SettingsSection title="Autres modules">
        {standalone.map(renderModuleRow)}
      </SettingsSection>
    </>
  );
}
