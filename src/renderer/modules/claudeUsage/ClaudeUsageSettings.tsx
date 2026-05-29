/**
 * Page Settings du module `claude.usage`.
 *
 * Permet à l'utilisateur de :
 *  - sélectionner son plan d'abonnement (Pro / Max 5× / Max 20× / Inconnu)
 *  - régler les seuils de toasts (par défaut 70 / 85 / 95)
 *  - régler la fréquence de polling (10 s – 5 min)
 *  - installer / désinstaller le wrapper statusline WinNotch
 *  - basculer l'affichage de la card dans le dashboard
 */
import { useState } from 'react';
import type { ClaudeUsagePlan } from '../../../shared/types';
import {
  SettingsRadioRow,
  SettingsRow,
  SettingsSection,
  SettingsSliderRow,
  SettingsToggle,
  SettingsToggleRow,
} from '../settings/atoms';
import { useSettingsContext } from '../settings/SettingsContext';
import { useClaudeUsageContext } from './ClaudeUsageContext';
import { useToast } from '../toast/ToastContext';

export function ClaudeUsageSettings() {
  const { settings, patchModuleConfig } = useSettingsContext();
  const { state, installStatusline } = useClaudeUsageContext();
  const { push: pushToast } = useToast();
  const cfg = settings.moduleConfig['claude.usage'];
  const [installing, setInstalling] = useState(false);

  async function handleInstallToggle(next: boolean) {
    setInstalling(true);
    try {
      const result = await installStatusline(next);
      if (result.ok) {
        pushToast({
          icon: next ? 'fa-solid fa-check' : 'fa-solid fa-trash',
          iconColor: next ? '#34d399' : '#94a3b8',
          name: 'Statusline',
          message: next
            ? 'Wrapper installé — relance Claude Code pour activer'
            : 'Wrapper WinNotch désinstallé',
        });
      } else {
        pushToast({
          icon: 'fa-solid fa-triangle-exclamation',
          iconColor: '#ef4444',
          name: 'Statusline',
          message: result.error ?? 'Échec',
        });
      }
    } finally {
      setInstalling(false);
    }
  }

  return (
    <>
      <SettingsSection title="Plan">
        <SettingsRadioRow<ClaudeUsagePlan>
          icon="fa-solid fa-id-badge"
          iconColor="#a78bfa"
          label="Tier d'abonnement"
          description="Sert à afficher les valeurs absolues (messages restants) en plus des pourcentages. Inconnu = seuls les % sont affichés. Les plans équipe partagent les mêmes nominaux par seat que leurs équivalents perso (Team ≡ Pro, Team+ ≡ Max 5×)."
          value={cfg.plan}
          options={[
            { value: 'pro', label: 'Pro / Team' },
            { value: 'max5x', label: 'Max 5× / Team+' },
            { value: 'max20x', label: 'Max 20×' },
            { value: 'unknown', label: 'Inconnu' },
          ]}
          onChange={(next) => void patchModuleConfig('claude.usage', { plan: next })}
        />
      </SettingsSection>

      <SettingsSection title="Notifications">
        <SettingsToggleRow
          icon="fa-solid fa-bell"
          iconColor="#fbbf24"
          label="Alertes de seuil"
          description="Émet un toast à chaque franchissement de 70 %, 85 %, 95 % sur la fenêtre 5 h ou 7 j. Filtré automatiquement en Ne pas Déranger."
          value={cfg.notifyThresholds}
          onChange={(next) =>
            void patchModuleConfig('claude.usage', { notifyThresholds: next })
          }
        />
      </SettingsSection>

      <SettingsSection title="Polling">
        <SettingsSliderRow
          icon="fa-solid fa-stopwatch"
          iconColor="#60a5fa"
          label="Fréquence de relecture"
          description="Intervalle entre deux lectures du cache statusline. Plus court = chiffres plus à jour, plus long = moins d'I/O."
          value={Math.round(cfg.pollMs / 1000)}
          min={10}
          max={300}
          step={5}
          formatValue={(v) => (v < 60 ? `${v} s` : `${Math.round(v / 60)} min`)}
          onChange={(secs) =>
            void patchModuleConfig('claude.usage', { pollMs: secs * 1000 })
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Statusline WinNotch"
        description="Le wrapper s'installe dans ~/.claude/settings.json. À chaque turn de Claude Code, il écrit les rate_limits dans ~/.claude/winnotch-usage.json sans rien casser de ton statusline existant. ⚠️ Les sessions Claude Code DÉJÀ ouvertes ne sont pas affectées — Claude lit settings.json au démarrage de la session. Relance Claude après install pour activer."
      >
        <SettingsRow
          icon={state.statuslineInstalled ? 'fa-solid fa-check' : 'fa-solid fa-plug'}
          iconColor={state.statuslineInstalled ? '#34d399' : '#94a3b8'}
          label={state.statuslineInstalled ? 'Wrapper installé' : 'Wrapper non installé'}
          description={
            state.claudeInstalled
              ? state.statuslineInstalled
                ? 'Lance une session Claude pour rafraîchir le cache.'
                : 'Cliquer sur le bouton pour installer le wrapper.'
              : 'Claude Code non détecté (dossier ~/.claude/ absent).'
          }
          right={
            <SettingsToggle
              value={state.statuslineInstalled}
              onChange={(next) => {
                if (!installing) void handleInstallToggle(next);
              }}
              ariaLabel="Installer / désinstaller le wrapper statusline WinNotch"
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Affichage">
        <SettingsToggleRow
          icon="fa-solid fa-table-columns"
          iconColor="#a78bfa"
          label="Afficher la card dans le dashboard"
          value={cfg.showCard}
          onChange={(next) =>
            void patchModuleConfig('claude.usage', { showCard: next })
          }
        />
      </SettingsSection>
    </>
  );
}
