/**
 * Libellés et icônes d'un périphérique de sortie audio.
 *
 * Centralisé ici parce que **deux** UI en dépendent et doivent rester
 * cohérentes : le footer du dashboard déployé (`AudioFooter`) et la chip du
 * notch rétracté (`AudioChip`). Voir un casque dans la chip puis une autre
 * icône dans le footer pour le même appareil serait déroutant.
 *
 * La catégorisation elle-même est faite côté main (form factor déclaré par
 * le pilote, cf. `main/modules/audio/endpoints.ts`) : ce module ne fait que
 * la traduire en glyphe et en mot.
 */
import type { AudioDevice } from './types';

/** Classe Font Awesome correspondant au type de périphérique. */
export function deviceIcon(d: AudioDevice): string {
  switch (d.type) {
    case 'headphones':
      return 'fa-headphones';
    case 'headset':
      return 'fa-headset';
    case 'display':
      return 'fa-display';
    case 'speakers':
      return 'fa-volume-high';
    default:
      return 'fa-volume-high';
  }
}

/** Libellé court du type ("Casque", "Haut-parleurs"…). */
export function deviceMeta(d: AudioDevice): string {
  switch (d.type) {
    case 'headphones':
      return 'Casque';
    case 'headset':
      return 'Micro-casque';
    case 'display':
      return 'Sortie écran';
    case 'speakers':
      return 'Haut-parleurs';
    default:
      return 'Audio';
  }
}

/**
 * Libellé du type enrichi du transport quand il est notable. Le Bluetooth
 * est une information utile en soi (latence, batterie, appairage) et ne se
 * devine pas depuis le nom de l'appareil.
 */
export function deviceMetaFull(d: AudioDevice): string {
  return d.bluetooth ? `${deviceMeta(d)} · Bluetooth` : deviceMeta(d);
}

/**
 * Périphérique courant selon la même règle que le footer : le choix
 * utilisateur en attente de propagation d'abord, puis le défaut système,
 * puis la première sortie disponible. `undefined` si aucune sortie connue.
 */
export function currentDevice(
  devices: AudioDevice[],
  currentDeviceId: string | null,
): AudioDevice | undefined {
  return (
    devices.find((d) => d.id === currentDeviceId) ??
    devices.find((d) => d.isDefault) ??
    devices[0]
  );
}
