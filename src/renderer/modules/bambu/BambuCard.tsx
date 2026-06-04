/**
 * Card Bambu du dashboard étendu (lecture seule).
 *
 * Sections (conditionnelles selon l'état) :
 *  - header : icône + nom imprimante + pastille état connexion
 *  - onboarding si non configuré (renvoie vers les réglages)
 *  - bannière si connecté mais pas en print / hors-ligne / erreur
 *  - progression : barre % + ETA + layer X/Y + fichier
 *  - températures buse / lit
 *  - AMS : bobines (couleur + type + % restant)
 *  - HMS : erreurs actives en rouge + lien wiki
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useBambuContext } from './BambuContext';
import {
  BAMBU_ACCENT,
  connectionLabel,
  formatEta,
  formatTemp,
  gcodeLabel,
  speedLabel,
} from './bambuLabels';

export function BambuCard() {
  const { state } = useBambuContext();
  // Tick pour rafraîchir l'affichage « il y a … » si besoin (léger).
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(h);
  }, []);

  const hasError = state.hms.length > 0 || state.connection === 'error';
  const accentColor = hasError ? '#ef4444' : BAMBU_ACCENT;
  const accent: CSSProperties = {
    '--bambu-color': accentColor,
  } as CSSProperties;

  // Non configuré : invite à renseigner les identifiants dans les réglages.
  if (!state.configured) {
    return (
      <div className="bambu-card" data-notch-hit="true" style={accent}>
        <div className="bambu-head">
          <i className="fa-solid fa-print bambu-head-icon" />
          <span className="bambu-label">imprimante 3d</span>
        </div>
        <div className="bambu-banner">
          Configure l'IP, le numéro de série et le code d'accès LAN de ton
          imprimante Bambu dans les réglages du module.
        </div>
      </div>
    );
  }

  const spd = speedLabel(state.speedLevel);

  // En cloud, `connection === 'connected'` = broker cloud joignable, pas
  // l'imprimante. On reflète l'état réel de l'imprimante via `printerOnline`.
  const connected = state.connection === 'connected';
  const online = connected && state.printerOnline;
  const statusLabel = connected
    ? state.printerOnline
      ? 'en ligne'
      : 'hors ligne'
    : connectionLabel(state.connection);
  const statusKind = connected
    ? state.printerOnline
      ? 'connected'
      : 'offline'
    : state.connection;

  return (
    <div className="bambu-card" data-notch-hit="true" style={accent}>
      <div className="bambu-head">
        <i className="fa-solid fa-print bambu-head-icon" />
        <span className="bambu-label">
          {state.printerName || 'imprimante'}
        </span>
        <span
          className={`bambu-conn bambu-conn-${statusKind}`}
          title={state.error ?? undefined}
        >
          {statusLabel}
        </span>
      </div>

      {!connected ? (
        <div className="bambu-status-line">
          {connectionLabel(state.connection)}
          {state.error ? ` · ${state.error}` : ''}
        </div>
      ) : !online ? (
        <div className="bambu-status-line">
          Imprimante hors ligne ou en veille.
        </div>
      ) : (
        <>
          {/* Progression — affichée dès qu'un print est actif. */}
          {state.isPrinting ? (
            <div className="bambu-progress">
              <div className="bambu-progress-bar">
                <span
                  className="bambu-progress-fill"
                  style={{ width: `${state.progressPercent}%` }}
                />
              </div>
              <div className="bambu-progress-meta">
                <span className="bambu-progress-pct">
                  {state.progressPercent}%
                </span>
                <span className="bambu-progress-eta">
                  {formatEta(state.remainingMin)} restant
                </span>
                {state.layerCur !== null && state.layerTotal !== null && (
                  <span className="bambu-progress-layer">
                    couche {state.layerCur}/{state.layerTotal}
                  </span>
                )}
              </div>
              {state.fileName && (
                <div className="bambu-file" title={state.fileName}>
                  {state.fileName}
                </div>
              )}
            </div>
          ) : (
            <div className="bambu-status-line">
              {gcodeLabel(state.gcodeState)}
            </div>
          )}

          {/* Températures. */}
          {(state.nozzleTemp !== null || state.bedTemp !== null) && (
            <div className="bambu-temps">
              <div className="bambu-temp">
                <i className="fa-solid fa-temperature-half" />
                <span className="bambu-temp-label">buse</span>
                <span className="bambu-temp-val">
                  {formatTemp(state.nozzleTemp, state.nozzleTarget)}
                </span>
              </div>
              <div className="bambu-temp">
                <i className="fa-solid fa-layer-group" />
                <span className="bambu-temp-label">lit</span>
                <span className="bambu-temp-val">
                  {formatTemp(state.bedTemp, state.bedTarget)}
                </span>
              </div>
              {spd && (
                <div className="bambu-temp">
                  <i className="fa-solid fa-gauge-high" />
                  <span className="bambu-temp-label">vitesse</span>
                  <span className="bambu-temp-val">{spd}</span>
                </div>
              )}
            </div>
          )}

          {/* AMS. */}
          {state.amsTrays.length > 0 && (
            <div className="bambu-ams">
              {state.amsTrays.map((t) => (
                <div
                  key={t.slot}
                  className={`bambu-tray${t.active ? ' is-active' : ''}`}
                >
                  <span
                    className="bambu-tray-swatch"
                    style={{ background: t.colorHex || '#555' }}
                  />
                  <span className="bambu-tray-type">{t.type || '—'}</span>
                  <span className="bambu-tray-remain">
                    {t.remainPercent === null ? '?' : `${t.remainPercent}%`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* HMS — erreurs actives. */}
          {state.hms.length > 0 && (
            <ul className="bambu-hms">
              {state.hms.map((h) => (
                <li
                  key={h.code}
                  className={`bambu-hms-item bambu-hms-${h.level}`}
                >
                  <i className="fa-solid fa-triangle-exclamation" />
                  <span className="bambu-hms-code">{h.code}</span>
                  <button
                    type="button"
                    className="bambu-hms-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      void window.notch.shell.openExternal(h.wikiUrl);
                    }}
                  >
                    doc
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
