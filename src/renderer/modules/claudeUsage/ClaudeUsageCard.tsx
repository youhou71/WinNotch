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
import type {
  ClaudeUsagePlan,
  ClaudeUsageState,
  ClaudeUsageWindow,
} from '../../../shared/types';
import { useClaudeUsageContext } from './ClaudeUsageContext';
import { Sparkline } from '../system/Sparkline';

const DAY_MS = 24 * 60 * 60 * 1000;

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

/**
 * Formate l'instant d'épuisement projeté : relatif si < 24 h
 * (« dans 38 min »), sinon jour + heure (« jeu. 16:00 »).
 */
function formatExhaust(ts: number, now: number): string {
  const ms = ts - now;
  if (ms < DAY_MS) return `dans ${formatRelative(ms)}`;
  return new Date(ts).toLocaleString('fr-FR', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Construit la trajectoire pointillée future pour la sparkline 5 h :
 * échantillonne `percent + vélocité·t` jusqu'à l'épuisement projeté ou le
 * reset (le plus proche). `null` si rien à projeter.
 */
function buildProjectionTrace(
  percent: number,
  velocityPctPerHour: number,
  exhaustAt: number | null,
  resetsAt: number,
  now: number,
): { pts: number[]; fraction: number } | null {
  if (velocityPctPerHour <= 0) return null;
  const horizonEnd = Math.min(exhaustAt ?? resetsAt, resetsAt);
  const horizonMs = horizonEnd - now;
  if (horizonMs <= 60_000) return null;
  const STEPS = 8;
  const pts: number[] = [];
  for (let i = 1; i <= STEPS; i++) {
    const tHours = (horizonMs / 3_600_000) * (i / STEPS);
    pts.push(Math.min(100, percent + velocityPctPerHour * tHours));
  }
  // Part de largeur réservée au futur, relative aux 24 h d'historique.
  const fraction = Math.max(0.12, Math.min(0.45, horizonMs / (DAY_MS + horizonMs)));
  return { pts, fraction };
}

/**
 * Ligne de projection sous les jauges : met en avant les fenêtres qui
 * seront épuisées AVANT leur reset à la vélocité actuelle ; sinon rassure
 * (« tenu ») dès qu'un rythme est mesurable.
 */
function ProjectionLine({
  projection,
  now,
}: {
  projection: ClaudeUsageState['projection'];
  now: number;
}) {
  const warn: string[] = [];
  if (projection.fiveH.exhaustAt)
    warn.push(`5 h épuisé ${formatExhaust(projection.fiveH.exhaustAt, now)}`);
  if (projection.weekly.exhaustAt)
    warn.push(`7 j épuisé ${formatExhaust(projection.weekly.exhaustAt, now)}`);

  if (warn.length > 0) {
    return (
      <div className="cu-projection cu-projection-warn">
        <i className="fa-solid fa-bolt" />
        <span>{warn.join(' · ')}</span>
      </div>
    );
  }
  if (
    projection.fiveH.velocityPctPerHour >= 0.5 ||
    projection.weekly.velocityPctPerHour >= 0.5
  ) {
    return (
      <div className="cu-projection cu-projection-ok">
        <i className="fa-solid fa-check" />
        <span>Tenu jusqu'au reset</span>
      </div>
    );
  }
  return null;
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

      <ProjectionLine projection={state.projection} now={now} />

      {(() => {
        const showInstallWarn = !state.statuslineInstalled;
        const showEstimatedWarn =
          !showInstallWarn &&
          (state.fiveH.source === 'estimated' ||
            state.weekly.source === 'estimated');
        const hasWarn = showInstallWarn || showEstimatedWarn;
        const trace = buildProjectionTrace(
          state.fiveH.percent,
          state.projection.fiveH.velocityPctPerHour,
          state.projection.fiveH.exhaustAt,
          state.fiveH.resetsAt,
          now,
        );
        return (
          <div className={'cu-card-foot' + (hasWarn ? ' has-warn' : '')}>
            <Sparkline
              points={state.sparkline}
              max={100}
              color="var(--accent-violet, #a78bfa)"
              width={120}
              height={18}
              stretch
              projection={trace?.pts}
              projectionFraction={trace?.fraction}
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
