/**
 * Vérifie la logique de décision « plein écran » (`fullscreenLogic.ts`).
 *
 *   node scripts/check-fullscreen-logic.mjs
 *
 * Pourquoi un harnais et pas un test unitaire : le projet n'a pas de runner.
 * Cette logique est en revanche le bon endroit pour ce genre de vérification —
 * c'est un module PUR (aucune I/O, aucune dépendance à Electron), partagé à
 * l'identique par le détecteur natif et le repli PowerShell. Un écart ici ferait
 * diverger les deux implémentations, ce qu'aucun test manuel ne rattraperait.
 *
 * Le module étant en TypeScript, on le transpile à la volée avec esbuild (déjà
 * présent via Vite) plutôt que de dupliquer la logique en JS.
 */
import { buildSync } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = 'src/main/modules/shell/fullscreenLogic.ts';

const out = buildSync({
  entryPoints: [SRC],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const dir = mkdtempSync(join(tmpdir(), 'winnotch-logic-'));
const bundlePath = join(dir, 'logic.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text, 'utf8');

const { isFullscreenWindow, parseDetectorLine, EDGE_TOLERANCE_PX } = await import(
  pathToFileURL(bundlePath).href
);

const display = { x: 0, y: 0, width: 3200, height: 2000 };
const SELF = 1234;
let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  (obtenu ${actual}, attendu ${expected})`}`);
}

console.log(`\n=== logique plein écran (tolérance ${EDGE_TOLERANCE_PX} px) ===\n`);

console.log('-- plein écran');
check('couvre exactement l\'écran', isFullscreenWindow({ left: 0, top: 0, right: 3200, bottom: 2000 }, 99, SELF, display), true);

console.log('-- tolérance de bord');
check('décalé de 2 px (limite acceptée)', isFullscreenWindow({ left: 2, top: 2, right: 3202, bottom: 2002 }, 99, SELF, display), true);
check('décalé de 3 px (hors tolérance)', isFullscreenWindow({ left: 3, top: 3, right: 3203, bottom: 2003 }, 99, SELF, display), false);
check('bords rognés de 2 px', isFullscreenWindow({ left: -2, top: -2, right: 3198, bottom: 1998 }, 99, SELF, display), true);

console.log('-- fenêtres ordinaires');
check('fenêtre normale', isFullscreenWindow({ left: 181, top: 203, right: 1260, bottom: 813 }, 99, SELF, display), false);
check('barre des tâches', isFullscreenWindow({ left: 0, top: 1892, right: 3200, bottom: 2000 }, 99, SELF, display), false);
check('bonne largeur, mauvaise hauteur', isFullscreenWindow({ left: 0, top: 0, right: 3200, bottom: 1200 }, 99, SELF, display), false);

console.log('-- exclusion de notre propre process');
check('plein écran mais c\'est nous', isFullscreenWindow({ left: 0, top: 0, right: 3200, bottom: 2000 }, SELF, SELF, display), false);

console.log('-- écran secondaire (origine non nulle)');
const right = { x: 3200, y: 0, width: 1920, height: 1080 };
check('plein écran sur l\'écran de droite', isFullscreenWindow({ left: 3200, top: 0, right: 5120, bottom: 1080 }, 99, SELF, right), true);
check('même rectangle, mais écran principal', isFullscreenWindow({ left: 3200, top: 0, right: 5120, bottom: 1080 }, 99, SELF, display), false);

console.log('-- parsing du protocole PowerShell');
const parsed = parseDetectorLine('0,0,3200,2000,4242');
check('ligne valide → pid', parsed?.pid, 4242);
check('ligne valide → right', parsed?.rect.right, 3200);
check('champs manquants', parseDetectorLine('0,0,3200'), null);
check('valeurs non numériques', parseDetectorLine('a,b,c,d,e'), null);

console.log(`\n=== ${pass} ok / ${fail} échec(s) ===\n`);
process.exit(fail === 0 ? 0 : 1);
