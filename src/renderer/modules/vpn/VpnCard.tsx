/**
 * Card VPN du dashboard étendu.
 *
 * Format compact : header avec icône bouclier + label module, pill colorée
 * pour l'état (Connecté / Déconnecté), puis le détail de la première
 * connexion (client + nom + pays + durée). Si plusieurs connexions sont
 * actives, les suivantes sont empilées en sub-lines.
 *
 * Read-only — aucun bouton d'action. La card n'ouvre pas de panel
 * dédié (l'info utile tient dans la tuile elle-même).
 */
import { useEffect, useState } from 'react';
import { useVpnContext } from './VpnContext';
import { buildSubtitle, clientLabel } from './vpnLabels';

export function VpnCard() {
  const { state } = useVpnContext();
  const [now, setNow] = useState(Date.now());

  // Tick 30 s pour rafraîchir la durée affichée — pas la peine d'aller
  // plus vite, on parle de durées en minutes/heures.
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(handle);
  }, []);

  return (
    <div className="vpn-card" data-notch-hit="true">
      <div className="vpn-head">
        <i className="fa-solid fa-shield-halved" />
        <span className="vpn-label">vpn</span>
        {state.lastError && (
          <span
            className="vpn-error-dot"
            title={state.lastError}
            aria-label={`Erreur : ${state.lastError}`}
          />
        )}
      </div>

      {state.connected ? (
        <>
          <div className="vpn-pill vpn-pill-connected">Connecté</div>
          <ul className="vpn-conn-list">
            {state.connections.map((c) => {
              const subtitle = buildSubtitle(c, now);
              return (
                <li key={c.interfaceName} className="vpn-conn">
                  <span className="vpn-conn-client">{clientLabel(c.client)}</span>
                  {subtitle && (
                    <span className="vpn-conn-sub">{subtitle}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          <div className="vpn-pill vpn-pill-disconnected">Déconnecté</div>
          <div className="vpn-empty">Aucune session VPN active</div>
        </>
      )}
    </div>
  );
}
