/**
 * Vue plein dashboard du mode `=` (Calc & Convert).
 *
 * Évalue l'expression en local (moteur pur `shared/calc.ts`) et affiche :
 *  - le résultat mis en avant + l'écho de la saisie
 *  - d'éventuelles lignes secondaires copiables (autres bases, date
 *    locale/UTC, ms…)
 *  - un bouton Copier (Entrée copie aussi, géré dans NotchSearch)
 *
 * Cohabite avec les autres modes search selon le même contrat de mutex
 * imposé par ExpandedDashboard. Aucune logique de calcul ici : tout est
 * dans `shared/calc.ts` (testable, réutilisable).
 */
import { useMemo } from 'react';
import { evaluateCalc } from '../../../shared/calc';
import { useToast } from '../toast/ToastContext';

const ICON_COLOR = '#fbbf24';

export function CalcView({ expr }: { expr: string }) {
  const res = useMemo(() => evaluateCalc(expr), [expr]);
  const { push } = useToast();

  const copyToast = (text: string, label: string) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => false)
      .then((ok) =>
        push({
          icon: ok ? 'fa-solid fa-check' : 'fa-solid fa-triangle-exclamation',
          iconColor: ok ? '#34d399' : '#ef4444',
          name: 'Calc',
          message: ok ? `${label} copié` : 'Échec de la copie',
        }),
      );

  // Saisie vide : on guide l'utilisateur plutôt que d'afficher un vide.
  if (!res) {
    return (
      <div className="cb-det-view">
        <div className="calc-hint">
          <i className="fa-solid fa-calculator" style={{ color: ICON_COLOR }} />
          <div>
            <div className="calc-hint-title">Calcul & conversion</div>
            <div className="calc-hint-sub">
              <code>(1920/3)*2</code> · <code>2**16</code> ·{' '}
              <code>20px to rem</code> · <code>1.5MB to KB</code> ·{' '}
              <code>0xFF to dec</code> · <code>1700000000 to date</code>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!res.ok) {
    return (
      <div className="cb-det-view">
        <div className="cb-det-head">
          <i
            className="fa-solid fa-calculator cb-det-icon"
            data-color={ICON_COLOR}
          />
          <div className="cb-det-head-text">
            <div className="calc-error">{res.error}</div>
            <div className="cb-det-sub cb-det-sub-mono">{res.echo}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cb-det-view">
      <div className="cb-det-head">
        <i
          className="fa-solid fa-calculator cb-det-icon"
          data-color={ICON_COLOR}
        />
        <div className="cb-det-head-text">
          <div className="calc-result">{res.result}</div>
          <div className="cb-det-sub cb-det-sub-mono">{res.echo}</div>
        </div>
      </div>

      {res.lines.length > 0 && (
        <div className="cb-det-color-grid">
          {res.lines.map((l) => (
            <div className="cb-det-copy-row" key={l.label}>
              <span className="cb-det-copy-label">{l.label}</span>
              <span className="cb-det-copy-value">{l.value}</span>
              <button
                type="button"
                className="cb-det-btn"
                onClick={() => copyToast(l.value, l.label)}
                title={`Copier ${l.label}`}
              >
                <i className="fa-regular fa-copy" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="cb-det-actions">
        <button
          type="button"
          className="cb-det-btn is-primary"
          onClick={() => copyToast(res.copyText, 'Résultat')}
        >
          <i className="fa-regular fa-copy" />
          Copier le résultat
        </button>
      </div>
    </div>
  );
}
