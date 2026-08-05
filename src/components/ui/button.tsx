import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * ── The focus ring, and why this line changed ──────────────────────────────
 *
 * The base used to carry `outline-none focus-visible:border-ring
 * focus-visible:ring-ring/50 focus-visible:ring-[3px]`. Three consequences,
 * none of them intended:
 *
 *   1. `outline-none` cancelled the one designed focus treatment in the
 *      product — the 2px accent outline in `globals.css` — for every button
 *      on the site. Sixty-one importers, zero of them receiving it.
 *   2. What replaced it was `--ring` at 50% opacity: a grey, on grey, at half
 *      strength. That is a keyboard user's only means of knowing where they
 *      are.
 *   3. `focus-visible:border-ring` moved the *border* as well, so a focused
 *      outline button changed shape by a pixel.
 *
 * Removing the override lets the global rule apply. It is a repair, not a
 * redesign: every button in the authenticated application gets a visible
 * focus ring out of this, which is the correct blast radius for an
 * accessibility defect.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",

        /* ── Marketing actions ────────────────────────────────────────────
           Added rather than replacing anything: the product app's buttons
           keep the variants they already use.

           These exist because every call to action on the site was written as
           `<Button className="bg-emerald-500 hover:bg-emerald-600 text-white
           h-12 px-8">` — the same six utilities repeated across eleven files,
           which is how the landing page's CTA and the pricing page's CTA came
           to be two different heights. A named variant is the difference
           between a design decision and a copied string.

           The primary action is ink, not the accent colour. A saturated
           button competing with a saturated heading and a saturated icon tile
           is why the old pages had no focal point; when one element is filled
           and everything else is quiet, the reader's eye has somewhere to go. */
        /* Hover moves by a real step on the ramp — `n-11` to `n-10` — rather
           than by an opacity. A translucent button picks up whatever is
           behind it, which on a tinted band is a different colour from the
           same button on the page, so "hover" ends up meaning two things.
           Disabled drops to a neutral fill instead of going see-through. */
        cta: "bg-ink text-ink-fg rounded-control shadow-e1 hover:bg-ink-hover active:scale-[0.985] disabled:bg-n-5 disabled:text-n-7 disabled:opacity-100 disabled:cursor-not-allowed disabled:shadow-none",
        ctaOutline:
          "border-hairline-strong text-foreground hover:bg-surface-2 hover:border-n-5 rounded-control border bg-transparent active:scale-[0.985] disabled:border-n-4 disabled:text-n-6 disabled:opacity-100 disabled:cursor-not-allowed",
        /** For use on `tone=\"ink\"` panels, where an ink fill would vanish. */
        onInk:
          "bg-ink-fg text-ink rounded-control shadow-e1 hover:bg-n-2 active:scale-[0.985] disabled:opacity-40 disabled:cursor-not-allowed",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        /** Marketing scale. One height for every hero and CTA on the site. */
        xl: "h-11 rounded-control px-6 text-body has-[>svg]:px-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /**
     * Shows a spinner and holds the button's width.
     *
     * Swapping the label for "Sending…" is the usual approach and it resizes
     * the control mid-action, so the thing under the user's cursor moves at
     * the exact moment they are watching it. Here the label stays in the
     * layout at `invisible` — it still occupies its box, so the width is the
     * width — and the spinner is positioned over it. `aria-busy` and
     * `aria-live` carry the state to a screen reader, which a spinner alone
     * does not.
     *
     * Opt-in, so the sixty-one existing call sites are unaffected.
     */
    loading?: boolean
  }) {
  const Comp = asChild ? Slot : "button"
  // `Slot` forwards to a single child, so the spinner's extra elements would
  // break it. A link rendered `asChild` has no loading state to show anyway.
  const busy = loading && !asChild

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }), busy && "relative")}
      disabled={disabled ?? (busy || undefined)}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? (
        <>
          <span className="invisible contents">{children}</span>
          <span className="absolute inset-0 grid place-items-center" aria-hidden="true">
            <Loader2 className="size-4 animate-spin" />
          </span>
          <span className="sr-only" aria-live="polite">
            Working…
          </span>
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
