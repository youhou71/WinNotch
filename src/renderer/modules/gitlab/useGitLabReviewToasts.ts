/**
 * Détecte les nouvelles MR assignées en review et émet un toast.
 *
 * Stratégie diff : on garde l'ensemble des `id` de MR à reviewer du
 * tick précédent, et à chaque mise à jour on calcule les nouveaux IDs
 * (présents maintenant, absents avant). Un toast par nouvelle MR.
 *
 * Premier batch après boot = baseline silencieuse (sinon flood de
 * toasts pour les MR historiques au démarrage de l'app).
 *
 * Respecte les toggles `modules.gitlab` + `moduleConfig.gitlab.notify.mr`.
 */
import { useEffect, useRef } from 'react';
import { useGitLabContext } from './GitLabContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { useToast } from '../toast/ToastContext';

export function useGitLabReviewToasts(): void {
  const { state } = useGitLabContext();
  const { settings } = useSettingsContext();
  const { push } = useToast();

  /** Snapshot des IDs vus au tick précédent. `null` = baseline non amorcée. */
  const prev = useRef<Set<number> | null>(null);

  const sectionOn = settings.moduleConfig.gitlab.sections.toReview;

  useEffect(() => {
    // Pas configuré → on ne touche pas à la baseline.
    // Section non suivie → on la **désarme** : la liste est vide côté main,
    // et sans ce reset, la réactiver ferait passer la liste de vide à
    // pleine d'un coup — un toast pour chaque MR, y compris les plus
    // anciennes. Au retour, le premier passage ré-amorce en silence.
    if (!state.configured || !sectionOn) {
      prev.current = null;
      return;
    }

    // Premier passage configuré : amorce la baseline sans notifier.
    if (prev.current === null) {
      prev.current = new Set(state.toReview.map((m) => m.id));
      return;
    }

    const before = prev.current;
    const after = new Set(state.toReview.map((m) => m.id));
    const newOnes = state.toReview.filter((m) => !before.has(m.id));
    prev.current = after;

    const moduleOn = settings.modules.gitlab;
    const notifyOn = settings.moduleConfig.gitlab.notify.mr;
    if (!moduleOn || !notifyOn) return;

    for (const mr of newOnes) {
      push({
        icon: 'fa-brands fa-gitlab',
        iconColor: '#FC6D26',
        name: mr.projectName || 'GitLab',
        message: `Review demandée · ${mr.title}`,
      });
    }
  }, [
    state.configured,
    state.toReview,
    sectionOn,
    settings.modules.gitlab,
    settings.moduleConfig.gitlab.notify.mr,
    push,
  ]);
}
