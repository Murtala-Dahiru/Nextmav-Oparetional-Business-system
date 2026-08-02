/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Session lifetime policy
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What was here before ──────────────────────────────────────────────────
 *
 *  Nothing. Supabase issues a refresh token and renews it on demand for as
 *  long as anything keeps asking, and something always does: the notification
 *  tray polls every thirty seconds. A browser left open on a dashboard stayed
 *  signed in indefinitely — across days, across a closed laptop lid, across
 *  whoever sat down at that desk next. "Remain signed in during active use"
 *  was satisfied; the other half of the sentence was not implemented.
 *
 *  ── Two clocks, because one cannot express the rule ───────────────────────
 *
 *  IDLE is the one people mean by "session timeout": time since the user last
 *  did something. It is what protects an unattended screen, and it resets
 *  whenever they act.
 *
 *  ABSOLUTE is a ceiling on the whole session regardless of activity. Without
 *  it a stolen refresh token is good forever provided the thief keeps using
 *  it — the idle clock never expires for someone who is *always* active.
 *  Re-authenticating once a day is the price of that being untrue.
 *
 *  Both are enforced in `proxy.ts`, on the server, before a request reaches a
 *  handler. The browser's countdown is a courtesy so that expiry is announced
 *  rather than discovered; it is not the control.
 *
 *  ── Why the idle clock ignores polling ────────────────────────────────────
 *
 *  The tray polls, presence beats, realtime reconnects. If any of that counted
 *  as activity the idle window would never close and this file would be
 *  decoration. Background requests carry `x-nm-background: 1` and the proxy
 *  reads the deadline without extending it — so an open tab keeps working
 *  right up to the moment nobody has touched it for long enough, and then
 *  stops.
 *
 *  That does mean a person can extend their own session by moving the mouse,
 *  which is exactly what it is supposed to mean. The threat this addresses is
 *  an unattended workstation, not a user determined to stay signed in.
 */

/** Time since the last deliberate action, after which we re-authenticate. */
export const IDLE_TIMEOUT_MS = minutes(
  Number(process.env.NEXT_PUBLIC_SESSION_IDLE_MINUTES) || 30,
);

/** Ceiling on any one session, however active. */
export const ABSOLUTE_TIMEOUT_MS = minutes(
  Number(process.env.NEXT_PUBLIC_SESSION_ABSOLUTE_MINUTES) || 12 * 60,
);

/** How long before expiry the browser starts warning. */
export const WARNING_LEAD_MS = minutes(
  Number(process.env.NEXT_PUBLIC_SESSION_WARNING_MINUTES) || 2,
);

function minutes(n: number): number {
  return Math.max(1, n) * 60_000;
}

/**
 * The two clocks, as cookies.
 *
 * httpOnly, so the countdown in the browser cannot quietly reset them and the
 * only thing that moves the idle deadline is a request the proxy has decided
 * counts. Not `Secure` in development, because localhost is not https and a
 * Secure cookie there is simply never sent — which would expire every session
 * on the first navigation.
 */
export const SESSION_COOKIES = {
  /** When this session began. Fixed for its lifetime. */
  started: 'nm-session-started',
  /** When the user was last deliberately active. Moves forward. */
  seen: 'nm-session-seen',
} as const;

/**
 * Header a client sets on requests that must not count as activity.
 *
 * Polling, presence heartbeats, prefetches — anything the machine does on its
 * own. Naming it rather than pattern-matching the URL keeps the decision with
 * the caller that knows why it is calling.
 */
export const BACKGROUND_HEADER = 'x-nm-background';

/** Why a session ended, carried to the login screen so it can say so. */
export type ExpiryReason = 'idle' | 'absolute';

export const EXPIRY_MESSAGES: Record<ExpiryReason, string> = {
  idle: 'You were signed out after a period of inactivity. Sign in to continue.',
  absolute: 'Your session reached its maximum length and ended. Sign in to continue.',
};

export interface SessionClock {
  startedAt: number;
  lastSeenAt: number;
}

/**
 * Has this session run out, and on which clock?
 *
 * Pure, so the proxy and the browser countdown answer the question the same
 * way rather than each carrying their own arithmetic.
 */
export function expiryOf(clock: SessionClock, now = Date.now()): ExpiryReason | null {
  if (now - clock.startedAt >= ABSOLUTE_TIMEOUT_MS) return 'absolute';
  if (now - clock.lastSeenAt >= IDLE_TIMEOUT_MS) return 'idle';
  return null;
}

/** Milliseconds until this session ends if nothing else happens. */
export function millisUntilExpiry(clock: SessionClock, now = Date.now()): number {
  return Math.max(
    0,
    Math.min(
      clock.startedAt + ABSOLUTE_TIMEOUT_MS - now,
      clock.lastSeenAt + IDLE_TIMEOUT_MS - now,
    ),
  );
}

export const SESSION_POLICY_SUMMARY = {
  idleMinutes: IDLE_TIMEOUT_MS / 60_000,
  absoluteMinutes: ABSOLUTE_TIMEOUT_MS / 60_000,
  warningMinutes: WARNING_LEAD_MS / 60_000,
} as const;
