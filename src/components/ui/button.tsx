import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
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
        cta: "bg-ink text-ink-fg shadow-sm hover:bg-ink-hover active:scale-[0.985]",
        ctaOutline:
          "border-hairline-strong text-foreground hover:bg-surface-2 border bg-transparent active:scale-[0.985]",
        /** For use on `tone=\"ink\"` panels, where an ink fill would vanish. */
        onInk: "bg-ink-fg text-ink shadow-sm hover:bg-ink-fg/90 active:scale-[0.985]",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        /** Marketing scale. One height for every hero and CTA on the site. */
        xl: "h-11 rounded-lg px-6 text-[0.9375rem] has-[>svg]:px-5",
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
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
