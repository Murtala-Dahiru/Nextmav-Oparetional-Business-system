'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient, type SupabaseClient } from '@/lib/supabase/client';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Live updates
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What was already here, and what was missing ────────────────────────────
 *
 * The database side of realtime has existed since 0006: a `supabase_realtime`
 * publication carrying messages, notifications, tasks, projects, attendance,
 * comments and tickets, each with `REPLICA IDENTITY FULL` so an UPDATE arrives
 * with its old row and a filter on a non-key column actually works.
 *
 * Nothing in the browser ever subscribed to it. Every module fetched on mount
 * and then went stale until the user pressed reload — so a task completed by a
 * colleague, a message posted in a channel, a leave request approved, an invoice
 * raised, a client signing off a deliverable: none of it reached a screen that
 * was already open. The plumbing was laid and never connected.
 *
 * ── Why refetch rather than patch state ───────────────────────────────────
 *
 * A postgres change event carries the row that changed. It is tempting to merge
 * that row into local state and skip the round trip, and for a flat list it
 * works. It is wrong here, for two reasons:
 *
 *   · The screens render *derived* values. A task moving to `done` changes the
 *     project's progress percentage, its health verdict and its completed count,
 *     all computed by `v_project_health` in Postgres. The task row says nothing
 *     about any of them, so merging it would tick the task and leave the
 *     progress bar lying.
 *
 *   · The event is the raw row, not the endpoint's shape. It has snake_case keys
 *     and none of the embedded relations the components read — no
 *     `owner.profiles.fullName`, no `client.name`. Merging one in would put a
 *     row into state that renders blanks in half its columns.
 *
 * So an event means "your data is stale", and the component asks the server
 * again. That is one extra request per change, which is why the debounce below
 * matters more than it looks.
 *
 * This is *not* the "fake realtime by refreshing pages" that was ruled out: no
 * navigation happens, no component remounts, scroll position and open dialogs
 * survive, and the refetch is silent.
 */

/**
 * One websocket for the whole tab.
 *
 * `createClient()` builds a new client — and therefore a new realtime socket —
 * on every call. With a hook per module and several hooks per screen that is a
 * dozen sockets to the same project, each with its own reconnect timer, and
 * browsers cap concurrent connections. Multiplexing channels over one socket is
 * what the protocol is for.
 */
let shared: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (!shared) shared = createClient();
  return shared;
}

export interface RealtimeTable {
  /** Table to watch. Must be a member of the `supabase_realtime` publication. */
  table: string;
  /**
   * A PostgREST-style filter, e.g. `project_id=eq.<uuid>`.
   *
   * Worth setting wherever a natural scope exists. Without one, every write to
   * the table in *any* tenant is delivered to this tab and then discarded —
   * RLS filters what a subscriber may receive, but a project screen still has no
   * use for a task on a different project.
   */
  filter?: string;
  /** Which operations matter. Defaults to all of them. */
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
}

export interface UseRealtimeOptions {
  /**
   * A stable name for the subscription.
   *
   * Two channels with the same name on one socket collide, so this has to be
   * distinct per logical subscription — and stable across renders, or every
   * render tears the subscription down and builds a new one.
   */
  name: string;
  tables: RealtimeTable[];
  /** Called after a change, debounced. */
  onChange: () => void;
  /** Set false to subscribe to nothing (e.g. while an id is still null). */
  enabled?: boolean;
  /**
   * How long to wait for the writes to stop before refetching.
   *
   * Changes arrive in bursts: completing a milestone fires the milestone update,
   * the trigger that stamps its stage, and a notification insert — three events
   * that all mean one refetch. Reordering a roadmap fires one per row. 400ms is
   * comfortably below the threshold where a person notices a delay and
   * comfortably above the width of these bursts.
   */
  debounceMs?: number;
}

/**
 * Whether a subscription is actually receiving.
 *
 * `subscribed` is not a formality. Websockets are blocked by a good number of
 * corporate proxies — which is common in exactly the enterprises this product
 * is aimed at — and a channel that cannot connect fails quietly: the callback
 * simply never fires, which is indistinguishable from a quiet table. Anything
 * that has a polling fallback needs to know which of the two it is looking at,
 * or it either polls needlessly or stops updating with no indication why.
 */
export type RealtimeStatus = 'connecting' | 'subscribed' | 'unavailable';

