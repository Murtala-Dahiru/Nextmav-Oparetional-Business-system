/**
 * ===========================================================================
 *  Computed columns
 * ===========================================================================
 *
 *  A column may carry a formula written the way a spreadsheet writes one:
 *
 *      =Budget - Actual
 *      =Value * Confidence / 100
 *      =ROUND(Quantity * Unit cost, 2)
 *
 *  -- Why references are by column name, not by letter ---------------------
 *
 *  There is no A1 grid here. The underlying table is a set of named columns
 *  and a jsonb object per row (0017 says why), and a letter would have to be
 *  derived from a position that changes the moment somebody drags a column.
 *  `=Budget - Actual` also survives being read by a person, which `=D2-E2`
 *  does not.
 *
 *  -- Why this is evaluated and not stored ---------------------------------
 *
 *  A computed value is a presentation of cells that are already stored.
 *  Writing the result back would create a second copy that goes stale the
 *  moment an input changes, and keeping it fresh in the database means an
 *  expression language, a dependency graph and a recalculation trigger, which
 *  is a spreadsheet engine. Evaluating on read costs a few microseconds per
 *  cell and cannot be wrong.
 *
 *  -- Why there is no `eval` -----------------------------------------------
 *
 *  Because a formula is written by one colleague and evaluated in every other
 *  colleague's browser. `new Function(...)` on that string is arbitrary code
 *  execution with the application's own origin, session and cookies. The
 *  grammar below is closed: numbers, four operators, parentheses, a handful of
 *  named functions and column references. Anything else is a formula error,
 *  which is a cell that says so rather than a page that does something.
 */

export type FormulaValue = number | null;

/* -------------------------------------------------------------------------- */
/*  Tokens                                                                    */
/* -------------------------------------------------------------------------- */

type Token =
  | { t: 'num'; v: number }
  | { t: 'ref'; v: string }
  | { t: 'fn'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '%' }
  | { t: 'punct'; v: '(' | ')' | ',' };

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  ROUND: ([x, n = 0]) => {
    const f = 10 ** Math.max(0, Math.min(10, Math.trunc(n)));
    return Math.round(x * f) / f;
  },
  ABS: ([x]) => Math.abs(x),
  MIN: args => Math.min(...args),
  MAX: args => Math.max(...args),
  /**
   * A total across the *arguments*, not down the column.
   *
   * A column formula runs once per row and has no view of the other rows, so
   * `SUM` here means `SUM(a, b, c)`. Column totals are the `aggregate` setting
   * on the column, which is a different feature in a different place.
   */
  SUM: args => args.reduce((a, b) => a + b, 0),
  AVG: args => (args.length ? args.reduce((a, b) => a + b, 0) / args.length : 0),
};

/**
 * A column reference is bare words, so the tokenizer needs to know the names.
 *
 * "Unit cost" contains a space. Requiring quotes or underscores would make the
 * common case ugly, so the longest matching column name wins - which is also
 * what stops "Cost" from matching inside "Unit cost".
 */
function tokenize(source: string, names: string[]): Token[] {
  const byLength = [...names].sort((a, b) => b.length - a.length);
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (/\s/.test(ch)) { i++; continue; }

    if ('+-*/%'.includes(ch)) {
      tokens.push({ t: 'op', v: ch as any });
      i++;
      continue;
    }
    if ('(),'.includes(ch)) {
      tokens.push({ t: 'punct', v: ch as any });
      i++;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      const hit = /^[0-9]*\.?[0-9]+/.exec(source.slice(i));
      if (!hit) throw new Error(`Unexpected "${ch}"`);
      tokens.push({ t: 'num', v: Number(hit[0]) });
      i += hit[0].length;
      continue;
    }

    const rest = source.slice(i);

    const fn = Object.keys(FUNCTIONS).find(
      name => rest.toUpperCase().startsWith(name) && /^\s*\(/.test(rest.slice(name.length)),
    );
    if (fn) {
      tokens.push({ t: 'fn', v: fn });
      i += fn.length;
      continue;
    }

    const ref = byLength.find(name => rest.toLowerCase().startsWith(name.toLowerCase()));
    if (ref) {
      tokens.push({ t: 'ref', v: ref });
      i += ref.length;
      continue;
    }

    throw new Error(`"${rest.split(/[\s+\-*/%(),]/)[0] || ch}" is not a column`);
  }

  return tokens;
}

/* -------------------------------------------------------------------------- */
/*  Grammar                                                                   */
/* -------------------------------------------------------------------------- */

