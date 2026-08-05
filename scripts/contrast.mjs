/**
 * OKLCH → sRGB → WCAG contrast, for the Phase 1 token ramp.
 *
 * Written because the design document asserted ratios that had never been
 * computed. Every number published in DESIGN-SYSTEM.md now comes out of this
 * file, so a token change that breaks AA fails here rather than in an audit.
 *
 *   node scripts/contrast.mjs            # the table
 *   node scripts/contrast.mjs --check    # exit 1 if any required pair fails
 *
 * Conversion is Björn Ottosson's OKLab matrices. Out-of-gamut colours are
 * clipped in *linear* sRGB before luminance is taken, because the ratio that
 * matters is the one the display actually produces, not the one the maths
 * would produce on an imaginary monitor.
 */

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** OKLCH (L 0–1, C, H degrees) → linear sRGB, gamut-clipped. */
function oklchToLinearRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const encode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

const hex = (lin) =>
  '#' +
  lin
    .map((c) =>
      Math.round(clamp01(encode(c)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

/** WCAG 2.1 relative luminance, from clipped linear sRGB. */
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ── The ramp ───────────────────────────────────────────────────────────────
// Single hue (255). Chroma peaks in the mid-tones and tapers at both ends:
// near-white and near-black cannot hold chroma without reading as tinted
// rather than as a considered neutral.

const light = {
  'n-0': [0.994, 0.002, 255],
  'n-1': [0.982, 0.004, 255],
  'n-2': [0.965, 0.006, 255],
  'n-3': [0.92, 0.009, 255],
  'n-4': [0.872, 0.011, 255],
  'n-5': [0.826, 0.012, 255],
  'n-6': [0.715, 0.014, 255],
  'n-7': [0.598, 0.018, 255],
  'n-8': [0.487, 0.02, 255],
  'n-9': [0.4, 0.019, 255],
  'n-10': [0.243, 0.014, 255],
  'n-11': [0.168, 0.012, 255],
  accent: [0.505, 0.095, 173],
  'accent-hover': [0.44, 0.09, 173],
  'accent-soft': [0.966, 0.019, 173],
  'accent-line': [0.888, 0.04, 173],
  // An ink panel inverts with the mode: it is near-black on a light page and
  // near-white on a dark one. So the accent sitting on it has to be the
  // *other* mode's accent, not this one's. Reusing `accent` here is what put
  // a light teal tick on a near-white panel in dark mode at 1.88:1.
  'accent-on-ink': [0.755, 0.115, 173],
  destructive: [0.577, 0.245, 27.325],
};

const dark = {
  'n-0': [0.168, 0.012, 255],
  'n-1': [0.203, 0.013, 255],
  'n-2': [0.243, 0.014, 255],
  'n-3': [0.295, 0.014, 255],
  'n-4': [0.355, 0.015, 255],
  'n-5': [0.44, 0.016, 255],
  'n-6': [0.52, 0.016, 255],
  'n-7': [0.62, 0.016, 255],
  'n-8': [0.7, 0.016, 255],
  'n-9': [0.8, 0.012, 255],
  'n-10': [0.89, 0.008, 255],
  'n-11': [0.965, 0.004, 255],
  accent: [0.755, 0.115, 173],
  'accent-hover': [0.815, 0.105, 173],
  'accent-soft': [0.272, 0.036, 173],
  'accent-line': [0.372, 0.05, 173],
  'accent-on-ink': [0.505, 0.095, 173],
  destructive: [0.704, 0.191, 22.216],
};

const rgb = (mode, key) => oklchToLinearRgb(...mode[key]);

/**
 * Every pair that carries text or a boundary on the Phase 1 surface.
 *
 * `min` is the threshold this pair must clear:
 *   4.5 — body text
 *   3   — large text (≥24px, or ≥18.66px semibold), icons, focus rings,
 *         and any boundary a user must be able to see
 */
const pairs = [
  // Text on the page
  ['text primary on background', 'n-11', 'n-0', 4.5],
  ['text secondary on background', 'n-9', 'n-0', 4.5],
  ['text tertiary on background', 'n-8', 'n-0', 4.5],
  ['text primary on surface', 'n-11', 'n-1', 4.5],
  ['text secondary on surface', 'n-9', 'n-1', 4.5],
  ['text tertiary on surface', 'n-8', 'n-1', 4.5],
  ['text tertiary on surface-2', 'n-8', 'n-2', 4.5],
  // Large text only — this is the step that must never carry body copy
  ['n-7 as large text on background', 'n-7', 'n-0', 3],
  // Accent
  ['accent on background', 'accent', 'n-0', 4.5],
  ['accent on surface', 'accent', 'n-1', 4.5],
  ['accent on accent-soft', 'accent', 'accent-soft', 4.5],
  ['accent hover on background', 'accent-hover', 'n-0', 4.5],
  // Inverted (the ink panel and the primary button)
  ['background on ink', 'n-0', 'n-11', 4.5],
  ['n-5 on ink (tertiary, inverted)', 'n-5', 'n-11', 4.5],
  ['accent-on-ink on ink', 'accent-on-ink', 'n-11', 3],
  // Boundaries and states
  ['hairline on background', 'n-3', 'n-0', 1.2],
  ['hairline-strong on background', 'n-4', 'n-0', 1.4],
  ['focus ring on background', 'accent', 'n-0', 3],
  ['focus ring on surface', 'accent', 'n-1', 3],
  ['error text on background', 'destructive', 'n-0', 4.5],
];

let failed = 0;
const rows = [];

for (const mode of ['light', 'dark']) {
  const M = mode === 'light' ? light : dark;
  for (const [name, fg, bg, min] of pairs) {
    // Ink inverts between modes: in dark mode the strongest fill is n-11 and
    // the text on it is n-0, so the two inverted pairs swap rather than being
    // re-listed. Everything else reads the same key in both ramps.
    const a = rgb(M, fg);
    const b = rgb(M, bg);
    const ratio = contrast(a, b);
    const pass = ratio >= min;
    if (!pass) failed++;
    rows.push({
      mode,
      name,
      fg: `${fg} ${hex(a)}`,
      bg: `${bg} ${hex(b)}`,
      ratio: ratio.toFixed(2),
      min: min.toFixed(1),
      pass,
    });
  }
}

const w = (s, n) => String(s).padEnd(n);
console.log(
  `\n${w('MODE', 6)}${w('PAIR', 34)}${w('FOREGROUND', 18)}${w('BACKGROUND', 18)}${w('RATIO', 8)}${w('MIN', 6)}RESULT`,
);
console.log('─'.repeat(98));
for (const r of rows) {
  console.log(
    `${w(r.mode, 6)}${w(r.name, 34)}${w(r.fg, 18)}${w(r.bg, 18)}${w(r.ratio + ':1', 8)}${w(r.min, 6)}${r.pass ? 'pass' : 'FAIL'}`,
  );
}

console.log('─'.repeat(98));
console.log(
  failed === 0
    ? `\nAll ${rows.length} pairs clear their threshold.\n`
    : `\n${failed} of ${rows.length} pairs FAIL.\n`,
);

if (process.argv.includes('--check') && failed > 0) process.exit(1);