export function useRealtime({
  name, tables, onChange, enabled = true, debounceMs = 400,
}: UseRealtimeOptions): RealtimeStatus {
  /**
   * The callback is held in a ref so an inline arrow function does not
   * re-subscribe on every render.
   *
   * Callers write `onChange={() => load(true)}`, which is a new function each
   * time. In the effect's dependency list that unsubscribes and resubscribes on
   * every render — a stream of channel joins, and on a component that renders
   * often, a socket that never settles.
   */
  const handler = useRef(onChange);

  /**
   * Assigned in an effect, not during render.
   *
   * Writing `handler.current = onChange` in the body is the common shorthand and
   * React's own lint rule rejects it: render must be side-effect free, and under
   * concurrent rendering a render that is thrown away would still have mutated
   * the ref. An effect with no dependency array runs after *every* committed
   * render, which is exactly the semantics wanted here — the callback the socket
   * fires is always the one from the latest render that actually happened.
   */
  useEffect(() => {
    handler.current = onChange;
  });

  // Serialised so a caller passing an inline array literal does not re-subscribe
  // every render either.
  const key = JSON.stringify(tables);

  /**
   * Which subscription this hook currently wants, as one comparable value.
   *
   * Status is *derived* from it rather than reset by an effect. The obvious
   * implementation — `setStatus('connecting')` at the top of the subscribe
   * effect — is a synchronous setState inside an effect body, which cascades an
   * extra render on every resubscribe and is what `react-hooks/set-state-in-effect`
   * is there to catch. Tagging the reported status with the subscription it came
   * from means a change of channel reads as 'connecting' immediately, with no
   * second render and nothing to keep in sync.
   */
  const id = `${name}|${key}|${enabled}`;
  const [reported, setReported] =
    useState<{ id: string; status: RealtimeStatus } | null>(null);

  const status: RealtimeStatus =
    !enabled || !tables.length
      ? 'unavailable'
      : reported?.id === id
        ? reported.status
        : 'connecting';

  useEffect(() => {
    if (!enabled || !tables.length) return;

    const supabase = client();
    const spec: RealtimeTable[] = JSON.parse(key);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // The component may have unmounted while the timer was pending; calling
        // its setState then is the classic React memory-leak warning.
        if (!cancelled) handler.current();
      }, debounceMs);
    };

    const channel = supabase.channel(name);

    for (const t of spec) {
      channel.on(
        'postgres_changes' as never,
        {
          event: t.event ?? '*',
          schema: 'public',
          table: t.table,
          ...(t.filter ? { filter: t.filter } : {}),
        } as never,
        fire as never,
      );
    }

    /**
     * Realtime authorises with its own token, set separately from the REST
     * client's session.
     *
     * Without this the socket connects as `anon`, and every RLS policy on these
     * tables requires an authenticated member — so the subscription succeeds,
     * receives nothing, and looks exactly like a working subscription on a quiet
     * table. Awaited before subscribing rather than after, or the join is sent
     * with the anonymous token still in place.
     */
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) supabase.realtime.setAuth(token);
      } catch {
        // An unauthenticated tab simply receives nothing, which is correct.
      }
      if (cancelled) return;

      channel.subscribe(state => {
        if (cancelled) return;
        /**
         * `CHANNEL_ERROR` and `TIMED_OUT` are the blocked-socket cases, and
         * `CLOSED` arrives on a server-side close. All three mean the same thing
         * to a caller: stop expecting events and fall back.
         *
         * A callback from the socket is not a render, so setting state here is
         * the "subscribe to an external system" case the lint rule explicitly
         * allows — unlike doing it synchronously in the effect body.
         */
        if (state === 'SUBSCRIBED') {
          setReported({ id, status: 'subscribed' });
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
          setReported({ id, status: 'unavailable' });
        }
      });
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // Both halves matter: `unsubscribe` leaves the channel registered on the
      // client, so a remount with the same name finds a stale entry and the new
      // subscription is silently dropped.
      void supabase.removeChannel(channel);
    };
  }, [id, name, key, enabled, debounceMs, tables.length]);

  return status;
}

/**
 * Everything that moves one project's numbers.
 *
 * Progress, health, the roadmap and the deliverable counts are all derived from
 * these five tables by `v_project_health`, so a screen showing any of them is
 * stale after a write to any of them. Grouped into one hook because the set is
 * not a judgement call — it is the view's own FROM clause.
 *
 * `files` and `comments` carry no `project_id` filter for milestones' sake:
 * `milestones` does have one, and the two that do are filtered. A comment on
 * another project costs one discarded event.
 */
