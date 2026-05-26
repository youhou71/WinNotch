/**
 * Hook React qui expose l'historique du presse-papier + mutations.
 *
 * Pattern identique aux autres modules (useMusic, useGitLab) :
 *  - mount → getState() pour avoir un snapshot dès le premier render
 *  - onChange pour recevoir les push du main (nouvelles entries, mutations)
 *  - mutations IPC qui retournent le nouveau state pour réconciliation
 *
 * `pendingFocusAt` est incrémenté à chaque réception de `clipboard:focusCard`
 * (raccourci global Ctrl+Shift+V). Les composants qui veulent réagir
 * s'abonnent à ce nombre via un `useEffect`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardState, UrlUnfurl } from '../../../shared/types';

const EMPTY: ClipboardState = { entries: [], lastSeenAt: 0 };

export function useClipboard() {
  const [state, setState] = useState<ClipboardState>(EMPTY);
  const [pendingFocusAt, setPendingFocusAt] = useState(0);
  /**
   * État global de la page Clipboard. Vit dans le Context (pas dans le
   * composant ExpandedDashboard qui se démonte à chaque collapse) pour
   * garder une seule source de vérité. Le raccourci Ctrl+Shift+V
   * l'ouvre via `onFocusCard`. L'app la ferme automatiquement quand
   * le notch passe en collapsed (cf. AppInner) pour éviter qu'elle
   * réapparaisse à la prochaine ouverture via Ctrl+Shift+Space.
   */
  const [pageOpen, setPageOpen] = useState(false);
  // Ref pour ignorer les push entrants après unmount (sécurité strict mode).
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    window.notch.clipboard.getState().then((s) => {
      if (alive.current) setState(s);
    });
    const offChange = window.notch.clipboard.onChange((s) => {
      if (alive.current) setState(s);
    });
    const offFocus = window.notch.clipboard.onFocusCard(() => {
      if (alive.current) {
        setPendingFocusAt(Date.now());
        setPageOpen(true);
      }
    });
    return () => {
      alive.current = false;
      offChange();
      offFocus();
    };
  }, []);

  const openPage = useCallback(() => setPageOpen(true), []);
  const closePage = useCallback(() => setPageOpen(false), []);
  const togglePage = useCallback(() => setPageOpen((o) => !o), []);

  const pin = useCallback(async (id: string) => {
    const next = await window.notch.clipboard.pin(id);
    setState(next);
  }, []);

  const unpin = useCallback(async (id: string) => {
    const next = await window.notch.clipboard.unpin(id);
    setState(next);
  }, []);

  const copyAgain = useCallback(async (id: string) => {
    const next = await window.notch.clipboard.copyAgain(id);
    setState(next);
  }, []);

  const remove = useCallback(async (id: string) => {
    const next = await window.notch.clipboard.remove(id);
    setState(next);
  }, []);

  const clear = useCallback(async (keepPinned: boolean) => {
    const next = await window.notch.clipboard.clear(keepPinned);
    setState(next);
  }, []);

  const markSeen = useCallback(async () => {
    const next = await window.notch.clipboard.markSeen();
    setState(next);
  }, []);

  const unfurl = useCallback(
    async (id: string): Promise<UrlUnfurl | null> => {
      return window.notch.clipboard.unfurl(id);
    },
    [],
  );

  const saveImage = useCallback(async (id: string) => {
    return window.notch.clipboard.saveImage(id);
  }, []);

  const openPath = useCallback(async (id: string) => {
    return window.notch.clipboard.openPath(id);
  }, []);

  return {
    state,
    pendingFocusAt,
    pageOpen,
    openPage,
    closePage,
    togglePage,
    pin,
    unpin,
    copyAgain,
    remove,
    clear,
    markSeen,
    unfurl,
    saveImage,
    openPath,
  };
}
