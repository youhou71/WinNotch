/**
 * Détecte les transitions de seuil sur les fenêtres `claude.usage` et
 * émet un toast (respectant le DND via le ToastProvider).
 *
 * Pour chaque fenêtre (5h, 7d) on regarde si le pourcentage franchit un
 * des seuils configurés (par défaut 70 / 85 / 95). Un seuil franchi est
 * mémorisé jusqu'au prochain reset (ou jusqu'à ce que le `%` repasse
 * sous le seuil) — pas de re-toast intempestif.
 *
 * Premier batch reçu = baseline silencieuse pour éviter le flood au
 * démarrage de l'app (l'utilisateur connaît déjà sa conso au moment
 * d'ouvrir).
 */
import { useEffect, useRef } from 'react';
import { useClaudeUsageContext } from './ClaudeUsageContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { useToast } from '../toast/ToastContext';

type WindowKey = 'fiveH' | 'weekly';

interface SeenState {
  /** Seuils déjà franchis pour la fenêtre courante (reset si `resetsAt` change). */
  crossed: Set<number>;
  /** `resetsAt` du dernier snapshot — sert à détecter un nouveau cycle. */
  resetsAt: number;
}

const WINDOW_LABELS: Record<WindowKey, string> = {
  fiveH: '5 h',
  weekly: '7 j',
};

export function useClaudeUsageThresholdToasts(): void {
  const { state } = useClaudeUsageContext();
  const { settings } = useSettingsContext();
  const { push } = useToast();

  /** Map<windowKey, SeenState>. `null` jusqu'au premier render. */
  const prev = useRef<Map<WindowKey, SeenState> | null>(null);

  useEffect(() => {
    const cfg = settings.moduleConfig['claude.usage'];
    const moduleOn = settings.modules['claude.usage'];

    // Premier passage : amorce silencieuse — on enregistre l'état courant
    // sans notifier. Sinon, l'utilisateur reçoit un toast pour chaque
    // seuil déjà dépassé au démarrage.
    if (prev.current === null) {
      const map = new Map<WindowKey, SeenState>();
      for (const key of ['fiveH', 'weekly'] as WindowKey[]) {
        const w = state[key];
        const crossed = new Set<number>();
        for (const t of cfg.thresholdsPct) {
          if (w.percent >= t) crossed.add(t);
        }
        map.set(key, { crossed, resetsAt: w.resetsAt });
      }
      prev.current = map;
      return;
    }

    if (!moduleOn || !cfg.notifyThresholds) return;

    for (const key of ['fiveH', 'weekly'] as WindowKey[]) {
      const w = state[key];
      const previous = prev.current.get(key);
      let seen = previous;

      // Nouveau cycle : on remet le set à zéro.
      if (!previous || previous.resetsAt !== w.resetsAt) {
        seen = { crossed: new Set<number>(), resetsAt: w.resetsAt };
        prev.current.set(key, seen);
      }

      const crossed = seen!.crossed;

      for (const threshold of cfg.thresholdsPct) {
        if (w.percent >= threshold && !crossed.has(threshold)) {
          crossed.add(threshold);
          push({
            icon: 'fa-solid fa-gauge-high',
            iconColor:
              threshold >= 95 ? '#ef4444'
                : threshold >= 85 ? '#fbbf24'
                  : 'var(--accent-violet, #a78bfa)',
            name: 'Claude',
            message: `${WINDOW_LABELS[key]} · ${threshold}% atteint`,
          });
        } else if (w.percent < threshold && crossed.has(threshold)) {
          // Repassé sous le seuil (ex. après un reset partiel) : on
          // retire le marqueur pour permettre un nouveau toast plus tard
          // dans le même cycle si le quota remonte.
          crossed.delete(threshold);
        }
      }
    }
  }, [
    state,
    settings.modules,
    settings.moduleConfig,
    push,
  ]);
}
