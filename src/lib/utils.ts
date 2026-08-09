import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  cn — class merge
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Why this is no longer a bare `twMerge` ───────────────────────────────
 *
 *  tailwind-merge resolves conflicts by working out which *group* a utility
 *  belongs to. For `text-*` that is genuinely ambiguous — `text-sm` is a font
 *  size and `text-red-500` is a colour — so it decides by checking the value
 *  against the sizes it knows about. It knows Tailwind's defaults. It does not
 *  know ours.
 *
 *  So every Phase 1 type token — `text-label`, `text-body`, `text-caption`,
 *  `text-title` — was being classified as a *colour*, landing in the same
 *  group as `text-copy-3`, and the two were treated as a conflict where only
 *  the last one survives.
 *
 *  The symptom, found in the browser: the eyebrow on the landing page's ink
 *  section rendered at **16px with normal tracking** instead of 12px at
 *  +0.06em, because `<Eyebrow className="text-copy-on-ink-2">` merged down to
 *  just the colour and silently dropped `text-label`.
 *
 *  It only bites classes that pass through `cn()` — a literal `className`
 *  string in JSX never reaches tailwind-merge — which is exactly why it was
 *  invisible. The pages looked right; the components did not, and components
 *  are the part that repeats.
 *
 *  Registering the custom scales below makes the grouping correct. Anything
 *  added to `@theme` in `globals.css` must be added here too, or it will be
 *  silently mis-grouped in precisely this way.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      /* Type scale — `--text-*` in globals.css. */
      "font-size": [
        {
          text: [
            "display-1",
            "display-2",
            "display-3",
            "title",
            "lede",
            "body",
            "body-sm",
            "caption",
            "label",
          ],
        },
      ],

      /* Colours — the semantic aliases and the raw neutral ramp.
         `text-copy` and friends are text colours; the ramp is addressable
         directly for the cases where a semantic name would be a lie. */
      "text-color": [
        {
          text: [
            "copy",
            "copy-2",
            "copy-3",
            "copy-on-ink",
            "copy-on-ink-2",
            "accent-on-ink",
            "ink",
            "ink-fg",
            "brand",
            "brand-fg",
            "n-0",
            "n-1",
            "n-2",
            "n-3",
            "n-4",
            "n-5",
            "n-6",
            "n-7",
            "n-8",
            "n-9",
            "n-10",
            "n-11",
          ],
        },
      ],

      /* Elevation — `--shadow-e*`. Without this, `shadow-e2` is read as a
         shadow *colour* and cannot override `shadow-e1`. */
      "shadow": [{ shadow: ["e1", "e2", "e3"] }],

      /* Radius — two values and a pill, per the nesting rule. */
      "rounded": [{ rounded: ["control", "surface"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
