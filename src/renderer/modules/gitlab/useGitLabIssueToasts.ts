/**
 * Détecte les nouvelles issues GitLab correspondant à un label surveillé
 * (ex. `Severity::Critique`) et émet un toast par nouvelle issue.
 *
 * Diff par ID, comme `useGitLabReviewToasts` :
 *  - Premier batch après boot = baseline silencieuse (sinon flood d'issues
 *    historiques au démarrage).
 *  - À chaque tick, IDs présents maintenant moins IDs présents avant
 *    = nouvelles → toast pour chacune.
 *
 * Respecte le toggle `moduleConfig.gitlab.notify.watchedIssues`.
 */
import { useEffect, useRef } from 'react';
import { useGitLabContext } from './GitLabContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { useToast } from '../toast/ToastContext';

export function useGitLabIssueToasts(): void {
  const { state } = useGitLabContext();
  const { settings } = useSettingsContext();
  const { push } = useToast();

  const prev = useRef<Set<number> | null>(null);
  /**
   * Signature de la liste de labels surveillés vue au tick précédent.
   * Si elle change, on rebase silencieusement : sinon ajouter un label
   * ferait apparaître ses anciennes issues comme "nouvelles" et
   * déclencherait un flood de toasts pour des issues qui existaient
   * déjà depuis longtemps.
   */
  const prevLabelsKey = useRef<string>('');

  const sectionOn = settings.moduleConfig.gitlab.sections.watchedIssues;

  useEffect(() => {
    // Section non suivie → baseline désarmée, même raison que le reset sur
    // changement de labels ci-dessous : à la réactivation, toutes les
    // issues déjà là passeraient pour des nouveautés.
    if (!state.configured || !sectionOn) {
      prev.current = null;
      return;
    }

    const currentLabelsKey = settings.moduleConfig.gitlab.watchedLabels.join('|');
    if (currentLabelsKey !== prevLabelsKey.current) {
      // Reset baseline silencieuse : on adopte la liste courante sans
      // émettre de toast pour aucune issue.
      prev.current = new Set(state.watchedIssues.map((i) => i.id));
      prevLabelsKey.current = currentLabelsKey;
      return;
    }

    if (prev.current === null) {
      prev.current = new Set(state.watchedIssues.map((i) => i.id));
      return;
    }

    const before = prev.current;
    const after = new Set(state.watchedIssues.map((i) => i.id));
    const newOnes = state.watchedIssues.filter((i) => !before.has(i.id));
    prev.current = after;

    const moduleOn = settings.modules.gitlab;
    const notifyOn = settings.moduleConfig.gitlab.notify.watchedIssues;
    if (!moduleOn || !notifyOn) return;

    for (const issue of newOnes) {
      push({
        icon: 'fa-solid fa-circle-exclamation',
        iconColor: '#ef4444',
        name: issue.projectName || 'GitLab',
        message: `${issue.matchedLabel} · ${issue.title}`,
      });
    }
  }, [
    state.configured,
    state.watchedIssues,
    sectionOn,
    settings.modules.gitlab,
    settings.moduleConfig.gitlab.notify.watchedIssues,
    settings.moduleConfig.gitlab.watchedLabels,
    push,
  ]);
}
