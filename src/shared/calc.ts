/**
 * Moteur de calcul & conversion inline pour le mode `=` de la search bar.
 *
 * 100 % JS pur, ZÉRO dépendance (pas de `mathjs` ~150 Ko) : tokenizer +
 * shunting-yard maison. Importable côté renderer comme côté main (aucun
 * appel Node-only), même contrat que `shared/clipboardDetectors.ts`.
 *
 * Formes reconnues :
 *  - Arithmétique : `(1920/3)*2`, `2**16`, `-2**2`, `100 % 7`, `1.5e3`…
 *    Opérateurs `+ - * / % **`, parenthèses, moins unaire, littéraux
 *    `0x`/`0b`/`0o`. (`**` associatif à droite ; le moins unaire suit la
 *    convention mathématique : `-2**2 = -4`.)
 *  - Bases : `0xFF to dec`, `255 to hex`, `0b1010 to oct`… ou un littéral
 *    nu `0xFF` → affiche dec/hex/bin/oct.
 *  - Longueurs CSS : `20px to rem` (base 16 px), px/rem/em/pt/pc/in/cm/mm.
 *  - Tailles data : `1.5MB to KB` — décimal (KB=1000) et binaire (KiB=1024).
 *  - Epoch ↔ date : `1700000000 to date`, `2024-01-01 to epoch`.
 *
 * Devises explicitement HORS scope v1 (nécessiteraient le réseau).
 */

/** Une ligne secondaire (ex. autres bases, date locale vs UTC). */
export interface CalcLine {
  label: string;
  value: string;
}

export type CalcKind = 'arith' | 'base' | 'length' | 'data' | 'date' | 'epoch';

export interface CalcResult {
  ok: boolean;
  /** Résultat principal, mis en avant. */
  result: string;
  /** Écho de l'entrée normalisée (affiché en sous-titre). */
  echo: string;
  /** Lignes secondaires copiables (vide pour un calcul simple). */
  lines: CalcLine[];
  /** Texte copié sur Entrée / bouton Copier. */
  copyText: string;
  kind: CalcKind;
  /** Renseigné uniquement si `ok === false`. */
  error?: string;
}

/* ───────────── Tokenizer ───────────── */

type Tok =
  | { t: 'num'; v: number }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' };

/** Lit un nombre (hex/bin/oct/décimal/exp) à la position `i`. */
function readNumber(s: string, i: number): { value: number; next: number } | null {
  const rest = s.slice(i);
  let m: RegExpExecArray | null;
  if ((m = /^0x[0-9a-f]+/i.exec(rest))) {
    return { value: parseInt(m[0].slice(2), 16), next: i + m[0].length };
  }
  if ((m = /^0b[01]+/i.exec(rest))) {
    return { value: parseInt(m[0].slice(2), 2), next: i + m[0].length };
  }
  if ((m = /^0o[0-7]+/i.exec(rest))) {
    return { value: parseInt(m[0].slice(2), 8), next: i + m[0].length };
  }
  if ((m = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(rest))) {
    return { value: parseFloat(m[0]), next: i + m[0].length };
  }
  return null;
}

function tokenize(s: string): Tok[] {
  const toks: Tok[] = [];
  const prevIsValue = (): boolean => {
    const p = toks[toks.length - 1];
    return !!p && (p.t === 'num' || p.t === 'rp');
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c === '(') {
      toks.push({ t: 'lp' });
      i++;
      continue;
    }
    if (c === ')') {
      toks.push({ t: 'rp' });
      i++;
      continue;
    }
    if (c === '*' && s[i + 1] === '*') {
      toks.push({ t: 'op', v: '**' });
      i += 2;
      continue;
    }
    if ('+-*/%'.includes(c)) {
      // Moins/plus unaire : en début d'expression ou juste après un autre
      // opérateur / une parenthèse ouvrante.
      if ((c === '-' || c === '+') && !prevIsValue()) {
        if (c === '-') toks.push({ t: 'op', v: 'neg' });
        // '+' unaire = identité → ignoré.
        i++;
        continue;
      }
      toks.push({ t: 'op', v: c });
      i++;
      continue;
    }
    const num = readNumber(s, i);
    if (num) {
      toks.push({ t: 'num', v: num.value });
      i = num.next;
      continue;
    }
    throw new Error(`Caractère inattendu : « ${c} »`);
  }
  return toks;
}

