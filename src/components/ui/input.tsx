import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * ── The focus override, removed ────────────────────────────────────────────
 *
 * Same defect as `button.tsx`: `outline-none` plus a grey `--ring` at 50%
 * cancelled the designed accent outline for every input in the product. The
 * override is gone, so the global `:focus-visible` rule applies.
 *
 * `focus-visible:border-ring` has gone with it and been replaced by an
 * explicit border colour change. Focus now reads as two things at once — the
 * border darkens to the accent, and the outline appears outside it — which is
 * what the specification asks for and what makes a focused field obvious on a
 * page of unfocused ones.
 *
 * ── On `h-9` ───────────────────────────────────────────────────────────────
 *
 * Unchanged, deliberately. Thirty-five importers, nearly all of them in the
 * authenticated application, where the control height is load-bearing against
 * table rows and toolbars. The Phase 1 surface wants 44px to match its
 * buttons; it gets there through `size="lg"` below rather than by moving the
 * default out from under the app.
 */
function Input({
  className,
  type,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"input">, "size"> & {
  /** `lg` is the Phase 1 form scale: 44px, matching `Button size="xl"`. */
  size?: "default" | "lg"
}) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex w-full min-w-0 border bg-transparent transition-[color,box-shadow,border-color] file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        size === "lg"
          ? "rounded-control h-11 px-3.5 py-2 text-base md:text-body"
          : "rounded-md h-9 px-3 py-1 text-base shadow-xs md:text-sm",
        "focus-visible:border-brand",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
