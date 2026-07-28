/**
 * Harnais de validation de la couche Win32 native (koffi).
 *
 * Sert de garde-fou reproductible : à relancer après toute montée d'Electron,
 * de Node ou de koffi, et sur toute nouvelle machine — c'est ce qui vérifie que
 * l'ABI N-API tient et que `user32` répond.
 *
 *   node scripts/check-native-win32.cjs                       # sous Node
 *   .\node_modules\electron\dist\electron.exe scripts\check-native-win32.cjs
 *
 * Le second est le seul qui compte vraiment : c'est l'ABI de l'application.
 *
 * Pourquoi ce harnais plutôt qu'un test unitaire : il n'y a pas de runner dans
 * le projet, et surtout ce qu'on veut vérifier n'est pas notre logique mais
 * l'environnement (ABI, présence du binaire, réponse du système).
 */
const koffi = require('koffi');

const runtime = process.versions.electron
  ? `Electron ${process.versions.electron} (node ${process.versions.node}, ABI modules ${process.versions.modules})`
  : `Node ${process.versions.node} (ABI modules ${process.versions.modules})`;
console.log(`\n=== couche Win32 native — ${runtime} ===\n`);

if (process.platform !== 'win32') {
  console.log('  plateforme non Windows : rien à vérifier');
  process.exit(0);
}

const user32 = koffi.load('user32.dll');

const RECT = koffi.struct('RECT', {
  left: 'long',
  top: 'long',
  right: 'long',
  bottom: 'long',
});

const GetForegroundWindow = user32.func('void *GetForegroundWindow()');
const GetWindowRect = user32.func('bool GetWindowRect(void *hWnd, _Out_ RECT *lpRect)');
const GetWindowThreadProcessId = user32.func(
  'uint32 GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *lpdwProcessId)',
);
const GetAsyncKeyState = user32.func('int16 GetAsyncKeyState(int vKey)');

const VK_MENU = 0x12;

console.log('--- réponses du système ---');
const hwnd = GetForegroundWindow();
console.log(`  GetForegroundWindow()      -> ${hwnd ? koffi.address(hwnd) : 'NULL'}`);

const rect = {};
const okRect = GetWindowRect(hwnd, rect);
const w = rect.right - rect.left;
const h = rect.bottom - rect.top;
console.log(`  GetWindowRect()            -> ${okRect} (${w} x ${h} px)`);

const pidOut = [0];
GetWindowThreadProcessId(hwnd, pidOut);
console.log(`  GetWindowThreadProcessId() -> pid ${pidOut[0]}`);

const alt = (GetAsyncKeyState(VK_MENU) & 0x8000) !== 0;
console.log(`  GetAsyncKeyState(VK_MENU)  -> Alt ${alt ? 'enfoncé' : 'relâché'}`);

// Le coût par appel décide si le polling peut vivre dans l'event loop du main
// process ou s'il faut un worker_thread. Mesuré à ~1 µs, la question est
// tranchée : le budget réel du détecteur est de l'ordre de 0,002 % d'un cœur.
console.log('\n--- coût par appel ---');
function bench(label, fn, iters = 20000) {
  fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const ns = Number(process.hrtime.bigint() - t0) / iters;
  console.log(`  ${label.padEnd(28)} ${(ns / 1000).toFixed(2)} µs`);
  return ns;
}
const nsAlt = bench('GetAsyncKeyState', () => GetAsyncKeyState(VK_MENU));
const nsFg = bench('GetForegroundWindow', () => GetForegroundWindow());
const nsRect = bench('GetWindowRect', () => GetWindowRect(hwnd, {}));

// Cadences réelles du détecteur : Alt toutes les 75 ms, fenêtre toutes les 750 ms.
const nsPerSec = (1000 / 75) * nsAlt + (1000 / 750) * (nsFg + nsRect);
console.log(
  `\n  budget du détecteur : ${(nsPerSec / 1e6).toFixed(4)} ms/s ` +
    `(${((nsPerSec / 1e9) * 100).toFixed(5)} % d'un cœur)`,
);

const ok = Boolean(hwnd) && okRect && w > 0 && h > 0 && pidOut[0] > 0;
console.log(`\n=== ${ok ? 'OK — la couche native répond' : 'ÉCHEC'} ===\n`);
process.exit(ok ? 0 : 1);
