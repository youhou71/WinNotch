/**
 * Émet un toast à chaque transition connexion / déconnexion VPN.
 *
 * Diff par `interfaceName` : on compare l'ensemble des interfaces actives
 * au tick précédent vs maintenant. Le premier batch après boot sert de
 * baseline silencieuse (sinon on toast au démarrage pour une connexion
 * qui tournait déjà).
 *
 * Respecte le mode DND via `useToast().push(...)` qui filtre lui-même
 * les toasts non-systemException.
 */
import { useEffect, useRef } from 'react';
import { useVpnContext } from './VpnContext';
import { useSettingsContext } from '../settings/SettingsContext';
import { useToast } from '../toast/ToastContext';
import { clientLabel } from './vpnLabels';

export function useVpnToasts(): void {
  const { state } = useVpnContext();
  const { settings } = useSettingsContext();
  const { push } = useToast();

  const prev = useRef<Set<string> | null>(null);
  const lastClientByIface = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!settings.modules.vpn) {
      prev.current = null;
      lastClientByIface.current.clear();
      return;
    }

    const currentKeys = new Set(state.connections.map((c) => c.interfaceName));
    // Mémorise le client par interface pour pouvoir nommer la disparition.
    const nextLabels = new Map<string, string>();
    for (const c of state.connections) {
      nextLabels.set(c.interfaceName, clientLabel(c.client));
    }

    if (prev.current === null) {
      // Baseline silencieuse au boot — pas de toast pour les sessions
      // déjà actives au démarrage de WinNotch.
      prev.current = currentKeys;
      lastClientByIface.current = nextLabels;
      return;
    }

    const before = prev.current;
    const added = [...currentKeys].filter((k) => !before.has(k));
    const removed = [...before].filter((k) => !currentKeys.has(k));

    for (const key of added) {
      const label = nextLabels.get(key) ?? 'VPN';
      push({
        icon: 'fa-solid fa-shield-halved',
        iconColor: '#06b6d4',
        name: 'VPN',
        message: `${label} connecté`,
      });
    }
    for (const key of removed) {
      const label = lastClientByIface.current.get(key) ?? 'VPN';
      push({
        icon: 'fa-solid fa-shield-halved',
        iconColor: '#94a3b8',
        name: 'VPN',
        message: `${label} déconnecté`,
      });
    }

    prev.current = currentKeys;
    lastClientByIface.current = nextLabels;
  }, [state.connections, settings.modules.vpn, push]);
}
