/**
 * Page Settings du module Système live.
 *
 * Sections :
 *   1. Affichage — toggle chip / card, choix de la métrique principale
 *   2. Échantillonnage — slider pollMs (500-5000 ms)
 *   3. À propos — info read-only sur la source des données
 */
import type { SystemMetricKey } from '../../../shared/types';
import { useSettingsContext } from '../settings/SettingsContext';
import {
  SettingsRadioRow,
  SettingsSection,
  SettingsSliderRow,
  SettingsToggleRow,
} from '../settings/atoms';

const SYSTEM_COLOR = '#34d399';

const METRIC_OPTIONS: { value: SystemMetricKey; label: string }[] = [
  { value: 'cpu', label: 'CPU' },
  { value: 'ram', label: 'RAM' },
  { value: 'net', label: 'NET' },
];

export function SystemSettings() {
  const { settings, patchModuleConfig } = useSettingsContext();
  const cfg = settings.moduleConfig.system;

  return (
    <>
      <SettingsSection title="Affichage">
        <SettingsToggleRow
          icon="fa-solid fa-minimize"
          iconColor={SYSTEM_COLOR}
          label="Afficher la chip dans le notch rétracté"
          description="Sparkline + pourcentage de la métrique choisie. Visible même en mode Ne pas Déranger (c'est un état système, pas une notification)."
          value={cfg.collapsed}
          onChange={(next) => void patchModuleConfig('system', { collapsed: next })}
        />
        <SettingsToggleRow
          icon="fa-solid fa-table-cells-large"
          iconColor={SYSTEM_COLOR}
          label="Afficher la card dans le dashboard"
          description="Trois jauges horizontales (CPU / RAM / NET) + uptime du PC. Décoche pour ne garder que la chip."
          value={cfg.showCard}
          onChange={(next) => void patchModuleConfig('system', { showCard: next })}
        />
        <SettingsRadioRow<SystemMetricKey>
          icon="fa-solid fa-bullseye"
          iconColor={SYSTEM_COLOR}
          label="Métrique de la chip"
          description="Indicateur affiché en permanence dans le notch rétracté. La card étendue montre toujours les trois."
          value={cfg.primaryMetric}
          options={METRIC_OPTIONS}
          onChange={(v) => void patchModuleConfig('system', { primaryMetric: v })}
        />
      </SettingsSection>

      <SettingsSection title="Échantillonnage">
        <SettingsSliderRow
          icon="fa-solid fa-clock-rotate-left"
          iconColor={SYSTEM_COLOR}
          label="Fréquence du polling"
          description="Intervalle entre deux mesures. Plus court = sparkline plus fluide mais charge PowerShell plus élevée (la lecture réseau coûte ~80 ms)."
          value={cfg.pollMs}
          min={500}
          max={5000}
          step={250}
          formatValue={(v) => `${(v / 1000).toFixed(v < 1000 ? 2 : 1)} s`}
          onChange={(v) => void patchModuleConfig('system', { pollMs: v })}
        />
      </SettingsSection>

      <SettingsSection title="À propos">
        <div className="settings-empty">
          CPU, RAM et uptime sont lus via Node natif (<code>os.cpus()</code>,{' '}
          <code>os.totalmem()</code>, <code>os.uptime()</code>). Le débit
          réseau est calculé via <code>Get-NetAdapterStatistics</code> avec
          un filtre d'exclusion automatique (loopback, vEthernet, WSL,
          Bluetooth PAN, pseudo-interfaces). Module read-only.
        </div>
      </SettingsSection>
    </>
  );
}
