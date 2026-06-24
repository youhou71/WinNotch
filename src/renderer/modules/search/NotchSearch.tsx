/**
 * Search bar sticky en haut du dashboard étendu.
 *
 * Reproduit le pattern `notch-search.jsx` du prototype :
 *  - input plein largeur, padding vertical confortable, radius 12
 *  - chip coloré à gauche quand un préfixe est détecté
 *  - bouton clear (X) à droite si l'input contient du texte
 *  - bouton gear à droite (placeholder pour Phase 4 Settings drilldown)
 *  - panel de résultats sous l'input pour les modes `/` et `vs`
 *
 * Modes :
 *  - `-`  (tâche) : Enter ajoute via SettingsContext
 *  - `=`  (calc) : évaluation inline, Enter copie le résultat
 *  - `!`  (bang) : quicklinks / recherches web, ↑↓ navigation, Enter ouvre
 *  - `;`  (gen) : utilitaires dev (uuid/base64/hash/casse), boutons Copier
 *  - `:`  (snippet) : insertion de snippets à placeholders, Enter copie
 *  - `>`  (Claude) : Enter lance le CLI dans un nouveau terminal
 *  - `/`  (VS Code) : liste des workspaces récents, ↑↓ navigation, Enter ouvre
 *  - `vs` (VS) : liste des solutions scannées, ↑↓ navigation, Enter ouvre
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchResult } from '../../../shared/types';
import { detectMode, MODE_META } from './detectMode';
import { evaluateCalc } from '../../../shared/calc';
import {
  ddgBangUrl,
  matchQuicklinks,
  resolveQuicklink,
  splitBangInput,
} from '../../../shared/quicklinks';
import { matchSnippets, resolveSnippet } from '../../../shared/snippets';
import { SearchResultsPanel } from './SearchResultsPanel';
import { BangResultsPanel, type BangItem } from './BangResultsPanel';
import { SnippetResultsPanel } from './SnippetResultsPanel';
import { useTasksContext } from '../tasks/TasksContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { useToast } from '../toast/ToastContext';

interface Props {
  query: string;
  setQuery: (q: string) => void;
  /** Demande au shell de rétracter le notch après une action réussie. */
  onAfterAction?: () => void;
  /** Indique si la SettingsView est actuellement ouverte (gear actif). */
  settingsOpen?: boolean;
  /** Appelé quand l'utilisateur clique sur le bouton gear. */
  onGearClick?: () => void;
  /** Indique si le panel Clipboard est actuellement ouvert (bouton actif). */
  clipboardOpen?: boolean;
  /**
   * Appelé quand l'utilisateur clique sur le bouton clipboard. Si
   * `undefined`, le bouton n'est pas rendu (utile quand le module
   * Clipboard est désactivé dans Settings).
   */
  onClipboardClick?: () => void;
}

