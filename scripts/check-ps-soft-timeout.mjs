/**
 * Harnais de validation de l'**expiration souple** du PowerShell résident.
 *
 *   node scripts/check-ps-soft-timeout.mjs
 *
 * Ce qu'on vérifie, et pourquoi ça mérite un harnais : le process
 * `powershell.exe` résident est partagé par quatre modules (Système,
 * Confidentialité, VPN, Audio) et traite ses requêtes **séquentiellement**.
 * Historiquement, la première expiration de délai — d'où qu'elle vienne —
 * tuait ce process : un module momentanément lent emportait la détection des
 * trois autres, qui rapportaient alors un délai qui n'était pas le leur
 * (symptôme réel : `[vpn] détection échouée: timeout (10000 ms)` alors que le
 * VPN attend 20 s). Depuis, une requête expirée est abandonnée **seule**, et
 * seuls plusieurs abandons consécutifs sans aucune réponse font conclure que
 * la boucle est bloquée.
 *
 * C'est du code de secours : il ne se déclenche jamais en usage normal, donc
 * rien ne signalerait sa régression. D'où ce script, à relancer après toute
 * modification de `persistentPowershell.ts` ou de `persistent-loop.ps1`.
 *
 * Deux scénarios :
 *   A. une requête lente est abandonnée avec SON délai, et la requête
 *      suivante aboutit quand même → le process a survécu ;
 *   B. trois abandons consécutifs sans réponse → relance, et la requête
 *      d'après obtient une réponse du nouveau process.
 *
 * Comment le module réel est testé : `persistentPowershell.ts` importe
 * `psScriptPath`, qui dépend d'`electron` — le module n'est donc pas
 * importable sous Node nu. On en écrit une copie temporaire dont **seuls les
 * deux imports** sont remplacés par des stubs ; toute la logique testée est
 * celle du fichier réel, au caractère près. Le remplacement échoue bruyamment
 * si ces imports changent de forme, pour qu'on ne teste jamais une copie
 * silencieusement divergente.
 *
 * Requiert Node ≥ 23 (exécution directe du TypeScript, sans transpilation).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = join(repoRoot, 'src/main/modules/shell/persistentPowershell.ts');
const loopPath = join(repoRoot, 'resources/ps/persistent-loop.ps1');

console.log(`\n=== expiration souple du PowerShell résident — Node ${process.versions.node} ===\n`);

if (process.platform !== 'win32') {
  console.log('  plateforme non Windows : rien à vérifier');
  process.exit(0);
}

/** Écrit la copie stubbée du module et retourne son chemin. */
function writeHarness() {
  const source = readFileSync(modulePath, 'utf8');
  const stubs = [
    '// — STUBS DE TEST : seuls les deux imports non importables hors Electron —',
    "const powershellExe = () => 'powershell.exe';",
    `const psScriptPath = (_name) => ${JSON.stringify(loopPath)};`,
  ].join('\n');
  const patched = source.replace(
    /import \{ powershellExe \} from '\.\/powershellPath';\r?\nimport \{ psScriptPath \} from '\.\/psScriptPath';/,
    stubs,
  );
  if (patched === source) {
    console.error(
      "  ÉCHEC : les imports attendus de persistentPowershell.ts n'ont pas été trouvés.\n" +
        '  Le harnais refuse de tester une copie divergente — mets ce script à jour.',
    );
    process.exit(1);
  }
  const dir = mkdtempSync(join(tmpdir(), 'winnotch-ps-'));
  const file = join(dir, 'persistentPowershell.mts');
  writeFileSync(file, patched);
  return { dir, file };
}

const { dir, file } = writeHarness();
let failures = 0;
const t0 = Date.now();
const at = () => String(Date.now() - t0).padStart(5) + ' ms';

function check(label, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'OK   ' : 'ÉCHEC'} | ${label}${detail ? ` — ${detail}` : ''}`);
}

try {
  const { runPersistentPowershell, stopPersistentPowershell } = await import(
    pathToFileURL(file).href
  );

  console.log('--- A. une requête lente est abandonnée seule ---');
  // La boucle étant séquentielle, la seconde requête n'est traitée qu'après
  // la première : c'est bien le process partagé qu'on met à l'épreuve.
  const slow = runPersistentPowershell("Start-Sleep -Seconds 4; 'LENT'", 1_000);
  const fast = runPersistentPowershell("'RAPIDE'", 15_000);

  const slowRes = await slow;
  console.log(`  ${at()} | lente  -> err=${JSON.stringify(slowRes.error)}`);
  check(
    'abandon avec SON propre délai',
    slowRes.error === 'timeout (1000 ms)',
    `error=${slowRes.error}`,
  );

  const fastRes = await fast;
  console.log(`  ${at()} | rapide -> out=${JSON.stringify(fastRes.stdout.trim())}`);
  check(
    'la requête suivante aboutit (process NON tué)',
    fastRes.error === null && fastRes.stdout.trim() === 'RAPIDE',
    `out=${fastRes.stdout.trim()} err=${fastRes.error}`,
  );

  console.log('\n--- B. boucle bloquée : relance après 3 abandons ---');
  const stuck = await Promise.all([
    runPersistentPowershell("Start-Sleep -Seconds 30; 'X1'", 1_000),
    runPersistentPowershell("Start-Sleep -Seconds 30; 'X2'", 1_100),
    runPersistentPowershell("Start-Sleep -Seconds 30; 'X3'", 1_200),
  ]);
  console.log(`  ${at()} | 3 requêtes -> ${stuck.map((r) => r.error).join(' | ')}`);
  check(
    'les trois sont abandonnées',
    stuck.every((r) => r.error !== null),
    stuck.map((r) => r.error).join(' / '),
  );

  const afterReset = await runPersistentPowershell("'APRES-RELANCE'", 20_000);
  console.log(`  ${at()} | après  -> out=${JSON.stringify(afterReset.stdout.trim())}`);
  check(
    'le process relancé répond',
    afterReset.error === null && afterReset.stdout.trim() === 'APRES-RELANCE',
    `out=${afterReset.stdout.trim()} err=${afterReset.error}`,
  );

  stopPersistentPowershell();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(
  `\n${failures === 0 ? 'Tout est conforme.' : `${failures} vérification(s) en échec.`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
