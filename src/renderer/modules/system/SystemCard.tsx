/**
 * Card Système live du dashboard étendu.
 *
 * Layout (une seule rangée horizontale) :
 *
 *   CPU 14%      RAM 45%      NET 1.5 Mb/s      ◷ 3h 52
 *   ▬▬░░░░░      ▬▬▬▬░░       ▬░░░░░░░
 *
 * Chaque cellule métrique = label uppercase + valeur colorée côte à côte,
 * et une barre de progression fine en dessous. L'uptime à droite est
 * détaché (pas de barre). Pas de header `système` au-dessus — le module
 * tient en une seule ligne très dense, c'est le but.
 */
import { useSystemContext } from './SystemContext';
import {
  formatBitrate,
  formatPercent,
  formatUptime,
  thresholdColor,
} from './formatters';
import type { SystemMetricKey } from '../../../shared/types';

interface CellProps {
  metricKey: SystemMetricKey;
  label: string;
  value: number;
  formatted: string;
  color: string;
  fillPercent: number;
}

function Cell({ metricKey: _metricKey, label, formatted, color, fillPercent }: CellProps) {
  return (
    <div className="system-cell">
      <div className="system-cell-head">
        <span className="system-cell-label">{label}</span>
        <span className="system-cell-val" style={{ color }}>
          {formatted}
        </span>
      </div>
      <div className="system-cell-track">
        <div
          className="system-cell-fill"
          style={{
            width: `${Math.max(0, Math.min(100, fillPercent))}%`,
            background: color,
          }}
        />
      </div>
    </div>
  );
}

export function SystemCard() {
  const { state } = useSystemContext();

  const cpuColor = thresholdColor('cpu', state.cpu.value);
  const ramColor = thresholdColor('ram', state.ram.value);
  const netColor = thresholdColor('net', state.net.value);

  // Échelle de référence pour la barre NET : 100 Mb/s = 12.5 MB/s. Au-delà
  // la barre sature — la valeur précise reste lisible dans le texte.
  const NET_FULL_BPS = 12_500_000;
  const netFillPct = (state.net.value / NET_FULL_BPS) * 100;

  return (
    <div className="system-card" data-notch-hit="true">
      <div className="system-row">
        <Cell
          metricKey="cpu"
          label="CPU"
          value={state.cpu.value}
          formatted={formatPercent(state.cpu.value)}
          color={cpuColor}
          fillPercent={state.cpu.value}
        />
        <Cell
          metricKey="ram"
          label="RAM"
          value={state.ram.value}
          formatted={formatPercent(state.ram.value)}
          color={ramColor}
          fillPercent={state.ram.value}
        />
        <Cell
          metricKey="net"
          label="NET"
          value={state.net.value}
          formatted={formatBitrate(state.net.value)}
          color={netColor}
          fillPercent={netFillPct}
        />
        <div className="system-uptime" title={state.lastError ?? undefined}>
          {state.lastError && <span className="system-error-dot" />}
          <i className="fa-regular fa-clock" />
          <span className="system-uptime-val">
            {formatUptime(state.uptimeSec)}
          </span>
        </div>
      </div>
    </div>
  );
}