/* ───────────── Shunting-yard + évaluation ───────────── */

const PREC: Record<string, number> = {
  neg: 2.5,
  '**': 3,
  '*': 2,
  '/': 2,
  '%': 2,
  '+': 1,
  '-': 1,
};
const RIGHT_ASSOC: Record<string, boolean> = { '**': true, neg: true };

/** Évalue une expression arithmétique. @throws si malformée. */
export function evalArith(input: string): number {
  const toks = tokenize(input);
  if (toks.length === 0) throw new Error('Expression vide');

  // Shunting-yard → file de sortie en notation polonaise inverse.
  const out: Tok[] = [];
  const ops: Tok[] = [];
  for (const tok of toks) {
    if (tok.t === 'num') {
      out.push(tok);
    } else if (tok.t === 'op') {
      const o1 = tok.v;
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top.t !== 'op') break;
        const o2 = top.v;
        const pop = RIGHT_ASSOC[o1]
          ? PREC[o2] > PREC[o1]
          : PREC[o2] >= PREC[o1];
        if (pop) out.push(ops.pop() as Tok);
        else break;
      }
      ops.push(tok);
    } else if (tok.t === 'lp') {
      ops.push(tok);
    } else {
      // rp
      while (ops.length && ops[ops.length - 1].t !== 'lp') {
        out.push(ops.pop() as Tok);
      }
      if (!ops.length) throw new Error('Parenthèse fermante en trop');
      ops.pop();
    }
  }
  while (ops.length) {
    const o = ops.pop() as Tok;
    if (o.t === 'lp') throw new Error('Parenthèse non fermée');
    out.push(o);
  }

  // Évaluation RPN.
  const st: number[] = [];
  for (const tok of out) {
    if (tok.t === 'num') {
      st.push(tok.v);
      continue;
    }
    if (tok.t !== 'op') continue;
    if (tok.v === 'neg') {
      const a = st.pop();
      if (a === undefined) throw new Error('Expression invalide');
      st.push(-a);
      continue;
    }
    const b = st.pop();
    const a = st.pop();
    if (a === undefined || b === undefined) throw new Error('Expression invalide');
    switch (tok.v) {
      case '+':
        st.push(a + b);
        break;
      case '-':
        st.push(a - b);
        break;
      case '*':
        st.push(a * b);
        break;
      case '/':
        st.push(a / b);
        break;
      case '%':
        st.push(a % b);
        break;
      case '**':
        st.push(a ** b);
        break;
      default:
        throw new Error(`Opérateur inconnu : ${tok.v}`);
    }
  }
  if (st.length !== 1) throw new Error('Expression invalide');
  return st[0];
}

/* ───────────── Formatage ───────────── */

/** Formate un nombre proprement (entier tel quel, flottant arrondi 12 sig.). */
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) {
    if (Number.isNaN(n)) return 'NaN';
    return n > 0 ? '∞' : '-∞';
  }
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return n.toString();
  return parseFloat(n.toPrecision(12)).toString();
}

/** Magnitude d'un entier dans une base (sans signe ni préfixe). */
function magToRadix(i: number, radix: number): string {
  return BigInt(Math.abs(Math.trunc(i))).toString(radix);
}

