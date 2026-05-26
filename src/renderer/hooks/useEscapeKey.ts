/**
 * Intercepte la touche Escape au niveau document et appelle un callback.
 *
 * Pendant exact de `useMouseBackButton` côté clavier — sert à donner
 * un comportement "back" cohérent entre la souris (XButton1) et le
 * clavier (Esc).
 *
 * Les vues s'enregistrent avec leur propre handler ; comme les
 * overlays du notch (GitLabPanel, SettingsView, mode search) sont
 * mutuellement exclusifs, un seul callback non-null est actif à un
 * instant T — pas de conflit en pratique.
 *
 * Passer `null` désactive l'écoute (utile quand le composant est monté
 * mais que Esc ne doit rien faire dans certains états — typiquement
 * un parent qui délègue à un enfant overlay).
 */
import { useEffect } from 'react';

export function useEscapeKey(callback: (() => void) | null): void {
  useEffect(() => {
    if (!callback) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // On intercepte Esc même quand le focus est dans un input — c'est
      // la convention "modale" : Esc ferme la vue active. L'utilisateur
      // perd la saisie en cours, ce qui est le comportement attendu et
      // cohérent avec macOS / Windows.
      e.preventDefault();
      e.stopPropagation();
      callback();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [callback]);
}