export function useProjectRealtime(projectId: string | null, onChange: () => void) {
  return useRealtime({
    name: `project:${projectId ?? 'none'}`,
    enabled: !!projectId,
    onChange,
    tables: projectId
      ? [
          { table: 'projects', filter: `id=eq.${projectId}` },
          { table: 'tasks', filter: `project_id=eq.${projectId}` },
          { table: 'milestones', filter: `project_id=eq.${projectId}` },
          { table: 'files', filter: `project_id=eq.${projectId}` },
          { table: 'comments', filter: `project_id=eq.${projectId}` },
        ]
      : [],
  });
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Typing indicators
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is broadcast and not a table ─────────────────────────────────
 *
 * Everything else here is `postgres_changes`: something was written, so go and
 * read it again. "Alice is typing" is the opposite kind of fact — it is true
 * for about two seconds, nobody needs it after that, and writing it down would
 * mean a row per keystroke-burst per person, an index to keep, and a cleanup
 * job for state that expires on its own.
 *
 * Supabase Realtime's `broadcast` carries it directly between clients without
 * touching the database. The cost of a lost message is that a "typing…" line
 * does not appear, which is exactly the right failure for something this
 * ephemeral.
 *
 * ── The two timers, and why both are needed ───────────────────────────────
 *
 *   · The sender throttles. A keystroke is not an event worth sending; one
 *     signal every few seconds while somebody is actively typing is.
 *   · The receiver expires. Nothing announces "I stopped typing" reliably — a
 *     closed tab, a dropped connection or simply walking away all end the
 *     typing without a final message. So each name carries its own deadline and
 *     disappears on its own, and a stuck "Alice is typing…" is impossible.
 */

export interface TypingUser {
  memberId: string;
  name: string;
}

/** How often the sender re-announces while typing continues. */
const TYPING_THROTTLE_MS = 3000;
/** How long a received signal stays valid. Comfortably above the throttle. */
const TYPING_TTL_MS = 5000;

export function useTyping(
  channelId: string | null,
  me: { memberId: string; name: string } | null,
) {
  const [received, setReceived] = useState<TypingUser[]>([]);
  const chanRef = useRef<ReturnType<SupabaseClient['channel']> | null>(null);
  const lastSent = useRef(0);
  /** memberId → the moment their signal stops counting. */
  const deadlines = useRef(new Map<string, number>());

  /**
   * The caller's identity, in a ref.
   *
   * `signal` is called on every keystroke, so it must not be rebuilt whenever
   * the roster reloads and produces a new `me` object — and a `useCallback`
   * closing over `me?.memberId` is one React's compiler cannot verify, which is
   * what `preserve-manual-memoization` objects to. The ref makes the callback
   * genuinely stable and always current.
   */
  const meRef = useRef(me);
  useEffect(() => { meRef.current = me; });

  const active = !!channelId && !!me;

  /**
   * Derived, not reset by an effect.
   *
   * Clearing with `setTyping([])` at the top of the effect is a synchronous
   * setState inside an effect body — an extra render on every channel switch,
   * and what `react-hooks/set-state-in-effect` exists to catch. Returning an
   * empty list when there is nothing to listen on says the same thing with no
   * state to keep in step.
   */
  const typing = active ? received : [];

  useEffect(() => {
    if (!channelId || !me) return;

    const supabase = client();
    // A separate channel from the postgres one: mixing a two-second ephemeral
    // signal into the subscription that drives refetches would mean every
    // keystroke burst triggering a reload of the message list.
    const chan = supabase.channel(`typing:${channelId}`, {
      config: { broadcast: { self: false } },
    });
    chanRef.current = chan;

    chan.on('broadcast', { event: 'typing' }, ({ payload }: any) => {
      const from = payload?.memberId;
      if (!from || from === me.memberId) return;
      deadlines.current.set(from, Date.now() + TYPING_TTL_MS);
      setReceived(prev =>
        prev.some(t => t.memberId === from)
          ? prev
          : [...prev, { memberId: from, name: payload.name ?? 'Someone' }],
      );
    });

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) supabase.realtime.setAuth(token);
      } catch { /* an unauthenticated tab simply sends and receives nothing */ }
      chan.subscribe();
    })();

    /**
     * Expiry runs on a timer rather than being scheduled per signal.
     *
     * One interval for the channel, not one `setTimeout` per person per
     * keystroke — which on a busy channel is a stream of timers to track and
     * cancel, and a leak the first time one is missed.
     */
    const sweep = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, until] of deadlines.current) {
        if (until <= now) { deadlines.current.delete(id); changed = true; }
      }
      if (changed) {
        setReceived(prev => prev.filter(t => deadlines.current.has(t.memberId)));
      }
    }, 1000);

    return () => {
      clearInterval(sweep);
      deadlines.current.clear();
      chanRef.current = null;
      void supabase.removeChannel(chan);
    };
  }, [channelId, me?.memberId, me?.name]);

  /**
   * Call on every keystroke; the throttle decides what actually goes out.
   *
   * No dependencies: everything it needs is in a ref, so the identity is stable
   * for the life of the component and an `onChange` handler that calls it does
   * not change on every render.
   */
  const signal = useCallback(() => {
    const self = meRef.current;
    if (!chanRef.current || !self) return;
    const now = Date.now();
    if (now - lastSent.current < TYPING_THROTTLE_MS) return;
    lastSent.current = now;
    void chanRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { memberId: self.memberId, name: self.name },
    });
  }, []);

  return { typing, signal };
}

/**
 * A whole module's tables, unfiltered.
 *
 * For list screens, where the interesting scope is "anything in my
 * organisation" and there is no single id to filter on. RLS confines delivery to
 * the caller's own tenant, so the breadth is bounded by the policy rather than
 * by the filter.
 */
export function useModuleRealtime(
  name: string,
  tables: string[],
  onChange: () => void,
  enabled = true,
) {
  return useRealtime({
    name: `module:${name}`,
    enabled,
    onChange,
    tables: tables.map(table => ({ table })),
  });
}
