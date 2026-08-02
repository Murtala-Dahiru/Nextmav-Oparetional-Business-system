'use client';

import { useCallback, useState } from 'react';

/**
 * Blur-gated validation for a small form.
 *
 * ── The rule being implemented ───────────────────────────────────────────
 *
 * Validate on blur, not on keystroke — `inline-validation` in the skill's
 * forms rules. The distinction is not pedantry: validating per keystroke means
 * an email field reads "that address is missing an @" from the first character
 * until the last, so the interface spends the whole interaction telling
 * somebody off for not having finished typing. By the time the message is
 * true, it has been ignored for twenty keystrokes.
 *
 * ── Why the errors themselves live outside ───────────────────────────────
 *
 * This hook owns *when* an error may be shown, never *what* it says. Each form
 * computes its own error map from its own state, which keeps the messages
 * beside the fields they describe and avoids a schema layer that would have to
 * be kept in step with the server's rules — the exact drift that produced a
 * signup form promising an acceptance the API refused.
 */
export function useFieldErrors<T extends string>() {
  const [touched, setTouched] = useState<Partial<Record<T, boolean>>>({});

  /** Mark one field as finished with. Wire to `onBlur`. */
  const blur = useCallback((field: T) => {
    setTouched((t) => ({ ...t, [field]: true }));
  }, []);

  /**
   * Reveal every outstanding error at once and focus the first.
   *
   * Called on a submit attempt that fails validation. Revealing them one at a
   * time — which is what a per-field toast does — means a form with three
   * problems takes three attempts to discover them.
   *
   * Focusing the first invalid field is `focus-management` in the skill's
   * rules, and it is the difference between "fix this" and "guess again": on a
   * long form the offending field may be off-screen, and an error nobody
   * scrolls to is an error nobody sees.
   */
  const revealAll = useCallback(
    (fields: readonly T[], errors: Partial<Record<T, string | null>>, idPrefix: string) => {
      setTouched(Object.fromEntries(fields.map((f) => [f, true])) as Record<T, boolean>);
      const firstBad = fields.find((f) => errors[f]);
      if (firstBad) {
        const el = document.getElementById(`${idPrefix}${firstBad}`);
        el?.focus();
        // `focus()` alone does not always bring a field into view when it sits
        // above the fold of a scrolled container.
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      return !firstBad;
    },
    [],
  );

  const reset = useCallback(() => setTouched({}), []);

  /** True only once the field has been left *and* is actually wrong. */
  const showing = useCallback(
    (field: T, error: string | null | undefined) => (touched[field] ? (error ?? null) : null),
    [touched],
  );

  return { touched, blur, revealAll, reset, showing };
}
