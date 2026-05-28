/**
 * Context partagé pour la state de la search bar du notch étendu.
 *
 * Centralise la `query` qui était auparavant tenue par
 * `<ExpandedDashboard>` en `useState` local — problème : le composant est
 * démonté/remonté à chaque collapse/expand du notch, et certains
 * composants (`<TasksCounterCard>` qui force `setQuery('-')`, hooks back
 * qui vident la query, raccourci global Ctrl+Shift+V qui ouvre la page
 * Clipboard) doivent pouvoir écrire/lire la query indépendamment du
 * parent.
 *
 * Comportement : la query est conservée tant que le Provider vit (toute
 * la session de l'app). `AppInner` la reset explicitement au passage en
 * mode `collapsed` via `clearSearch()` — sinon une recherche en cours
 * survivrait à un Ctrl+Shift+Space.
 */
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

interface SearchContextValue {
  query: string;
  setQuery: (q: string) => void;
  clearSearch: () => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('');
  const clearSearch = useCallback(() => setQuery(''), []);

  return (
    <SearchContext.Provider value={{ query, setQuery, clearSearch }}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearchContext(): SearchContextValue {
  const ctx = useContext(SearchContext);
  if (!ctx) {
    throw new Error(
      "useSearchContext doit être appelé à l'intérieur de <SearchProvider>",
    );
  }
  return ctx;
}
