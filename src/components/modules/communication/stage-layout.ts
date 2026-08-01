/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Fitting video tiles into the space there actually is
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is arithmetic and not a set of breakpoints ──────────────────
 *
 * The meeting grid used Tailwind column classes: one column for one person,
 * two from the `sm` breakpoint, three from `lg`. Columns divide the *width*.
 * The tiles are 16:9, so their height follows from that width and nothing
 * bounds it — and on a desktop, one participant got a tile as wide as the room
 * and 56% of that tall, which is taller than the room. The overflow pushed the
 * control bar off the bottom of the screen, so in a one-to-one call — the most
 * common call there is — the mute and leave buttons could not be reached.
 *
 * No arrangement of column classes fixes that, because the binding constraint
 * is the height and CSS columns cannot see it. The fix is to measure the stage
 * and choose the tile size: for every possible column count, work out the width
 * a tile would get, the height that implies for the rows it needs, and keep
 * whichever arrangement produces the largest tile that still fits in both
 * directions.
 *
 * That is one short loop, and it is the only approach that behaves on a phone
 * held upright, a laptop, and a wide monitor with the participant panel open,
 * without a special case for each. It also responds to the panel opening and
 * to the window being resized — neither of which a media query on the viewport
 * can observe, because neither changes the viewport.
 *
 * Pure and separate from the component so it can be checked directly:
 * `npm run test:layout`.
 */

export interface StageFit {
  /** How many tiles across. */
  cols: number;
  /** How wide each tile should be, in pixels. Zero before the first measure. */
  width: number;
}

/**
 * The largest tile size that fits `count` 16:9 tiles into `width` × `height`.
 *
 * Returns `{ cols: 1, width: 0 }` when there is nothing to lay out or the box
 * has not been measured yet, which the caller renders as a plain CSS grid for
 * the single frame before the observer reports.
 */
export function fitTiles(
  count: number,
  width: number,
  height: number,
  gap: number,
): StageFit {
  if (count < 1 || width < 80 || height < 80) return { cols: 1, width: 0 };

  let best: StageFit = { cols: 1, width: 0 };

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const byWidth = (width - gap * (cols - 1)) / cols;
    // The width a tile would have if the rows were what limited it.
    const byHeight = ((height - gap * (rows - 1)) / rows) * (16 / 9);
    const tile = Math.min(byWidth, byHeight);
    if (tile > best.width) best = { cols, width: tile };
  }

  return best;
}

/**
 * The largest a lone tile is allowed to get.
 *
 * With nobody else in the room the fit has the whole stage to play with and
 * would hand a single webcam a 1600px tile on a wide monitor, which reads as a
 * mistake rather than as a decision. Capped; the stage stays centred around it.
 */
export const SOLO_MAX = 720;

/**
 * Below this a tile says nothing, so the stage scrolls rather than shrinking.
 *
 * Twenty people at forty pixels each is not a smaller version of the layout.
 */
export const TILE_MIN = 132;

/** The gap between tiles. A number, because the fit has to do sums with it. */
export const TILE_GAP = 12;
