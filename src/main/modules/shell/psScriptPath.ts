/**
 * Résolution du chemin d'un script PowerShell embarqué (`resources/ps/<name>`).
 *
 * Pourquoi des scripts sur disque plutôt qu'inline ?
 * --------------------------------------------------
 * Les invocations `powershell.exe -Command <script inline>` et surtout
 * `-EncodedCommand <base64>` exposent tout le script dans la ligne de commande
 * du process. Les antivirus heuristiques signalent ce pattern (base64 =
 * obfuscation, `Add-Type` inline = compilation runtime). En passant par
 * `-File <chemin>.ps1`, la ligne de commande reste propre
 * (`powershell ... -File ...\persistent-loop.ps1`) et le contenu vit dans un
 * fichier `.ps1` lisible.
 *
 * Résolution dev/prod (même logique que `resolveSvvPath` dans
 * `audio/devices.ts`) :
 *  - dev  : `<repo>/resources/ps/<name>`
 *  - prod : `<process.resourcesPath>/ps/<name>` — electron-builder copie
 *    `resources/ps` vers `ps` via `extraResources` (cf. electron-builder.yml).
 */
import { join } from 'path';
import { app } from 'electron';
import { is } from '@electron-toolkit/utils';

export function psScriptPath(name: string): string {
  if (is.dev) {
    return join(app.getAppPath(), 'resources', 'ps', name);
  }
  return join(process.resourcesPath, 'ps', name);
}
