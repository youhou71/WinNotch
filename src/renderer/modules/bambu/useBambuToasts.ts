/**
 * Toasts du module Bambu (Lot 1 #4) — TOAST-ONLY, jamais d'auto-expand.
 *
 * Émet (sous réserve des toggles de config + DND via le ToastProvider) :
 *  - **Fin d'impression** : transition d'un état d'impression → FINISH,
 *    avec la durée si connue (« Impression terminée · 4h12 »).
 *  - **Échec** : transition → FAILED.
 *  - **HMS grave** : nouvelle erreur HMS de niveau fatal / serious.
 *  - **Filament bas** : une bobine AMS passe sous le seuil (uniquement si
 *    `remainPercent` est connu — P1 sans RFID = `null` → jamais d'alerte).
 *
 * GARDE-FOU : le premier état reçu (snapshot `pushall` au connect / au boot)
 * sert de **baseline silencieuse** — pas de faux « terminée » au démarrage,
 * et les HMS / bobines déjà basses ne re-notifient pas.
 */
import { useEffect, useRef } from 'react';
import { useBambuContext } from './BambuContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { useToast } from '../toast/ToastContext';
import { BAMBU_ACCENT, formatEta } from './bambuLabels';
import type { BambuGcodeState } from '../../../shared/types';

/** Seuil « filament bas » (% restant). En dessous → alerte (une fois par bobine). */
const LOW_FILAMENT_PCT = 10;

const PRINTING_STATES: BambuGcodeState[] = ['RUNNING', 'PAUSE', 'PREPARE'];

interface PrevState {
  gcodeState: BambuGcodeState;
  /** Codes HMS fatal/serious déjà notifiés (retirés quand ils disparaissent). */
  firedHms: Set<string>;
  /** Slots AMS déjà notifiés « bas » (retirés quand ils repassent au-dessus). */
  lowSlots: Set<number>;
}

export function useBambuToasts(): void {
  const { state } = useBambuContext();
  const { settings } = useSettingsContext();
  const { push } = useToast();

  const prev = useRef<PrevState | null>(null);

  useEffect(() => {
    const cfg = settings.moduleConfig.bambu;
    const moduleOn = settings.modules.bambu;

    const fatalCodes = state.hms
      .filter((h) => h.level === 'fatal' || h.level === 'serious')
      .map((h) => h.code);
    const lowNow = state.amsTrays
      .filter((t) => t.remainPercent !== null && t.remainPercent <= LOW_FILAMENT_PCT)
      .map((t) => t.slot);

    // Baseline silencieuse : on enregistre l'état courant sans notifier.
    if (prev.current === null) {
      prev.current = {
        gcodeState: state.gcodeState,
        firedHms: new Set(fatalCodes),
        lowSlots: new Set(lowNow),
      };
      return;
    }

    const p = prev.current;
    const wasPrinting = PRINTING_STATES.includes(p.gcodeState);

    if (moduleOn && cfg.notifyPrint) {
      // Fin d'impression.
      if (wasPrinting && state.gcodeState === 'FINISH') {
        const dur = state.lastPrint?.durationMin ?? null;
        push({
          icon: 'fa-solid fa-circle-check',
          iconColor: BAMBU_ACCENT,
          name: 'Bambu',
          message:
            'Impression terminée' +
            (dur !== null ? ` · ${formatEta(dur)}` : '') +
            (state.lastPrint?.fileName ? ` — ${state.lastPrint.fileName}` : ''),
        });
      }
      // Échec.
      if (wasPrinting && state.gcodeState === 'FAILED') {
        push({
          icon: 'fa-solid fa-circle-xmark',
          iconColor: '#ef4444',
          name: 'Bambu',
          message:
            'Impression échouée' +
            (state.lastPrint?.fileName ? ` — ${state.lastPrint.fileName}` : ''),
        });
      }
      // HMS grave (nouvelle entrée fatal / serious).
      for (const code of fatalCodes) {
        if (!p.firedHms.has(code)) {
          push({
            icon: 'fa-solid fa-triangle-exclamation',
            iconColor: '#ef4444',
            name: 'Bambu',
            message: `Erreur imprimante · ${code}`,
          });
        }
      }
    }

    // Filament bas (indépendant de notifyPrint).
    if (moduleOn && cfg.notifyFilament) {
      for (const t of state.amsTrays) {
        if (t.remainPercent === null) continue; // P1 sans RFID → pas d'alerte
        if (t.remainPercent <= LOW_FILAMENT_PCT && !p.lowSlots.has(t.slot)) {
          const what = [t.type, t.colorHex].filter(Boolean).join(' ') || `slot ${t.slot}`;
          push({
            icon: 'fa-solid fa-bahai',
            iconColor: '#fbbf24',
            name: 'Bambu',
            message: `Filament bas · ${what} (${t.remainPercent}%)`,
          });
        }
      }
    }

    // Mise à jour des marqueurs (toujours, même toggles off, pour garder une
    // baseline cohérente si l'utilisateur réactive en cours de route).
    p.gcodeState = state.gcodeState;
    p.firedHms = new Set(fatalCodes);
    p.lowSlots = new Set(lowNow);
  }, [state, settings.modules, settings.moduleConfig, push]);
}