/**
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/' | '%') unary)*
 *   unary      := '-'? primary
 *   primary    := number | ref | fn '(' args ')' | '(' expression ')'
 */
function parse(tokens: Token[], values: Record<string, number>): number {
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];

  function expression(): number {
    let left = term();
    for (;;) {
      const token = peek();
      if (token?.t !== 'op' || (token.v !== '+' && token.v !== '-')) return left;
      take();
      const right = term();
      left = token.v === '+' ? left + right : left - right;
    }
  }

  function term(): number {
    let left = unary();
    for (;;) {
      const token = peek();
      if (token?.t !== 'op' || !['*', '/', '%'].includes(token.v)) return left;
      take();
      const right = unary();
      // Division by zero is a formula error, not Infinity. A column reading
      // "Infinity" is a bug report; one reading "-" is an empty denominator.
      if ((token.v === '/' || token.v === '%') && right === 0) throw new Error('Division by zero');
      left = token.v === '*' ? left * right : token.v === '/' ? left / right : left % right;
    }
  }

  function unary(): number {
    const token = peek();
    if (token?.t === 'op' && token.v === '-') { take(); return -unary(); }
    if (token?.t === 'op' && token.v === '+') { take(); return unary(); }
    return primary();
  }

  function primary(): number {
    const token = take();
    if (!token) throw new Error('Formula ends unexpectedly');

    if (token.t === 'num') return token.v;

    if (token.t === 'ref') {
      const value = values[token.v.toLowerCase()];
      // An empty cell is zero, which is what a spreadsheet does and what makes
      // a half-filled budget still total correctly.
      return Number.isFinite(value) ? value : 0;
    }

    if (token.t === 'fn') {
      const open = take();
      if (open?.t !== 'punct' || open.v !== '(') throw new Error(`${token.v} needs brackets`);
      const args: number[] = [];
      if (!(peek()?.t === 'punct' && (peek() as any).v === ')')) {
        args.push(expression());
        while (peek()?.t === 'punct' && (peek() as any).v === ',') {
          take();
          args.push(expression());
        }
      }
      const close = take();
      if (close?.t !== 'punct' || close.v !== ')') throw new Error(`${token.v} is missing a bracket`);
      return FUNCTIONS[token.v](args);
    }

    if (token.t === 'punct' && token.v === '(') {
      const value = expression();
      const close = take();
      if (close?.t !== 'punct' || close.v !== ')') throw new Error('Missing a closing bracket');
      return value;
    }

    throw new Error('Formula could not be read');
  }

  const result = expression();
  if (at < tokens.length) throw new Error('Formula could not be read');
  return result;
}

/* -------------------------------------------------------------------------- */
/*  The entry point                                                           */
/* -------------------------------------------------------------------------- */

export interface FormulaResult {
  value: FormulaValue;
  /** Set when the formula could not be evaluated. Shown in the cell. */
  error?: string;
}

/**
 * Evaluate one column's formula against one row.
 *
 * `inputs` is keyed by lowercased column name so a formula written
 * `=budget - actual` works against columns called "Budget" and "Actual",
 * which is what somebody typing quickly will produce.
 */
export function evaluateFormula(
  formula: string,
  columnNames: string[],
  inputs: Record<string, number>,
): FormulaResult {
  const source = formula.trim().replace(/^=/, '').trim();
  if (!source) return { value: null };

  try {
    const tokens = tokenize(source, columnNames);
    if (!tokens.length) return { value: null };
    const value = parse(tokens, inputs);
    if (!Number.isFinite(value)) return { value: null, error: 'Not a number' };
    return { value };
  } catch (e: any) {
    return { value: null, error: e?.message || 'Formula error' };
  }
}

/**
 * Which columns a formula reads.
 *
 * Used to refuse a formula that refers to its own column, which would be a
 * cell that depends on itself.
 *
 * Longer cycles cannot be built. The grid evaluates columns left to right and
 * feeds each result into the inputs for the ones after it, so a formula can
 * only ever see columns to its *left* - a reference to a column further right
 * resolves to zero rather than looping. That is the same rule a dependency
 * graph would arrive at, without the graph.
 */
export function formulaReferences(formula: string, columnNames: string[]): string[] {
  try {
    return tokenize(formula.trim().replace(/^=/, ''), columnNames)
      .filter((t): t is { t: 'ref'; v: string } => t.t === 'ref')
      .map(t => t.v);
  } catch {
    return [];
  }
}
