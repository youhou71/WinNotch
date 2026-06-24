/**
 * Toast « pipeline échoué » sur une de MES MR (Lot 3 #9).
 *
 * Diff sur `state.mine` : quand le `pipelineStatus` d'une MR passe à
 * `failed` (et ne l'était pas au tick précédent), un toast est émis. Le
 * marqueur reste jusqu'à ce que le pipeline quitte `failed` (re-toast
 * possible si un nouveau run échoue).
 *
 * Premier batch configuré = baseline silencieuse (pas de toast pour les
 * pipelines déjà rouges au démarrage). Respecte `modules.gitlab` +
 * `moduleConfig.gitlab.notify.pipelines` (désactivé par défaut).
 */
import { useEffect, useRef } from 'react';
import { useGitLabContext } from './GitLabContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { useToast } from '../toast/ToastContext';

export function useGitLabPipelineToasts(): void {
  const { state } = useGitLabContext();
  const { settings } = useSettingsContext();
  const { push } = useToast();

  /** Map<mrId, pipelineStatus> du tick précédent. `null` = baseline non amorcée. */
  const prev = useRef<Map<number, string | null> | null>(null);

  useEffect(() => {
    if (!state.configured) {
      prev.current = null;
      return;
    }

    const snapshot = new Map<number, string | null>(
      state.mine.map((m) => [m.id, m.pipelineStatus]),
    );

    // Baseline silencieuse.
    if (prev.current === null) {
      prev.current = snapshot;
      return;
    }

    const before = prev.current;
    const moduleOn = settings.modules.gitlab;
    const notifyOn = settings.moduleConfig.gitlab.notify.pipelines;

    if (moduleOn && notifyOn) {
      for (const mr of state.mine) {
        if (mr.pipelineStatus === 'failed' && before.get(mr.id) !== 'failed') {
          push({
            icon: 'fa-solid fa-circle-xmark',
            iconColor: '#ef4444',
            name: mr.projectName || 'GitLab',
            message: `Pipeline échoué · ${mr.title}`,
          });
        }
      }
    }

    prev.current = snapshot;
  }, [
    state.configured,
    state.mine,
    settings.modules.gitlab,
    settings.moduleConfig.gitlab.notify.pipelines,
    push,
  ]);
}