function formatBase(n: number, base: 'dec' | 'hex' | 'bin' | 'oct'): string {
  // Le signe précède le préfixe (« -0x4 », pas « 0x-4 »).
  const sign = n < 0 ? '-' : '';
  switch (base) {
    case 'dec':
      return sign + magToRadix(n, 10);
    case 'hex':
      return sign + '0x' + magToRadix(n, 16).toUpperCase();
    case 'bin':
      return sign + '0b' + magToRadix(n, 2);
    case 'oct':
      return sign + '0o' + magToRadix(n, 8);
  }
}

function allBaseLines(n: number): CalcLine[] {
  return [
    { label: 'DEC', value: formatBase(n, 'dec') },
    { label: 'HEX', value: formatBase(n, 'hex') },
    { label: 'BIN', value: formatBase(n, 'bin') },
    { label: 'OCT', value: formatBase(n, 'oct') },
  ];
}

/* ───────────── Tables d'unités ───────────── */

/** Longueurs CSS → facteur vers px (rem/em sur base 16 px). */
const LENGTH: Record<string, number> = {
  px: 1,
  rem: 16,
  em: 16,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
};

/** Tailles data → facteur vers octets (décimal 1000, binaire 1024). */
const DATA: Record<string, number> = {
  b: 1,
  byte: 1,
  bytes: 1,
  o: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  pb: 1e15,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
  pib: 1024 ** 5,
};

/** Casse d'affichage canonique des unités (clé = unité normalisée lower). */
const UNIT_LABEL: Record<string, string> = {
  px: 'px',
  rem: 'rem',
  em: 'em',
  pt: 'pt',
  pc: 'pc',
  in: 'in',
  cm: 'cm',
  mm: 'mm',
  b: 'B',
  byte: 'B',
  bytes: 'B',
  o: 'o',
  kb: 'KB',
  mb: 'MB',
  gb: 'GB',
  tb: 'TB',
  pb: 'PB',
  kib: 'KiB',
  mib: 'MiB',
  gib: 'GiB',
  tib: 'TiB',
  pib: 'PiB',
};

const BASE_TARGETS: Record<string, 'dec' | 'hex' | 'bin' | 'oct'> = {
  dec: 'dec',
  decimal: 'dec',
  base10: 'dec',
  hex: 'hex',
  hexa: 'hex',
  hexadecimal: 'hex',
  base16: 'hex',
  bin: 'bin',
  binary: 'bin',
  binaire: 'bin',
  base2: 'bin',
  oct: 'oct',
  octal: 'oct',
  base8: 'oct',
};

const DATE_TARGETS = new Set(['date', 'datetime', 'iso', 'utc', 'local']);
const EPOCH_TARGETS = new Set(['epoch', 'unix', 'timestamp', 'ts']);

/* ───────────── Conversions ───────────── */

function toBaseResult(left: string, base: 'dec' | 'hex' | 'bin' | 'oct'): CalcResult {
  const n = evalArith(left);
  if (!Number.isInteger(n)) throw new Error('Conversion de base : entier requis');
  const value = formatBase(n, base);
  return {
    ok: true,
    kind: 'base',
    result: value,
    echo: `${left.trim()} → ${base}`,
    lines: allBaseLines(n),
    copyText: value,
  };
}

function bareBaseResult(raw: string): CalcResult {
  const n = evalArith(raw);
  return {
    ok: true,
    kind: 'base',
    result: formatBase(n, 'dec'),
    echo: raw,
    lines: allBaseLines(n),
    copyText: formatBase(n, 'dec'),
  };
}

function epochToDate(left: string): CalcResult {
  const n = evalArith(left);
  // ≥ 1e12 → déjà des millisecondes, sinon des secondes.
  const ms = Math.abs(n) >= 1e12 ? n : n * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new Error('Epoch invalide');
  const iso = d.toISOString();
  const local = d.toLocaleString('fr-FR', {
    dateStyle: 'full',
    timeStyle: 'medium',
  });
  return {
    ok: true,
    kind: 'date',
    result: iso,
    echo: `${left.trim()} → date`,
    lines: [
      { label: 'Local', value: local },
      { label: 'UTC ISO', value: iso },
    ],
    copyText: iso,
  };
}

