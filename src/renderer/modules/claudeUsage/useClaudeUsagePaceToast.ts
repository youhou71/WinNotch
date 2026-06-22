/**
 * Toast de RYTHME (Lot 1 #3) — distinct des alertes de seuil absolu.
 *
 * Émet un toast quand, à la vélocité de consommation actuelle, une fenêtre
 * (5 h ou 7 j) sera épuisée AVANT son reset (`projection[key].exhaustAt`
 * non-null côté main). Un seul toast par cycle (clé = `resetsAt`) pour ne
 * pas spammer ; rearmé au reset suivant.
 *
 * Premier batch reçu = baseline silencieuse (pas de toast au démarrage
 * pour un état déjà « en dépassement de rythme »).
 */
import { useEffect, useRef } from 'react';
import { useClaudeUsageContext } from './ClaudeUsageContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { useToast } from '../toast/ToastContext';

type WindowKey = 'fiveH' | 'weekly';

const WINDOW_LABELS: Record<WindowKey, string> = {
  fiveH: '5 h',
  weekly: '7 j',
};

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Marge mini entre épuisement projeté et reset pour déclencher l'alerte :
 * inutile d'alerter si on n'épuise que quelques minutes avant le reset
 * (bruit de bord).
 */
const PACE_MARGIN_MS = 10 * 60 * 1000;

function formatExhaust(ts: number, now: number): string {
  const ms = ts - now;
  if (ms <= 0) return 'maintenant';
  if (ms < DAY_MS) {
    const min = Math.round(ms / 60000);
    if (min < 60) return `dans ${min} min`;
    const h = Math.floor(min / 60);
    const rem = min % 60;
    return rem > 0 ? `dans ${h} h ${rem}` : `dans ${h} h`;
  }
  return new Date(ts).toLocaleString('fr-FR', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function useClaudeUsagePaceToast(): void {
  const { state } = useClaudeUsageContext();
  const { settings } = useSettingsContext();
  const { push } = useToast();

  /** Map<windowKey, resetsAt déjà alerté> (`-1` = jamais). `null` avant 1er render. */
  const fired = useRef<Map<WindowKey, number> | null>(null);

  useEffect(() => {
    const cfg = settings.moduleConfig['claude.usage'];
    const moduleOn = settings.modules['claude.usage'];

    const isSignificant = (key: WindowKey): boolean => {
      const exhaustAt = state.projection[key].exhaustAt;
      if (exhaustAt === null) return false;
      return state[key].resetsAt - exhaustAt > PACE_MARGIN_MS;
    };

    // Baseline silencieuse : on mémorise l'état courant sans notifier.
    if (fired.current === null) {
      const map = new Map<WindowKey, number>();
      for (const key of ['fiveH', 'weekly'] as WindowKey[]) {
        map.set(key, isSignificant(key) ? state[key].resetsAt : -1);
      }
      fired.current = map;
      return;
    }

    if (!moduleOn || !cfg.notifyPace) return;

    const now = Date.now();
    for (const key of ['fiveH', 'weekly'] as WindowKey[]) {
      const resetsAt = state[key].resetsAt;
      const alreadyFired = fired.current.get(key);
      if (isSignificant(key)) {
        if (alreadyFired !== resetsAt) {
          fired.current.set(key, resetsAt);
          const exhaustAt = state.projection[key].exhaustAt as number;
          push({
            icon: 'fa-solid fa-bolt',
            iconColor: '#fb923c',
            name: 'Claude',
            message: `À ce rythme : ${WINDOW_LABELS[key]} épuisé ${formatExhaust(exhaustAt, now)}`,
          });
        }
      } else if (alreadyFired !== -1 && alreadyFired !== resetsAt) {
        // Nouveau cycle non encore en dépassement → réarme.
        fired.current.set(key, -1);
      }
    }
  }, [state, settings.modules, settings.moduleConfig, push]);
}
