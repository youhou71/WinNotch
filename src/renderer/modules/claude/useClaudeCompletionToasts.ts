/**
 * Détecte les transitions remarquables d'une session Claude et émet un toast.
 *
 * Deux types d'événements traqués :
 *
 *  1. **Claude attend une réponse utilisateur** (transition
 *     `waitingForInput: false → true`) — typique d'un `AskUserQuestion`
 *     ou `ExitPlanMode`. Toast jaune « En attente de ta réponse ».
 *     Détecté directement sur le champ booléen, sans dépendre du
 *     `status` (qui peut ne jamais passer en `waiting` si l'utilisateur
 *     répond vite — le file `.jsonl` a déjà un `tool_result` avant la
 *     garde 3s du computeStatus).
 *
 *  2. **Claude a fini son tour productif** (transition `status: working →
 *     autre` ET le tour contenait au moins un `tool_use` d'exécution) —
 *     `stop_reason: end_turn`, toast violet « Session terminée ». Les
 *     tours purement conversationnels (récap, explication, simple
 *     réponse texte) **ne déclenchent pas** ce toast : la transition est
 *     toujours détectée mais filtrée via `lastTurnHadWork`.
 *
 * Logique côté renderer plutôt que main : on a déjà la liste à jour via
 * `ClaudeContext` et l'accès à `ToastContext`. Pas besoin d'un canal IPC
 * dédié — on compare juste le snapshot précédent au nouveau.
 *
 * Respecte le toggle `moduleConfig.claude.notifyCompletion`. Si le module
 * Claude est désactivé globalement (`modules.claude=false`), aucun toast.
 *
 * Premier batch reçu = baseline silencieuse pour éviter le flood de
 * notifications au démarrage de l'app pour des sessions historiques.
 */
import { useEffect, useRef } from 'react';
import type { ClaudeSession, ClaudeSessionStatus } from '../../../shared/types';
import { useClaudeContext } from './ClaudeContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { useToast } from '../toast/ToastContext';

interface SessionSnapshot {
  status: ClaudeSessionStatus;
  waitingForInput: boolean;
}

/**
 * Détecte la fin "naturelle" d'une session : transition depuis `working`
 * vers n'importe quel autre statut (waiting/idle/done).
 *
 * On choisit `working → *` plutôt que `* → idle` parce que `working →
 * waiting` arrive ~3 s après la fin du tour de Claude (mentalement
 * = "Claude a fini de répondre"), alors que `* → idle` exigerait 5 min
 * de mtime stale.
 */
function isCompletion(
  before: ClaudeSessionStatus,
  after: ClaudeSessionStatus,
): boolean {
  return before === 'working' && after !== 'working';
}

export function useClaudeCompletionToasts(): void {
  const { sessions } = useClaudeContext();
  const { settings } = useSettingsContext();
  const { push } = useToast();

  /**
   * Map id → snapshot précédent (status + waitingForInput). On utilise
   * une ref pour ne pas re-déclencher le useEffect au moindre changement
   * de notre propre state.
   */
  const prev = useRef<Map<string, SessionSnapshot> | null>(null);

  useEffect(() => {
    // Premier passage : on amorce le snapshot sans notifier. Sinon, à
    // l'ouverture de l'app, on flooderait l'utilisateur avec des toasts
    // pour des sessions déjà finies depuis longtemps ou en attente
    // historique.
    if (prev.current === null) {
      const map = new Map<string, SessionSnapshot>();
      for (const s of sessions) {
        map.set(s.id, { status: s.status, waitingForInput: s.waitingForInput });
      }
      prev.current = map;
      return;
    }

    const previous = prev.current;
    const next = new Map<string, SessionSnapshot>();
    const completed: ClaudeSession[] = [];
    const askingForInput: ClaudeSession[] = [];

    for (const s of sessions) {
      next.set(s.id, { status: s.status, waitingForInput: s.waitingForInput });
      const before = previous.get(s.id);
      if (!before) continue;

      // Transition vers "attente utilisateur" — détectée directement sur
      // le booléen, indépendamment du status.
      if (!before.waitingForInput && s.waitingForInput) {
        askingForInput.push(s);
      }

      // Transition de fin de tour — uniquement si :
      //  - ce n'est pas un cas "question" déjà traité ci-dessus
      //    (AskUserQuestion → working→waiting + waitingForInput true,
      //    on émet le toast jaune, pas le violet)
      //  - le tour était *productif* (au moins un tool_use d'exécution :
      //    Bash, Edit, Read, Write, …). Sinon = récap / explication /
      //    réponse conversationnelle → pas de toast (sinon Claude
      //    notifie à chaque message texte, ce qui sature l'utilisateur).
      if (
        isCompletion(before.status, s.status) &&
        !s.waitingForInput &&
        s.lastTurnHadWork
      ) {
        completed.push(s);
      }
    }

    prev.current = next;

    const moduleOn = settings.modules.claude;
    const notify = settings.moduleConfig.claude.notifyCompletion;
    if (!moduleOn || !notify) return;

    for (const s of askingForInput) {
      push({
        icon: 'fa-solid fa-circle-question',
        iconColor: '#fbbf24',
        name: s.project || 'Claude',
        message: 'En attente de ta réponse',
      });
    }
    for (const s of completed) {
      push({
        icon: 'fa-solid fa-sparkles',
        iconColor: 'var(--accent-violet)',
        name: s.project || 'Claude',
        message: 'Session terminée',
      });
    }
  }, [sessions, settings.modules.claude, settings.moduleConfig.claude.notifyCompletion, push]);
}
