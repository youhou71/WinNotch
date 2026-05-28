/**
 * Chip Système dans la collapsed row.
 *
 * Affichage : un mini sparkline SVG + une valeur courte à droite. La
 * métrique affichée (CPU / RAM / NET) est définie par
 * `moduleConfig.system.primaryMetric` (défaut `cpu`).
 *
 * Couleur conditionnelle selon le seuil de la métrique active (vert →
 * or → rouge). Tooltip rich au survol qui détaille les 3 métriques + uptime.
 */
import type { CSSProperties } from 'react';
import { useSystemContext } from './SystemContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { NotchTooltip } from '../../components/Tooltip/NotchTooltip';
import { Sparkline } from './Sparkline';
import {
  formatBitrate,
  formatBytes,
  formatChipValue,
  formatPercent,
  formatUptime,
  seriesMax,
  thresholdColor,
} from './formatters';

const SYSTEM_ACCENT: CSSProperties = {
  '--tt-accent': '#34d399',
  '--tt-accent-fade': 'rgba(52, 211, 153, 0.18)',
} as CSSProperties;

export function SystemChip() {
  const { state } = useSystemContext();
  const { settings } = useSettingsContext();
  const cfg = settings.moduleConfig.system;

  const metric = cfg.primaryMetric;
  const series =
    metric === 'cpu' ? state.cpu : metric === 'ram' ? state.ram : state.net;
  const max = seriesMax(metric, series.history);
  const color = thresholdColor(metric, series.value);
  const label = formatChipValue(metric, series.value);

  const metricLabel: Record<typeof metric, string> = {
    cpu: 'CPU',
    ram: 'RAM',
    net: 'NET',
  };

  return (
    <NotchTooltip
      accentStyle={SYSTEM_ACCENT}
      content={
        <div className="tt-body">
          <div className="tt-head">
            <i className="fa-solid fa-gauge-high" />
            <span>système — {metricLabel[metric].toLowerCase()}</span>
          </div>
          <ul className="tt-list">
            <li className="tt-row">
              <span className="tt-title">CPU</span>
              <span className="tt-sub">{formatPercent(state.cpu.value)}</span>
            </li>
            <li className="tt-row">
              <span className="tt-title">RAM</span>
              <span className="tt-sub">
                {formatPercent(state.ram.value)} · {formatBytes(state.ram.usedBytes)} / {formatBytes(state.ram.totalBytes)}
              </span>
            </li>
            <li className="tt-row">
              <span className="tt-title">Réseau</span>
              <span className="tt-sub">{formatBitrate(state.net.value)}</span>
            </li>
            <li className="tt-row">
              <span className="tt-title">Uptime</span>
              <span className="tt-sub">{formatUptime(state.uptimeSec)}</span>
            </li>
          </ul>
        </div>
      }
    >
      <div className="chip chip-system" style={{ color }}>
        <Sparkline
          points={series.history}
          max={max}
          color={color}
          width={38}
          height={12}
        />
        <span className="chip-system-val">{label}</span>
      </div>
    </NotchTooltip>
  );
}
