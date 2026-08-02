'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/app-store';
import { WARNING_LEAD_MS } from '@/lib/session-policy';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The session countdown
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  This hook does not end sessions. `proxy.ts` does, on the server, from
 *  httpOnly cookies the browser cannot reach. What this does is make the
 *  ending *visible* — announced with time to react rather than discovered when
 *  a save comes back 401 and the form is gone.
 *
 *  Three jobs:
 *
 *   1. Tell the server somebody is here. Real interaction — a click, a key, a
 *      scroll — throttled to once a minute. Without this the idle clock only
 *      advances as a side effect of fetching, and twenty minutes of typing
 *      into a long text field fetches nothing.
 *
 *   2. Count down to the deadline the server reported, and raise a warning two
 *      minutes out.
 *
 *   3. Keep every tab in step. The clocks are cookies, so they are already
 *      shared; what is not shared is each tab's idea of the deadline. A tab
 *      that has been in the background all afternoon would otherwise put up an
 *      expiry warning about a session the tab next to it renewed ten seconds
 *      ago. One `localStorage` write, and they all agree.
 */

/** Interaction that counts as a person being present. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/** Never touch the server more than once in this window, however busy they are. */
const TOUCH_THROTTLE_MS = 60_000;

/** Cross-tab channel. The value is the agreed deadline, as a timestamp. */
const SYNC_KEY = 'nm:session-expires-at';

export interface SessionTimeout {
  /** True once the deadline is inside the warning window. */
  warning: boolean;
  /** Whole seconds left, for the countdown. */
  secondsRemaining: number;
  /**
   * Which clock is closing. `absolute` cannot be extended, so the dialog
   * offers saving rather than a button that would not work.
   */
  limitedBy: 'idle' | 'absolute';
  /** Push the idle clock forward now. No effect on the absolute ceiling. */
  extend: () => Promise<void>;
}

export function useSessionTimeout(enabled: boolean): SessionTimeout {
  const expiresAt = useAppStore(s => s.sessionExpiresAt);
  const setExpiresAt = useAppStore(s => s.setSessionExpiresAt);
  const logout = useAppStore(s => s.logout);

  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [limitedBy, setLimitedBy] = useState<'idle' | 'absolute'>('idle');

  const lastTouch = useRef(0);
  // Guards the sign-out, which is a navigation: without it a slow redirect
  // lets the next tick fire and start a second one.
  const ending = useRef(false);

  const end = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    try {
      // Local scope: a timeout in this browser is not a reason to end the
      // session the same person is using on their phone.
      await fetch('/api/auth/logout?scope=local', { method: 'POST' }).catch(() => {});
    } finally {
      window.location.href = '/login?reason=timeout';
    }
  }, []);

  const touch = useCallback(async (force = false) => {
    if (!enabled || ending.current) return;

    const now = Date.now();
    if (!force && now - lastTouch.current < TOUCH_THROTTLE_MS) return;
    lastTouch.current = now;

    try {
      // No background header: this request is the whole point, and the proxy
      // must count it.
      const res = await fetch('/api/auth/session/touch', { method: 'POST' });
      if (res.status === 401) {
        // Already gone. The proxy has cleared the cookies; follow it.
        window.location.href = '/login?reason=timeout';
        return;
      }
      const json = await res.json();
      const data = json?.data ?? json;
      if (data?.expiresInMs != null) {
        const deadline = Date.now() + Number(data.expiresInMs);
        setExpiresAt(deadline);
        setLimitedBy(data.limitedBy === 'absolute' ? 'absolute' : 'idle');
        try {
          // Tells the other tabs. `storage` does not fire in the tab that
          // wrote, which is exactly right — this one already knows.
          window.localStorage.setItem(SYNC_KEY, String(deadline));
        } catch {
          // Private browsing, or storage disabled. Each tab then keeps its own
          // countdown, which is slightly noisier and still correct.
        }
      }
    } catch {
      // Offline, most likely. The deadline stands and the countdown continues;
      // if the session really has ended the next real request will say so.
    }
  }, [enabled, setExpiresAt]);

  // ── 1. Somebody is here ──────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    const onActivity = () => { void touch(); };
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true });
    }

    /**
     * Coming back to the tab is worth a check rather than a renewal.
     *
     * A laptop that has been shut for two hours wakes with a session that
     * ended ninety minutes ago, and the countdown in this tab has been frozen
     * along with the timers. Asking the server is how it finds out; forcing a
     * touch would instead *extend* a session nobody was using, which is the
     * opposite of the policy.
     */
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (expiresAt != null && Date.now() >= expiresAt) {
        void end();
        return;
      }
      void touch();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, touch, end, expiresAt]);

  // ── 3. Every tab agrees ──────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SYNC_KEY || !e.newValue) return;
      const deadline = Number(e.newValue);
      // Only ever forward. A tab reporting an older deadline is one whose
      // request was in flight while another renewed, and honouring it would
      // expire a session that has just been extended.
      if (Number.isFinite(deadline) && (expiresAt == null || deadline > expiresAt)) {
        setExpiresAt(deadline);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [enabled, expiresAt, setExpiresAt]);

  // ── 2. The countdown ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || expiresAt == null) {
      setSecondsRemaining(0);
      return;
    }

    const tick = () => {
      const left = expiresAt - Date.now();
      setSecondsRemaining(Math.max(0, Math.ceil(left / 1000)));
      if (left <= 0) void end();
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [enabled, expiresAt, end]);

  return {
    warning:
      enabled
      && expiresAt != null
      && secondsRemaining > 0
      && secondsRemaining * 1000 <= WARNING_LEAD_MS,
    secondsRemaining,
    limitedBy,
    extend: () => touch(true),
  };
}
