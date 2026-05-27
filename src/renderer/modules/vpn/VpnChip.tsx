/**
 * Chip VPN dans la collapsed row.
 *
 * Format compact : icône bouclier cyan quand connecté, gris si
 * `showWhenDisconnected` est activé. Tooltip rich au survol détaille
 * le ou les clients actifs (cf. `<NotchTooltip>`).
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useVpnContext } from './VpnContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { NotchTooltip } from '../../components/Tooltip/NotchTooltip';
import { clientLabel, formatDuration } from './vpnLabels';

const VPN_ACCENT: CSSProperties = {
  '--tt-accent': '#06b6d4',
  '--tt-accent-fade': 'rgba(6, 182, 212, 0.18)',
} as CSSProperties;

export function VpnChip() {
  const { state } = useVpnContext();
  const { settings } = useSettingsContext();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(handle);
  }, []);

  const cfg = settings.moduleConfig.vpn;

  if (!state.connected) {
    if (!cfg.showWhenDisconnected) return null;
    return (
      <NotchTooltip
        accentStyle={VPN_ACCENT}
        content={
          <div className="tt-body">
            <div className="tt-head">
              <i className="fa-solid fa-shield-halved" />
              <span>vpn — déconnecté</span>
            </div>
            <div className="tt-empty">Aucune session VPN active.</div>
          </div>
        }
      >
        <div className="chip chip-vpn chip-vpn-off">
          <i className="fa-solid fa-shield-halved vpn-glyph" />
        </div>
      </NotchTooltip>
    );
  }

  return (
    <NotchTooltip
      accentStyle={VPN_ACCENT}
      content={
        <div className="tt-body">
          <div className="tt-head">
            <i className="fa-solid fa-shield-halved" />
            <span>vpn — connecté</span>
            {state.connections.length > 1 && (
              <span className="tt-head-count">{state.connections.length}</span>
            )}
          </div>
          <ul className="tt-list">
            {state.connections.map((c) => {
              const duration = formatDuration(c, now);
              return (
                <li key={c.interfaceName} className="tt-row">
                  <span className="tt-title">{clientLabel(c.client)}</span>
                  {c.connectionName && (
                    <span className="tt-sub">{c.connectionName}</span>
                  )}
                  {(c.country || duration || c.serverAddress) && (
                    <div className="tt-meta">
                      {c.country && (
                        <span className="tt-meta-pill">
                          <i className="fa-solid fa-location-dot" />
                          {c.country}
                        </span>
                      )}
                      {duration && (
                        <span className="tt-meta-pill">
                          <i className="fa-regular fa-clock" />
                          {duration}
                        </span>
                      )}
                      {c.serverAddress && (
                        <span className="tt-meta-pill tt-meta-pill-dim">
                          {c.serverAddress}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      }
    >
      <div className="chip chip-vpn chip-vpn-on">
        <i className="fa-solid fa-shield-halved vpn-glyph" />
        {state.connections.length > 1 && (
          <span className="count-badge vpn-badge">{state.connections.length}</span>
        )}
      </div>
    </NotchTooltip>
  );
}
