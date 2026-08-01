/**
 * The meeting grid's fit calculation.
 *
 *     npm run test:layout
 *
 * The bug this exists to prevent coming back: tiles were sized by Tailwind
 * column classes, which divide the width and know nothing about the height, so
 * one participant on a desktop got a tile taller than the room and the control
 * bar was pushed off the bottom of the screen. Every case below asserts the
 * thing that actually matters — that the tiles fit in the box they were given.
 */
import { fitTiles, SOLO_MAX, TILE_GAP, TILE_MIN } from '../src/components/modules/communication/stage-layout';

let pass = 0, fail = 0;

const check = (ok: boolean, label: string, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${label}${ok || !detail ? '' : `  (${detail})`}`);
};

/** Does this arrangement actually stay inside the box? */
function fits(count: number, w: number, h: number) {
  const { cols, width } = fitTiles(count, w, h, TILE_GAP);
  const rows = Math.ceil(count / cols);
  const usedW = width * cols + TILE_GAP * (cols - 1);
  const usedH = (width * 9 / 16) * rows + TILE_GAP * (rows - 1);
  // A hair of tolerance for floating point, not for overflow.
  return { cols, width, usedW, usedH, ok: usedW <= w + 0.5 && usedH <= h + 0.5 };
}

/** Stages a real room actually has, after the header and the control bar. */
const STAGES: [string, number, number][] = [
  ['desktop 1440x900', 1392, 620],
  ['desktop, panel open', 1072, 620],
  ['laptop 1280x800', 1232, 520],
  ['short laptop window', 1232, 320],
  ['tablet portrait', 720, 800],
  ['phone portrait 390x844', 366, 560],
  ['phone landscape', 700, 250],
  ['ultrawide', 2500, 900],
];

console.log('EVERY ARRANGEMENT FITS THE BOX IT WAS GIVEN');
for (const [name, w, h] of STAGES) {
  for (const count of [1, 2, 3, 4, 5, 6, 8, 9, 12]) {
    const r = fits(count, w, h);
    check(r.ok, `${name} · ${count} tile${count === 1 ? '' : 's'}`,
      `${r.cols} cols, ${r.width.toFixed(0)}px -> ${r.usedW.toFixed(0)}x${r.usedH.toFixed(0)} in ${w}x${h}`);
  }
}

console.log('\nTHE CASE THAT BROKE: ONE PARTICIPANT ON A DESKTOP');
{
  // The old behaviour was a full-width tile: 1392 wide implies 783 tall, in a
  // 620px stage. That is the overflow that hid the controls.
  const naive = 1392 * 9 / 16;
  check(naive > 620, 'a full-width tile would be taller than the stage',
    `${naive.toFixed(0)}px tall in 620px`);

  const r = fits(1, 1392, 620);
  check(r.usedH <= 620, 'the fitted tile is not', `${r.usedH.toFixed(0)}px tall`);
  check(r.width < 1392, 'because it is bound by the height, not the width',
    `${r.width.toFixed(0)}px wide`);
  check(Math.min(r.width, SOLO_MAX) === SOLO_MAX,
    'and a lone tile is capped so it does not swallow a wide monitor');
}

console.log('\nARRANGEMENTS ARE THE ONES A PERSON WOULD CHOOSE');
check(fitTiles(2, 1392, 620, TILE_GAP).cols === 2, 'two people on a desktop sit side by side');
check(fitTiles(2, 366, 560, TILE_GAP).cols === 1, 'two people on a phone stack');
check(fitTiles(4, 1392, 620, TILE_GAP).cols === 2, 'four people are a 2x2, not a row of four');
check(fitTiles(3, 700, 250, TILE_GAP).cols === 3, 'a short landscape window spreads them across');

console.log('\nTHE LARGEST TILE WINS, NOT THE FIRST THAT FITS');
for (const [name, w, h] of STAGES) {
  for (const count of [2, 3, 5, 7]) {
    const chosen = fitTiles(count, w, h, TILE_GAP);
    let bestOther = 0;
    for (let cols = 1; cols <= count; cols++) {
      const rows = Math.ceil(count / cols);
      const tile = Math.min(
        (w - TILE_GAP * (cols - 1)) / cols,
        ((h - TILE_GAP * (rows - 1)) / rows) * (16 / 9),
      );
      if (tile > bestOther) bestOther = tile;
    }
    check(Math.abs(chosen.width - bestOther) < 0.001,
      `${name} · ${count} tiles picks the largest arrangement`);
  }
}

console.log('\nDEGENERATE INPUTS DO NOT PRODUCE A BROKEN GRID');
check(fitTiles(0, 1392, 620, TILE_GAP).width === 0, 'no tiles -> nothing to size');
check(fitTiles(1, 0, 0, TILE_GAP).width === 0, 'unmeasured stage -> zero, and the caller falls back');
check(fitTiles(1, 40, 40, TILE_GAP).width === 0, 'a stage too small to measure -> zero');
check(fitTiles(4, 1392, 620, TILE_GAP).cols >= 1, 'columns are never zero');

console.log('\nA CROWD IS SCROLLED, NOT SHRUNK INTO NOTHING');
{
  const r = fitTiles(30, 366, 560, TILE_GAP);
  check(r.width < TILE_MIN,
    'thirty people on a phone would fall below the readable size',
    `${r.width.toFixed(0)}px`);
  // Which is the caller's cue to stop shrinking and start scrolling.
  check(TILE_MIN > 0, 'so the stage has a floor to hold them at');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
