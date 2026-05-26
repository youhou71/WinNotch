/**
 * Context React pour partager l'état music sans dupliquer les abonnements IPC.
 *
 * Sans context, chaque composant (MusicChip, MusicCard, Notch pour la
 * largeur dynamique) appellerait `useMusic()` séparément et créerait son
 * propre abonnement `onChange` → triple inscription côté ipcRenderer et
 * triple re-render à chaque tick. Avec un provider en haut de l'arbre,
 * tous les consommateurs partagent le même state.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useMusic } from './useMusic';

type MusicContextValue = ReturnType<typeof useMusic>;

const MusicContext = createContext<MusicContextValue | null>(null);

export function MusicProvider({ children }: { children: ReactNode }) {
  const value = useMusic();
  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>;
}

/**
 * À utiliser dans tout composant descendant de `<MusicProvider>`.
 * Throw si appelé hors provider — détection rapide d'un oubli d'arbre.
 */
export function useMusicContext(): MusicContextValue {
  const ctx = useContext(MusicContext);
  if (!ctx) {
    throw new Error('useMusicContext doit être appelé à l\'intérieur de <MusicProvider>');
  }
  return ctx;
}
