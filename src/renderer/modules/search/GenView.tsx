/**
 * Vue plein dashboard du mode `;` (Générateur d'utilitaires dev).
 *
 * Auto-suffisante (comme `CalcView`) : parse la commande depuis `expr`,
 * exécute les transformations SYNCHRONES en local (`shared/devtools.ts`),
 * et délègue les **hash** au main via `search:transform` (crypto Node).
 * Chaque sortie a un bouton Copier. `uuid` propose un bouton Régénérer.
 *
 * Réutilise la coque `cb-det-*` + les styles `calc-*` (search.css) pour
 * rester visuellement cohérent avec les autres vues de la search bar.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  GEN_COMMANDS,
  hashOpFor,
  parseGenInput,
  runSyncTool,
  type GenRow,
} from '../../../shared/devtools';
import { useToast } from '../toast/ToastContext';

const ICON_COLOR = '#a78bfa';

export function GenView({ expr }: { expr: string }) {
  const { push } = useToast();
  // Nonce de régénération (uuid) : bumper force un recalcul du useMemo.
  const [nonce, setNonce] = useState(0);

  const { cmd, input } = useMemo(() => parseGenInput(expr), [expr]);
  const hashOp = hashOpFor(cmd);

  // Résultat synchrone (tout sauf hash). `nonce` rejoue uuid.
  const sync = useMemo(
    () => (hashOp ? null : runSyncTool(cmd, input)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cmd, input, hashOp, nonce],
  );

  // Résultat hash (async, via IPC).
  const [hash, setHash] = useState<{ loading: boolean; value?: string; error?: string }>({
    loading: false,
  });
  useEffect(() => {
    if (!hashOp) return;
    if (!input) {
      setHash({ loading: false, error: 'Saisis un texte à hasher' });
      return;
    }
    let alive = true;
    setHash({ loading: true });
    void window.notch.search.transform(hashOp, input).then((res) => {
      if (!alive) return;
      setHash(
        res.ok && res.output
          ? { loading: false, value: res.output }
          : { loading: false, error: res.error ?? 'Échec du hash' },
      );
    });
    return () => {
      alive = false;
    };
  }, [hashOp, input]);

  const copyToast = (text: string, label: string) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => false)
      .then((ok) =>
        push({
          icon: ok ? 'fa-solid fa-check' : 'fa-solid fa-triangle-exclamation',
          iconColor: ok ? '#34d399' : '#ef4444',
          name: 'Outils',
          message: ok ? `${label} copié` : 'Échec de la copie',
        }),
      );

  // Aide : commande absente / inconnue.
  if (!cmd || (!hashOp && sync === null)) {
    return (
      <div className="cb-det-view">
        <div className="calc-hint">
          <i className="fa-solid fa-wand-magic-sparkles" style={{ color: ICON_COLOR }} />
          <div>
            <div className="calc-hint-title">Utilitaires dev</div>
            <div className="calc-hint-sub gen-help-list">
              {GEN_COMMANDS.map((c) => (
                <span key={c.name}>
                  <code>{c.example}</code> — {c.desc}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Détermine les lignes + l'état d'erreur selon sync vs hash.
  let rows: GenRow[] = [];
  let error: string | undefined;
  let loading = false;
  if (hashOp) {
    loading = hash.loading;
    error = hash.error;
    if (hash.value) rows = [{ label: hashOp.toUpperCase(), value: hash.value }];
  } else if (sync) {
    rows = sync.rows;
    error = sync.error;
  }

  return (
    <div className="cb-det-view">
      <div className="cb-det-head">
        <i
          className="fa-solid fa-wand-magic-sparkles cb-det-icon"
          data-color={ICON_COLOR}
        />
        <div className="cb-det-head-text">
          <div className="cb-det-title">{cmd}</div>
          <div className="cb-det-sub cb-det-sub-mono">
            {loading ? 'calcul…' : input || (cmd === 'uuid' ? 'généré' : '—')}
          </div>
        </div>
        {cmd === 'uuid' && (
          <button
            type="button"
            className="cb-det-btn"
            onClick={() => setNonce((n) => n + 1)}
            title="Régénérer"
          >
            <i className="fa-solid fa-rotate" />
          </button>
        )}
      </div>

      {error ? (
        <div className="calc-error">{error}</div>
      ) : (
        rows.length > 0 && (
          <div className="cb-det-color-grid">
            {rows.map((r) => (
              <div className="cb-det-copy-row" key={r.label}>
                <span className="cb-det-copy-label">{r.label}</span>
                <span className="cb-det-copy-value">{r.value}</span>
                <button
                  type="button"
                  className="cb-det-btn"
                  onClick={() => copyToast(r.value, r.label)}
                  title={`Copier ${r.label}`}
                >
                  <i className="fa-regular fa-copy" />
                </button>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
