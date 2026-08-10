/**
 * Import the uploaded public-experience stylesheets, scoped.
 *
 * ── The problem this solves ────────────────────────────────────────────────
 *
 * The uploaded project is a standalone site: its CSS declares custom properties
 * on `:root` and styles `html`, `body`, `a`, `button`, `select`, `ol`, `video`,
 * `*`, `::selection`, `:focus-visible` and the scrollbar pseudo-elements
 * globally. In a standalone site that is correct. Dropped into this repository
 * it would restyle the authenticated application — which is in production and
 * is explicitly out of scope.
 *
 * In the App Router every imported stylesheet is global regardless of which
 * layout imports it, so "only import it in the marketing layout" is not
 * isolation. The isolation has to be in the CSS.
 *
 * So every global selector is rewritten to sit under `.nm-public`, the class on
 * the public layout's wrapper. Class selectors are left alone: they are all
 * `nm-`-prefixed already and nothing in the application uses that namespace.
 *
 * ── The one collision worth knowing about ────────────────────────────────
 *
 * Both projects use a `--nm-*` custom-property namespace, and three names
 * genuinely collide: `--nm-accent`, `--nm-accent-hover`, `--nm-accent-soft`.
 * Scoping the uploaded `:root` to `.nm-public` is what keeps them apart —
 * inside the public wrapper the uploaded values win, and at `:root` this
 * repository's own ramp is untouched. That is why `:root` must map to the
 * wrapper class and not simply be left alone.
 *
 * Run: node scripts/import-public-css.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const SRC = 'C:/Users/murta/Downloads/bolt landing page 2/project/src/styles';
const OUT = 'src/styles/public';
const SCOPE = '.nm-public';

/** Selectors that mean "the document" and therefore become the wrapper itself. */
const ROOTISH = new Set([':root', 'html', 'body', 'html, body']);

/**
 * Split a selector list on commas that are not inside brackets or parens.
 * `:is(a, b)` and `[attr="x,y"]` must survive intact.
 */
function splitSelectors(list) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const ch of list) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function scopeOne(sel) {
  const s = sel.trim();
  if (!s) return s;
  // Already ours, or a keyframe step, or a nested-at-rule preamble.
  if (s.startsWith('.nm-public')) return s;
  if (/^\d/.test(s) || s === 'from' || s === 'to') return s; // keyframe offsets
  if (ROOTISH.has(s)) return SCOPE;
  // `*`, `*::before`, `::selection`, `:focus-visible`, `::-webkit-scrollbar…`
  // and every bare element selector all become descendants of the wrapper.
  return `${SCOPE} ${s}`;
}

function scopeSelectorList(list) {
  return splitSelectors(list).map(scopeOne).join(', ');
}

/**
 * Walk the stylesheet character by character rather than with a regex.
 * Selectors can contain braces inside `[attr="{"]`, and at-rules nest, so a
 * regex over the whole file gets this wrong in ways that are silent.
 */
function transform(css) {
  let out = '';
  let buf = '';
  let i = 0;
  // Depth of at-rule blocks whose children are selectors we must scope
  // (`@media`, `@supports`) versus ones we must not (`@keyframes`).
  const stack = [];

  while (i < css.length) {
    const ch = css[i];

    // Comments pass through untouched, and go straight to the output rather
    // than into the selector buffer. Accumulating them was a real bug: a
    // comment sitting above a rule became part of the preamble, so the commas
    // *inside the comment* were treated as selector separators — which
    // rewrote prose into `.nm-public cinematic` and, worse, left the `:root`
    // that followed it unscoped, defeating the entire point of the script.
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === '{') {
      const preamble = buf.trim();
      buf = '';
      if (preamble.startsWith('@')) {
        const isKeyframes = /^@(-\w+-)?keyframes\b/.test(preamble);
        stack.push(isKeyframes ? 'keyframes' : 'group');
        out += `${preamble} {`;
      } else {
        const inKeyframes = stack[stack.length - 1] === 'keyframes';
        out += `${inKeyframes ? preamble : scopeSelectorList(preamble)} {`;
        stack.push('decl');
      }
      i++;
      continue;
    }

    if (ch === '}') {
      out += buf;
      buf = '';
      stack.pop();
      out += '}\n';
      i++;
      continue;
    }

    if (ch === ';' && buf.trim().startsWith('@')) {
      // A statement at-rule: `@import …;`
      const stmt = buf.trim();
      // Font packages are replaced by next/font — see the marketing layout.
      if (!/^@import\s+["']?@fontsource/.test(stmt)) out += `${stmt};`;
      buf = '';
      i++;
      continue;
    }

    buf += ch;
    i++;
  }

  return out + buf;
}

mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC).filter((f) => f.endsWith('.css'));
let total = 0;

for (const file of files) {
  const src = readFileSync(join(SRC, file), 'utf8');
  const transformed = transform(src);
  const header =
    `/* Generated by scripts/import-public-css.mjs from the uploaded\n` +
    `   public-experience project. Do not edit by hand — re-run the script.\n` +
    `   Every global selector is scoped to \`${SCOPE}\`; see the script's header\n` +
    `   for why that is required rather than optional. */\n\n`;
  writeFileSync(join(OUT, basename(file)), header + transformed);
  total += transformed.length;
  console.log(`  ${file.padEnd(18)} ${src.length} → ${transformed.length}`);
}

console.log(`\n  ${files.length} stylesheets, ${total} bytes, scoped to ${SCOPE}`);