export function NotchSearch({
  query,
  setQuery,
  onAfterAction,
  settingsOpen,
  onGearClick,
  clipboardOpen,
  onClipboardClick,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { add: addTask } = useTasksContext();
  const { settings } = useSettingsContext();
  const { push: pushToast } = useToast();

  // Résultats bruts chargés via IPC selon le mode actif.
  const [items, setItems] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selIdx, setSelIdx] = useState(0);

  // Autofocus au mount (l'utilisateur vient de cliquer sur le notch pour
  // l'étendre — il s'attend à pouvoir taper immédiatement).
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  const detected = detectMode(query);
  const meta = detected ? MODE_META[detected.mode] : null;
  const mode = detected?.mode ?? null;
  const payload = detected?.payload ?? '';

  // Chargement asynchrone des résultats pour les modes qui en exposent.
  // Le mode est l'unique dépendance : tant qu'on reste dans le même mode,
  // on garde les `items` chargés (le filtre se fait localement sur `payload`).
  useEffect(() => {
    let alive = true;
    if (mode === 'vscode') {
      setLoading(true);
      window.notch.search.listVsCode().then((res) => {
        if (alive) {
          setItems(res);
          setLoading(false);
        }
      });
    } else if (mode === 'visualstudio') {
      setLoading(true);
      window.notch.search.listVs().then((res) => {
        if (alive) {
          setItems(res);
          setLoading(false);
        }
      });
    } else {
      setItems([]);
      setLoading(false);
    }
    return () => {
      alive = false;
    };
  }, [mode]);

  // Filtre local sur le payload. Match name OU path (l'utilisateur peut
  // taper un fragment de répertoire pour cibler un workspace).
  const filteredItems = useMemo(() => {
    if (!payload) return items;
    const q = payload.toLowerCase();
    return items.filter(
      (it) => it.name.toLowerCase().includes(q) || it.path.toLowerCase().includes(q),
    );
  }, [items, payload]);

  // Items du mode `!` (quicklinks résolus + repli DuckDuckGo). Calculés
  // localement depuis la config — aucun IPC.
  const bangItems = useMemo<BangItem[]>(() => {
    if (mode !== 'bang') return [];
    const { alias, query: q } = splitBangInput(payload);
    const hostOf = (url: string): string => {
      try {
        return new URL(url).host;
      } catch {
        return url;
      }
    };
    const items: BangItem[] = matchQuicklinks(settings.quicklinks, alias).map((ql) => {
      const url = resolveQuicklink(ql.url, q);
      return {
        alias: ql.alias,
        label: ql.label ?? ql.alias,
        host: hostOf(url),
        query: q,
        url,
      };
    });
    // Repli DuckDuckGo : alias tapé sans correspondance exacte locale.
    const exact = settings.quicklinks.some(
      (ql) => ql.alias.toLowerCase() === alias.toLowerCase(),
    );
    if (alias && !exact) {
      items.push({
        alias,
        label: `!${alias} via DuckDuckGo`,
        host: 'duckduckgo.com',
        query: q,
        url: ddgBangUrl(alias, q),
        ddg: true,
      });
    }
    return items;
  }, [mode, payload, settings.quicklinks]);

  // Snippets filtrés (mode `:`). Le body brut sert d'aperçu ; la résolution
  // des placeholders + la copie se font à la sélection.
  const snippetItems = useMemo(
    () => (mode === 'snippet' ? matchSnippets(settings.snippets, payload) : []),
    [mode, payload, settings.snippets],
  );

  // Reset de la sélection à chaque changement de query — sinon on
  // conserverait un index hors-bornes.
  useEffect(() => {
    setSelIdx(0);
  }, [query]);

  const showResultsPanel = mode === 'vscode' || mode === 'visualstudio';

  /**
   * Résout les placeholders d'un snippet (`{clipboard}` lu en direct,
   * `{date}`/`{uuid}`…) puis copie le résultat. La valeur résolue n'est
   * jamais affichée — seul un toast de confirmation est émis.
   */
  const copySnippet = async (snippet: { name: string; body: string }) => {
    let clip = '';
    try {
      clip = await navigator.clipboard.readText();
    } catch {
      clip = '';
    }
    const resolved = resolveSnippet(snippet.body, { clipboard: clip, date: new Date() });
    const ok = await navigator.clipboard
      .writeText(resolved)
      .then(() => true)
      .catch(() => false);
    pushToast({
      icon: ok ? 'fa-solid fa-paste' : 'fa-solid fa-triangle-exclamation',
      iconColor: ok ? '#34d399' : '#ef4444',
      name: 'Snippet',
      message: ok ? `« ${snippet.name} » copié` : 'Échec de la copie',
    });
    if (ok) {
      setQuery('');
      onAfterAction?.();
    }
  };

  /** Ouvre l'item sélectionné via le bon backend (VS Code ou VS). */
  const openItem = async (item: SearchResult) => {
    if (item.kind === 'vs-solution') {
      const res = await window.notch.search.openVs(item.path);
      if (res.ok) {
        pushToast({
          icon: 'fa-solid fa-cube',
          iconColor: '#a16ce8',
          name: item.name,
          message: 'Solution ouverte dans Visual Studio',
        });
      } else {
        pushToast({
          icon: 'fa-solid fa-triangle-exclamation',
          iconColor: '#ef4444',
          name: 'Visual Studio',
          message: res.error ?? 'Échec de l\'ouverture',
        });
      }
    } else {
      const res = await window.notch.search.openVsCode(item.path, item.kind);
      if (res.ok) {
        pushToast({
          icon: 'fa-solid fa-code',
          iconColor: '#3b9eff',
          name: item.name,
          message: 'Workspace ouvert dans VS Code',
        });
      } else {
        pushToast({
          icon: 'fa-solid fa-triangle-exclamation',
          iconColor: '#ef4444',
          name: 'VS Code',
          message: res.error ?? 'Échec de l\'ouverture',
        });
      }
    }
    setQuery('');
    onAfterAction?.();
  };

  const handleEnter = async () => {
    if (!detected) return;

    switch (detected.mode) {
      case 'task': {
        if (!payload) return;
        await addTask(payload);
        pushToast({
          icon: 'fa-solid fa-circle-plus',
          iconColor: 'var(--accent-green)',
          name: 'Tâche',
          message: payload.length > 60 ? payload.slice(0, 57) + '…' : payload,
        });
        // Garde le préfixe `-` pour enchaîner les ajouts.
        setQuery('-');
        return;
      }
      case 'claude': {
        if (!payload) return;
        const res = await window.notch.shell.launchClaude(payload);
        if (res.ok) {
          pushToast({
            icon: 'fa-solid fa-sparkles',
            iconColor: 'var(--accent-violet)',
            name: 'Claude',
            message: 'Session lancée dans un nouveau terminal',
          });
          setQuery('');
          onAfterAction?.();
        } else {
          pushToast({
            icon: 'fa-solid fa-triangle-exclamation',
            iconColor: '#ef4444',
            name: 'Claude',
            message: res.error ?? 'Échec du lancement',
          });
        }
        return;
      }
      case 'vscode':
      case 'visualstudio': {
        const item = filteredItems[selIdx];
        if (!item) return;
        await openItem(item);
        return;
      }
      case 'calc': {
        // Entrée copie le résultat (sans fermer : l'utilisateur peut
        // enchaîner / ajuster son calcul).
        const res = evaluateCalc(payload);
        if (!res || !res.ok || !res.copyText) return;
        const ok = await navigator.clipboard
          .writeText(res.copyText)
          .then(() => true)
          .catch(() => false);
        pushToast({
          icon: ok ? 'fa-solid fa-check' : 'fa-solid fa-triangle-exclamation',
          iconColor: ok ? '#34d399' : '#ef4444',
          name: 'Calc',
          message: ok ? `${res.result} copié` : 'Échec de la copie',
        });
        return;
      }
      case 'snippet': {
        const item = snippetItems[selIdx];
        if (!item) return;
        await copySnippet(item);
        return;
      }
      case 'bang': {
        const item = bangItems[selIdx];
        if (!item) return;
        const res = await window.notch.shell.openExternal(item.url);
        if (res.ok) {
          pushToast({
            icon: 'fa-solid fa-bolt',
            iconColor: '#22d3ee',
            name: 'Bang',
            message: `Ouvert · ${item.label}`,
          });
          setQuery('');
          onAfterAction?.();
        } else {
          pushToast({
            icon: 'fa-solid fa-triangle-exclamation',
            iconColor: '#ef4444',
            name: 'Bang',
            message: res.error ?? "Échec de l'ouverture",
          });
        }
        return;
      }
      case 'url': {
        const url = detected.detection?.text;
        if (!url) return;
        const res = await window.notch.shell.openExternal(url);
        if (res.ok) {
          pushToast({
            icon: 'fa-solid fa-arrow-up-right-from-square',
            iconColor: '#60a5fa',
            name: 'URL',
            message: 'Ouverte dans le navigateur',
          });
          setQuery('');
          onAfterAction?.();
        } else {
          pushToast({
            icon: 'fa-solid fa-triangle-exclamation',
            iconColor: '#ef4444',
            name: 'URL',
            message: res.error ?? "Échec de l'ouverture",
          });
        }
        return;
      }
      case 'path': {
        const path = detected.detection?.text;
        if (!path) return;
        const res = await window.notch.shell.openPath(path);
        if (res.ok) {
          pushToast({
            icon: 'fa-regular fa-folder-open',
            iconColor: '#34d399',
            name: 'Explorer',
            message: 'Ouvert',
          });
          setQuery('');
          onAfterAction?.();
        } else {
          pushToast({
            icon: 'fa-solid fa-triangle-exclamation',
            iconColor: '#ef4444',
            name: 'Explorer',
            message: res.error ?? "Échec de l'ouverture",
          });
        }
        return;
      }
    }
  };

  /** Navigation clavier ↑↓ dans le panel de résultats (vscode/vs ou bang). */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleEnter();
      return;
    }
    const navLen =
      mode === 'bang'
        ? bangItems.length
        : mode === 'snippet'
          ? snippetItems.length
          : showResultsPanel
            ? filteredItems.length
            : 0;
    if (navLen === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelIdx((i) => Math.min(navLen - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelIdx((i) => Math.max(0, i - 1));
    }
  };

  return (
    <>
      <div className="search-bar" data-mode={mode ?? 'none'}>
        {/* Icône loupe toujours visible à gauche — repère universel
            "champ de recherche" même quand aucune chip de mode n'est rendue. */}
        <i className="fa-solid fa-magnifying-glass search-icon" aria-hidden="true" />
        {meta && (
          <span className="search-chip" style={{ background: meta.color + '22', color: meta.color }}>
            <i className={meta.icon} />
            {meta.label}
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={meta?.placeholder ?? 'Rechercher · "?" pour l\'aide · "-", "=", "!", ";", ":", ">", "/", "vs"…'}
          spellCheck={false}
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            className="search-clear"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            aria-label="Effacer"
            title="Effacer"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        )}
        {onClipboardClick && (
          <button
            type="button"
            className={
              'search-clipboard' + (clipboardOpen ? ' is-active' : '')
            }
            onClick={() => onClipboardClick()}
            aria-label="Presse-papier"
            aria-pressed={!!clipboardOpen}
            title="Presse-papier (Ctrl+Alt+V)"
          >
            <i className="fa-solid fa-clipboard" />
          </button>
        )}
        <button
          type="button"
          className={'search-gear' + (settingsOpen ? ' is-active' : '')}
          onClick={() => onGearClick?.()}
          aria-label="Réglages"
          aria-pressed={!!settingsOpen}
        >
          <i className="fa-solid fa-gear" />
        </button>
      </div>

      {showResultsPanel && (
        <SearchResultsPanel
          items={filteredItems}
          selIdx={selIdx}
          loading={loading}
          onSelect={(idx) => setSelIdx(idx)}
          onPick={(idx) => {
            const item = filteredItems[idx];
            if (item) void openItem(item);
          }}
        />
      )}

      {mode === 'snippet' && (
        <SnippetResultsPanel
          items={snippetItems}
          selIdx={selIdx}
          onSelect={(idx) => setSelIdx(idx)}
          onPick={(idx) => {
            const item = snippetItems[idx];
            if (item) void copySnippet(item);
          }}
        />
      )}

      {mode === 'bang' && (
        <BangResultsPanel
          items={bangItems}
          selIdx={selIdx}
          onSelect={(idx) => setSelIdx(idx)}
          onPick={(idx) => {
            const item = bangItems[idx];
            if (!item) return;
            void window.notch.shell.openExternal(item.url).then((res) => {
              if (res.ok) {
                pushToast({
                  icon: 'fa-solid fa-bolt',
                  iconColor: '#22d3ee',
                  name: 'Bang',
                  message: `Ouvert · ${item.label}`,
                });
                setQuery('');
                onAfterAction?.();
              } else {
                pushToast({
                  icon: 'fa-solid fa-triangle-exclamation',
                  iconColor: '#ef4444',
                  name: 'Bang',
                  message: res.error ?? "Échec de l'ouverture",
                });
              }
            });
          }}
        />
      )}
    </>
  );
}
