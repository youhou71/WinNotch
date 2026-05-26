/**
 * Context React pour partager l'état clipboard sans dupliquer les
 * abonnements IPC (cf. note dans MusicContext).
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useClipboard } from './useClipboard';

type ClipboardContextValue = ReturnType<typeof useClipboard>;

const ClipboardContext = createContext<ClipboardContextValue | null>(null);

export function ClipboardProvider({ children }: { children: ReactNode }) {
  const value = useClipboard();
  return (
    <ClipboardContext.Provider value={value}>
      {children}
    </ClipboardContext.Provider>
  );
}

export function useClipboardContext(): ClipboardContextValue {
  const ctx = useContext(ClipboardContext);
  if (!ctx) {
    throw new Error(
      "useClipboardContext doit être appelé à l'intérieur de <ClipboardProvider>",
    );
  }
  return ctx;
}