function dateToEpoch(left: string): CalcResult {
  const t = Date.parse(left.trim());
  if (Number.isNaN(t)) throw new Error('Date non reconnue');
  const sec = Math.floor(t / 1000);
  return {
    ok: true,
    kind: 'epoch',
    result: String(sec),
    echo: `${left.trim()} → epoch`,
    lines: [
      { label: 'Secondes', value: String(sec) },
      { label: 'Millisecondes', value: String(t) },
    ],
    copyText: String(sec),
  };
}

function convertUnit(
  left: string,
  targetUnit: string,
  table: Record<string, number>,
  kind: 'length' | 'data',
): CalcResult {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-zµ]*)$/i.exec(left.trim());
  if (!m) throw new Error('Valeur + unité attendue (ex. « 20px »)');
  const val = parseFloat(m[1]);
  let srcUnit = m[2].toLowerCase();
  if (!srcUnit) srcUnit = kind === 'length' ? 'px' : 'b';
  const srcFactor = table[srcUnit];
  if (srcFactor === undefined) {
    throw new Error(`Unité source inconnue : « ${m[2] || '?'} »`);
  }
  const tgtFactor = table[targetUnit];
  const result = (val * srcFactor) / tgtFactor;
  const out = `${fmtNum(result)} ${UNIT_LABEL[targetUnit] ?? targetUnit}`;
  return {
    ok: true,
    kind,
    result: out,
    echo: `${left.trim()} → ${UNIT_LABEL[targetUnit] ?? targetUnit}`,
    lines: [],
    copyText: out,
  };
}

function convert(left: string, unit: string): CalcResult {
  const base = BASE_TARGETS[unit];
  if (base) return toBaseResult(left, base);
  if (DATE_TARGETS.has(unit)) return epochToDate(left);
  if (EPOCH_TARGETS.has(unit)) return dateToEpoch(left);
  if (LENGTH[unit] !== undefined) return convertUnit(left, unit, LENGTH, 'length');
  if (DATA[unit] !== undefined) return convertUnit(left, unit, DATA, 'data');
  throw new Error(`Unité de destination inconnue : « ${unit} »`);
}

/* ───────────── Arithmétique simple ───────────── */

function arithResult(raw: string): CalcResult {
  const n = evalArith(raw);
  const result = fmtNum(n);
  const lines: CalcLine[] = [];
  // Bonus : pour un résultat entier exploitable, on montre l'hexa (utile
  // en dev — masques de bits, offsets…).
  if (Number.isInteger(n) && n !== 0 && Math.abs(n) <= Number.MAX_SAFE_INTEGER) {
    lines.push({ label: 'HEX', value: formatBase(n, 'hex') });
  }
  return { ok: true, kind: 'arith', result, echo: raw, lines, copyText: result };
}

/* ───────────── Point d'entrée ───────────── */

const CONV_RE = /^(.*\S)\s+(?:to|in|as|en)\s+([a-zµ0-9]+)\s*$/i;
const BARE_BASE_RE = /^(?:0x[0-9a-f]+|0b[01]+|0o[0-7]+)$/i;

/**
 * Évalue une saisie du mode `=`. Retourne `null` si l'entrée est vide
 * (l'appelant affiche alors une aide), sinon un `CalcResult` (avec
 * `ok: false` + `error` en cas d'échec — jamais de throw vers l'appelant).
 */
export function evaluateCalc(input: string): CalcResult | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const conv = CONV_RE.exec(raw);
    if (conv) return convert(conv[1].trim(), conv[2].toLowerCase());
    if (BARE_BASE_RE.test(raw)) return bareBaseResult(raw);
    return arithResult(raw);
  } catch (e) {
    return {
      ok: false,
      kind: 'arith',
      result: '',
      echo: raw,
      lines: [],
      copyText: '',
      error: e instanceof Error ? e.message : 'Erreur de calcul',
    };
  }
}
