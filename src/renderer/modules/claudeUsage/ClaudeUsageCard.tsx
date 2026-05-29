/**
 * Card `claude.usage` — affiche les limites Claude (5h + 7d) avec
 * countdowns vers le prochain reset et mini-sparkline d'historique 24h.
 *
 * Layout dense (style SystemCard) :
 *
 *   ┌─────────────────────────────────────────┐
 *   │  Claude • limites              [Pro/?]  │
 *   │  5h  ████░░░░░░  42%   reset dans 1h12 │
 *   │  7d  ██░░░░░░░░  18%   reset dans 4j   │
 *   │  ▁▂▃▄▅▆▇  24h                          │
 *   └─────────────────────────────────────────┘
 *
 * Le countdown se rafraîchit localement à 1 Hz pour éviter de solliciter
 * le main process — les `resetsAt` ne bougent que rarement.
 */
import { useEffect, useState } from 'react';
import type { ClaudeUsagePlan, ClaudeUsageWindow } from '../../../shared/types';
import { useClaudeUsageContext } from './ClaudeUsageContext';
import { Sparkline } from '../system/Sparkline';

interface GaugeProps {
  label: string;
  window: ClaudeUsageWindow;
  now: number;
}

function thresholdColor(percent: number): string {
  if (percent < 70) return '#34d399';
  if (percent < 90) return '#fbbf24';
  return '#ef4444';
}

function formatRelative(ms: number): string {
  if (ms <= 0) return 'imminent';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const remMin = min % 60;
  if (h < 24) return remMin > 0 ? `${h} h ${remMin}` : `${h} h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH > 0 ? `${d} j ${remH} h` : `${d} j`;
}

function planBadge(plan: ClaudeUsagePlan): string {
  switch (plan) {
    case 'pro':
      return 'Pro / Team';
    case 'max5x':
      return 'Max 5× / Team+';
    case 'max20x':
      return 'Max 20×';
    default:
      return '?';
  }
}

function Gauge({ label, window, now }: GaugeProps) {
  const color = thresholdColor(window.percent);
  const remainingMs = window.resetsAt - now;
  return (
    <div className="cu-gauge">
      <span className="cu-gauge-label">{label}</span>
      <div className="cu-gauge-track">
        <div
          className="cu-gauge-fill"
          style={{
            width: `${Math.max(0, Math.min(100, window.percent))}%`,
            background: color,
          }}
        />
      </div>
      <span className="cu-gauge-val" style={{ color }}>
        {window.percent.toFixed(0)}%
      </span>
      <span className="cu-gauge-reset" title={new Date(window.resetsAt).toLocaleString()}>
        ↻ {formatRelative(remainingMs)}
      </span>
    </div>
  );
}

export function ClaudeUsageCard() {
  const { state } = useClaudeUsageContext();
  const [now, setNow] = useState(() => Date.now());

  // Tick local 1 Hz — uniquement pour rafraîchir les countdowns. Pas
  // d'IPC, pas de re-render des autres composants.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!state.claudeInstalled) {
    return (
      <div className="cu-card cu-card-empty" data-notch-hit="true">
        <div className="cu-card-empty-icon">
          <i className="fa-solid fa-circle-info" />
        </div>
        <div className="cu-card-empty-body">
          <div className="cu-card-empty-title">Claude Code non détecté</div>
          <div className="cu-card-empty-desc">
            Aucun dossier <code>~/.claude/</code> trouvé. Installe Claude Code
            pour activer le suivi.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cu-card" data-notch-hit="true">
      <div className="cu-card-head">
        <span className="cu-card-title">Claude · limites</span>
        <span className="cu-card-plan" title="Tier d'abonnement (Settings)">
          {planBadge(state.plan)}
        </span>
      </div>

      <Gauge label="5 h" window={state.fiveH} now={now} />
      <Gauge label="7 j" window={state.weekly} now={now} />

      {(() => {
        const showInstallWarn = !state.statuslineInstalled;
        const showEstimatedWarn =
          !showInstallWarn &&
          (state.fiveH.source === 'estimated' ||
            state.weekly.source === 'estimated');
        const hasWarn = showInstallWarn || showEstimatedWarn;
        return (
          <div className={'cu-card-foot' + (hasWarn ? ' has-warn' : '')}>
            <Sparkline
              points={state.sparkline}
              max={100}
              color="var(--accent-violet, #a78bfa)"
              width={120}
              height={18}
              stretch
            />
            <span className="cu-card-foot-label">24 h</span>
            {showInstallWarn && (
              <span
                className="cu-card-foot-warn"
                title="Le wrapper statusline n'est pas installé — installe-le dans Settings → Claude → Limites d'usage pour avoir des valeurs précises."
              >
                <i className="fa-solid fa-triangle-exclamation" /> statusline non installé
              </span>
            )}
            {showEstimatedWarn && (
              <span
                className="cu-card-foot-warn"
                title="Le wrapper est installé mais n'a pas encore tourné. Lance une session Claude (au moins un message) pour activer le tracking précis. En attendant, valeurs estimées à partir des .jsonl locaux."
              >
                <i className="fa-solid fa-circle-info" /> estimé
              </span>
            )}
          </div>
        );
      })()}
    </div>
  );
}
