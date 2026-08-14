/**
 * Chip « sortie audio » de la collapsed row.
 *
 * Affiche l'icône du **type** de la sortie courante (casque, micro-casque,
 * haut-parleurs, sortie écran) pour qu'on sache d'un coup d'œil où part le
 * son sans déployer le notch — le cas typique étant « le son sort-il dans
 * mon casque ou dans les haut-parleurs de l'écran ? ». Le nom réel de
 * l'appareil et son transport (Bluetooth) sont dans la tooltip.
 *
 * Volontairement **sans volume ni témoin de mute** : les afficher
 * obligerait à relire le binaire `loudness` en continu notch fermé (cf.
 * `audioService`), ce qui réintroduirait des dizaines de milliers de
 * créations de process par jour — et sans cette relecture l'indication
 * serait périmée dès le premier appui sur une touche média, donc pire
 * qu'absente.
 *
 * Pas masquée en « Ne pas déranger » : c'est un état système, comme le VPN
 * ou la charge machine, pas une notification.
 *
 * Aucun `onClick` : le clic remonte au notch, qui se déploie — le footer
 * audio (avec le sélecteur de sortie) est alors juste sous les yeux.
 */
import type { CSSProperties } from 'react';
import { useAudioContext } from './AudioContext';
import { NotchTooltip } from '../../components/Tooltip/NotchTooltip';
import { currentDevice, deviceIcon, deviceMeta } from './deviceMeta';

const AUDIO_ACCENT: CSSProperties = {
  '--tt-accent': '#2dd4bf',
  '--tt-accent-fade': 'rgba(45, 212, 191, 0.18)',
} as CSSProperties;

export function AudioChip() {
  const { state } = useAudioContext();
  const device = currentDevice(state.devices, state.currentDeviceId);

  // Aucune sortie connue (SVV en circuit-breaker, boot à froid) : on
  // n'affiche rien plutôt qu'une icône trompeuse. `Notch.tsx` applique la
  // même condition pour la largeur du notch rétracté.
  if (!device) return null;

  return (
    <NotchTooltip
      accentStyle={AUDIO_ACCENT}
      content={
        <div className="tt-body">
          <div className="tt-head">
            <i className={'fa-solid ' + deviceIcon(device)} />
            <span>sortie audio</span>
          </div>
          <div className="tt-title">{device.name}</div>
          <div className="tt-meta">
            <span className="tt-meta-pill">{deviceMeta(device)}</span>
            {device.bluetooth && (
              <span className="tt-meta-pill">
                <i className="fa-brands fa-bluetooth" />
                Bluetooth
              </span>
            )}
            {state.devices.length > 1 && (
              <span className="tt-meta-pill tt-meta-pill-dim">
                {state.devices.length} sorties disponibles
              </span>
            )}
          </div>
          <div className="tt-sub">
            Ouvre le notch pour changer de sortie ou régler le volume.
          </div>
        </div>
      }
    >
      <div className="chip chip-audio">
        <i
          className={'fa-solid ' + deviceIcon(device) + ' audio-glyph'}
          aria-label={`Sortie audio : ${device.name}`}
        />
      </div>
    </NotchTooltip>
  );
}
