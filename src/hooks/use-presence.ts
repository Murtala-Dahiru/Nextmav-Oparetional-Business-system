'use client';

import { useEffect, useRef } from 'react';
import { BACKGROUND_HEADER } from '@/lib/session-policy';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Reporting that you are here
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Mounted once, in the application shell. Everything that *displays* presence
 * reads `/api/presence`; this is the only thing that writes it.
 *
 * ── The three states, and how each is decided ─────────────────────────────
 *
 *   online   the tab is visible and something has happened recently
 *   away     the tab is open but idle, or hidden
 *   offline  no heartbeat has arrived for longer than the configured window
 *
 * The first two are reported by the browser, because only the browser knows
 * whether anyone is actually there. The third is *never* reported — it is
 * derived by the server from the absence of heartbeats, because a browser that
 * crashes, a laptop lid that closes and a network that drops all have one thing
 * in common: no opportunity to say goodbye. A product that trusts a client to
 * announce its own disappearance is the one that leaves people showing as
 * online for days.
 *
 * The `pagehide` beacon below is therefore an optimisation, not the mechanism.
 * When it works, somebody who closes a tab greys out immediately instead of two
 * minutes later; when it does not, the heartbeat going stale gets there anyway.
 */

/**
 * How often to beat.
 *
 * Deliberately shorter than half the server's default offline window (120s), so
 * a single dropped request cannot make somebody flicker offline while they are
 * sitting there. Raising this without raising `offlineAfterSeconds` in the
 * organisation's presence policy would do exactly that.
 */
const BEAT_MS = 45_000;

/**
 * How long without a pointer, a key or a focus before the tab calls itself idle.
 *
 * The server applies the organisation's own `awayAfterMinutes` on top of
 * `last_active_at`, so this is the client's fast path rather than the rule: it
 * lets a tab report `away` promptly instead of waiting for the server to notice
 * that `last_active_at` has stopped moving.
 */
const IDLE_MS = 5 * 60_000;

/** Events that count as a person being present. */
const ACTIVITY = ['pointerdown', 'keydown', 'pointermove', 'wheel', 'touchstart'] as const;

export function usePresence(enabled: boolean) {
  /**
   * Held in refs, not state.
   *
   * None of this is rendered — it exists to decide what to send — and putting
   * it in state would re-render the entire application shell on every mouse
   * move, which is the opposite of what a presence indicator should cost.
   */
  const lastActivity = useRef(Date.now());
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;

    const markActive = () => { lastActivity.current = Date.now(); };

    /**
     * Send a beat.
     *
     * `force` is for transitions — going from away to online should be visible
     * at once rather than at the next interval. Otherwise an unchanged status is
     * still sent, because the heartbeat *is* the liveness signal: skipping it
     * because nothing changed is precisely how somebody sitting still at their
     * desk would be reported offline.
     */
    const beat = async (status: 'online' | 'away', active: boolean) => {
      if (stopped) return;
      lastSent.current = status;
      try {
        await fetch('/api/presence', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            /**
             * The beat must not keep the session alive.
             *
             * It fires every forty-five seconds whether or not anybody is
             * there — that is the entire point of it — so if it counted as
             * activity the idle timeout would never elapse for any open tab
             * and the whole policy would be decoration. The status it reports
             * is already `away` when nobody is touching anything.
             */
            [BACKGROUND_HEADER]: '1',
          },
          body: JSON.stringify({ status, active }),
          // A heartbeat must never hold up navigation or retry noisily.
          keepalive: true,
        });
      } catch {
        // A failed beat is not worth reporting. The next one is 45 seconds away,
        // and the server's window tolerates two missed in a row.
      }
    };

    const tick = () => {
      const idle = Date.now() - lastActivity.current > IDLE_MS;
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      const status = idle || hidden ? 'away' : 'online';
      void beat(status, status === 'online');
    };

    // Immediately, so opening the application shows you as online at once
    // rather than up to forty-five seconds later.
    tick();
    const timer = setInterval(tick, BEAT_MS);

    for (const evt of ACTIVITY) {
      window.addEventListener(evt, markActive, { passive: true });
    }

    /**
     * Coming back to the tab beats immediately rather than waiting.
     *
     * This is the transition people notice: someone switches back to the
     * application and expects the person they are talking to — and themselves —
     * to be current straight away.
     */
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        markActive();
        void beat('online', true);
      } else {
        void beat('away', false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    /**
     * Leaving.
     *
     * `pagehide` rather than `beforeunload`: the latter is unreliable on mobile
     * and is ignored entirely when a tab is discarded, whereas `pagehide` fires
     * for the back/forward cache too. `sendBeacon` because a normal fetch is
     * cancelled when the document goes away — that is its entire purpose.
     */
    const onLeave = () => {
      try {
        navigator.sendBeacon?.(
          '/api/presence',
          new Blob([JSON.stringify({ status: 'offline', active: false })], {
            type: 'application/json',
          }),
        );
      } catch {
        // Nothing useful to do while the page is being torn down; the heartbeat
        // going stale reaches the same conclusion within the offline window.
      }
    };
    window.addEventListener('pagehide', onLeave);

    return () => {
      stopped = true;
      clearInterval(timer);
      for (const evt of ACTIVITY) window.removeEventListener(evt, markActive);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onLeave);
    };
  }, [enabled]);
}

/** The shape `/api/presence` returns, and what the dots read. */
export interface PresenceRow {
  memberId: string;
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  presence: 'online' | 'away' | 'offline';
  lastSeenAt: string | null;
  lastActiveAt: string | null;
}
