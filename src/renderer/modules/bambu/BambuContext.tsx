/**
 * Context partagé pour le module Bambu.
 *
 * Une seule subscription IPC (`bambu:change`) pour tous les consommateurs
 * (chip + card). Le main pousse un `BambuState` complet à chaque rapport MQTT
 * et à chaque changement d'état de connexion.
 *
 * Les actions de configuration (saveCredentials / testConnection / disconnect)
 * ne passent pas par ce context : la page de réglages appelle directement
 * `window.notch.bambu.*` (même approche que GitLabSettings).
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { BambuState } from '../../../shared/types';

interface BambuContextValue {
  state: BambuState;
}

const EMPTY_STATE: BambuState = {
  connection: 'idle',
  error: null,
  configured: false,
  printerOnline: false,
  printerName: '',
  gcodeState: 'Unknown',
  isPrinting: false,
  progressPercent: 0,
  remainingMin: null,
  layerCur: null,
  layerTotal: null,
  fileName: '',
  speedLevel: null,
  nozzleTemp: null,
  nozzleTarget: null,
  bedTemp: null,
  bedTarget: null,
  amsTrays: [],
  hms: [],
  lastUpdateAt: 0,
};

const BambuContext = createContext<BambuContextValue | null>(null);

export function BambuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BambuState>(EMPTY_STATE);

  useEffect(() => {
    let alive = true;
    void window.notch.bambu.getState().then((s) => {
      if (alive) setState(s);
    });
    const off = window.notch.bambu.onChange((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  return (
    <BambuContext.Provider value={{ state }}>{children}</BambuContext.Provider>
  );
}

export function useBambuContext(): BambuContextValue {
  const ctx = useContext(BambuContext);
  if (!ctx) {
    throw new Error(
      "useBambuContext doit être appelé à l'intérieur de <BambuProvider>",
    );
  }
  return ctx;
}
