/**
 * Coloration syntaxique JSON sans dépendance externe.
 *
 * Tokenize la string en `string`, `key`, `number`, `bool`, `null`,
 * `punct` puis émet un array de spans React. Pas de
 * `dangerouslySetInnerHTML` — on garde la sélection texte propre et le
 * Linter content. Les classes CSS sont définies dans `clipboard.css`.
 *
 * Le tokenizer est conçu pour du JSON déjà valide (sortie de
 * `JSON.stringify(parsed, null, 2)`) : pas de gestion d'erreur stricte,
 * juste un fallback `text` pour ce qui ne matche aucun motif (whitespace,
 * ponctuation).
 */
import { Fragment } from 'react';

type TokenKind = 'string' | 'key' | 'number' | 'bool' | 'null' | 'punct';

interface Token {
  kind: TokenKind;
  text: string;
}

// L'ordre des alternatives est important :
//  - `string-as-key`  : "foo": → on regarde le `:` qui suit (lookahead)
//  - `string`         : "foo" sans `:` derrière
//  - `number`         : décimal, exponentiel, négatif
//  - `bool` / `null`  : mots-clé
//  - reste            : whitespace ou ponctuation (`{`, `}`, `[`, `]`, `,`, `:`)
//
// Note : `\\.` dans la classe string couvre les escapes (\\ \" \n \t \uXXXX).
const TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false)\b|(null)\b|([{}[\],]|:)|(\s+)/g;

function tokenize(json: string): Token[] {
  const tokens: Token[] = [];
  let lastEnd = 0;

  // Reset lastIndex au cas où ce regex global ait été utilisé ailleurs.
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(json)) !== null) {
    // Texte non matché entre deux tokens (rare en JSON valide, mais safe).
    if (match.index > lastEnd) {
      tokens.push({ kind: 'punct', text: json.slice(lastEnd, match.index) });
    }
    lastEnd = match.index + match[0].length;

    const [, str, colon, num, bool, nul, punct, ws] = match;
    if (str !== undefined) {
      // Clé si suivie de `:`, sinon valeur string.
      if (colon !== undefined) {
        tokens.push({ kind: 'key', text: str });
        tokens.push({ kind: 'punct', text: colon });
      } else {
        tokens.push({ kind: 'string', text: str });
      }
    } else if (num !== undefined) {
      tokens.push({ kind: 'number', text: num });
    } else if (bool !== undefined) {
      tokens.push({ kind: 'bool', text: bool });
    } else if (nul !== undefined) {
      tokens.push({ kind: 'null', text: nul });
    } else if (punct !== undefined) {
      tokens.push({ kind: 'punct', text: punct });
    } else if (ws !== undefined) {
      tokens.push({ kind: 'punct', text: ws });
    }
  }
  if (lastEnd < json.length) {
    tokens.push({ kind: 'punct', text: json.slice(lastEnd) });
  }
  return tokens;
}

const CLASS_BY_KIND: Record<TokenKind, string> = {
  string: 'cb-json-tk-string',
  key: 'cb-json-tk-key',
  number: 'cb-json-tk-number',
  bool: 'cb-json-tk-bool',
  null: 'cb-json-tk-null',
  punct: 'cb-json-tk-punct',
};

interface Props {
  /** JSON déjà formaté (output de JSON.stringify(_, null, 2)). */
  source: string;
  className?: string;
}

export function JsonHighlight({ source, className }: Props) {
  const tokens = tokenize(source);
  return (
    <pre className={className}>
      {tokens.map((t, i) => (
        <Fragment key={i}>
          {t.kind === 'punct' ? (
            t.text
          ) : (
            <span className={CLASS_BY_KIND[t.kind]}>{t.text}</span>
          )}
        </Fragment>
      ))}
    </pre>
  );
}
