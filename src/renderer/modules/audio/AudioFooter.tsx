/**
 * Footer audio du dashboard étendu.
 *
 * Reproduit fidèlement le pattern `notch-modules.jsx > AudioCard` du
 * prototype (lignes 609-682) :
 *  - bouton device avec chevron qui ouvre un popover VERS LE HAUT
 *  - bouton mute
 *  - slider plein cliquable + draggable
 *  - pourcentage tabular-nums à droite
 *  - dropdown des sorties disponibles ancré au bottom du footer
 *
 * Le composant lit l'état audio depuis `<AudioProvider>` (subscription IPC
 * unique). Aucune logique audio n'est dans le renderer.
 */
import { useEffect, useRef, useState } from 'react';
import { useAudioContext } from './AudioContext';
import {
  currentDevice,
  deviceIcon,
  deviceMetaFull,
} from './deviceMeta';

export function AudioFooter() {
  const { state, setVolume, toggleMute, selectDevice } = useAudioContext();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Drapeau partagé entre handlers : true tant qu'on drag le slider, pour
  // que les mousemove globaux sachent qu'ils doivent ajuster le volume.
  const draggingRef = useRef(false);

  // Fermeture du dropdown au clic extérieur. Pas d'écoute permanente :
  // on n'attache le handler que pendant l'état ouvert pour économiser.
  useEffect(() => {
    if (!dropdownOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [dropdownOpen]);

  // Choix du device "courant" pour l'affichage : on prend la valeur
  // optimiste de l'utilisateur (currentDeviceId) avant de retomber sur
  // le default réel ou la première entrée disponible. Règle partagée avec
  // la chip du notch rétracté (cf. `deviceMeta.ts`).
  const device = currentDevice(state.devices, state.currentDeviceId);

  const level = state.level;
  // L'icône de mute reflète soit le flag muted, soit un volume à 0 :
  // pour l'utilisateur les deux situations sont équivalentes ("pas de son").
  const muted = state.muted || level === 0;
  const icon = muted ? 'fa-volume-xmark' : level < 50 ? 'fa-volume-low' : 'fa-volume-high';

  /** Convertit la position X du clic en pourcentage de volume [0..100]. */
  const sliderFromEvent = (e: MouseEvent | React.MouseEvent) => {
    const target = e.currentTarget as HTMLElement | null;
    const slider = target?.classList.contains('af-slider')
      ? target
      : (target?.querySelector('.af-slider') as HTMLElement | null) ??
        (e.target as HTMLElement | null)?.closest('.af-slider') as HTMLElement | null;
    if (!slider) return null;
    const rect = slider.getBoundingClientRect();
    const pct = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    return Math.max(0, Math.min(100, pct));
  };

  /**
   * Démarre un drag : règle le volume au click initial puis suit les
   * mousemove globaux. On attache les listeners sur `window` plutôt que
   * sur le slider pour que l'utilisateur puisse sortir de la zone du
   * slider tout en gardant le drag (UX standard d'un slider).
   */
  const onSliderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    const v = sliderFromEvent(e);
    if (v !== null) void setVolume(v);

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const slider = rootRef.current?.querySelector('.af-slider') as HTMLElement | null;
      if (!slider) return;
      const rect = slider.getBoundingClientRect();
      const pct = Math.max(
        0,
        Math.min(100, Math.round(((ev.clientX - rect.left) / rect.width) * 100)),
      );
      void setVolume(pct);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="audio-footer" ref={rootRef} data-notch-hit="true">
      <button
        type="button"
        className={'af-device' + (dropdownOpen ? ' is-open' : '')}
        onClick={() => setDropdownOpen((o) => !o)}
        title="Changer la sortie audio"
      >
        {device ? (
          <>
            <i className={'fa-solid ' + deviceIcon(device)} style={{ color: 'var(--accent)' }} />
            <span className="af-device-name">{device.name}</span>
          </>
        ) : (
          // Aucun device détecté (SVV en circuit-breaker ou absent).
          <>
            <i className="fa-solid fa-volume-high" style={{ color: 'var(--accent)' }} />
            <span className="af-device-name">Aucune sortie</span>
          </>
        )}
        <i className="fa-solid fa-chevron-down af-chevron" />
      </button>

      <button
        type="button"
        className="af-mute"
        onClick={() => void toggleMute()}
        title={muted ? 'Réactiver le son' : 'Couper le son'}
      >
        <i className={'fa-solid ' + icon} />
      </button>

      <div className="af-slider" onMouseDown={onSliderMouseDown}>
        <div className="af-slider-fill" style={{ width: level + '%' }} />
      </div>

      <span className="af-pct">
        {level}
        <span style={{ opacity: 0.4 }}>%</span>
      </span>

      {dropdownOpen && (
        <div className="af-dropdown" role="menu">
          <div className="af-dropdown-label">Sorties disponibles</div>
          {state.devices.length === 0 ? (
            <div className="af-dropdown-empty">Aucun périphérique détecté</div>
          ) : (
            state.devices.map((d) => {
              // Le device "actif" privilégie le choix utilisateur (en
              // attente de propagation) sur le default système.
              const active = d.id === (state.currentDeviceId ?? device?.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  className={'af-dropdown-row' + (active ? ' active' : '')}
                  onClick={() => {
                    void selectDevice(d.id);
                    setDropdownOpen(false);
                  }}
                >
                  <i className={'fa-solid ' + deviceIcon(d)} />
                  <span className="afdr-name">
                    {d.name}
                    <span className="afdr-meta"> ({deviceMetaFull(d)})</span>
                  </span>
                  {active && <i className="fa-solid fa-check afdr-check" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
