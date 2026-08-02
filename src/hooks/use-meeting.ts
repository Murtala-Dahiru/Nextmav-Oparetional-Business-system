'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient, type SupabaseClient } from '@/lib/supabase/client';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A meeting's media.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this is, and what it deliberately is not ─────────────────────────
 *
 * This connects browsers to each other directly — a full mesh, one peer
 * connection per pair — and signals over the Realtime channel the tab already
 * has open. No media server, no third-party SDK, and no audio or video passing
 * through this application's own infrastructure.
 *
 * That choice has a real limit and it is stated here rather than discovered
 * later: a mesh sends one copy of your camera per participant, so it is right
 * for the meetings this product is for — a team of five, a client call, a
 * stand-up — and wrong for a company all-hands. Somewhere around eight people
 * the upstream bandwidth of the room becomes the binding constraint. An SFU is
 * the answer to that, it is a piece of infrastructure rather than a component,
 * and pretending a mesh scales is how a video feature comes to be quietly
 * unusable at exactly the moment it matters.
 *
 * ── Why signalling is broadcast and not a table ───────────────────────────
 *
 * The same reasoning as the typing indicator in `use-realtime.ts`, only more
 * so. An offer, an answer and a stream of ICE candidates are worthless three
 * seconds after they are sent, and a mesh of six people produces a few hundred
 * of them per join. Writing that down would mean a row per candidate per pair,
 * an index to maintain, and a cleanup job for state that expires on its own.
 *
 * ── Where the authority lives ────────────────────────────────────────────
 *
 * Not here. Whether somebody has been admitted, whether the host has muted
 * them, whether the room is locked — those are rows in `meeting_participants`,
 * because a decision that only exists as a message to a browser is a decision
 * a browser can ignore, and in a mesh a client that ignores "you are not
 * admitted" is already connected to everybody. This module offers a peer
 * connection only to somebody the *server* says is in the room; the caller
 * passes that list in, and it comes from the endpoint.
 */

export type MeetingConnection = 'idle' | 'requesting-media' | 'connecting' | 'connected' | 'failed';

export interface PeerStream {
  memberId: string;
  stream: MediaStream;
  /** Whether anything is actually arriving on the video track yet. */
  hasVideo: boolean;
}

/**
 * What the room can honestly say about one connection.
 *
 *   · `connecting`   — being set up for the first time.
 *   · `live`         — media is flowing.
 *   · `reconnecting` — it was working, or nearly, and is being rebuilt. This is
 *                      the state a wobbling network spends its time in, and the
 *                      one that used to be indistinguishable from `connecting`.
 *   · `lost`         — rebuilt as often as it is worth rebuilding. Without a
 *                      TURN server a symmetric NAT genuinely cannot be
 *                      traversed, and saying so lets somebody pick up a phone
 *                      instead of watching an animation.
 */
export type PeerHealth = 'connecting' | 'live' | 'reconnecting' | 'lost';

export interface UseMeetingOptions {
  meetingId: string | null;
  /** The caller's membership id — the identity every signalling message carries. */
  memberId: string | null;
  /**
   * Membership ids the *server* says are in the room.
   *
   * The gate, not a hint: nothing outside this set is offered a connection,
   * and a peer that leaves it has its connection torn down. Passing an
   * optimistic list here would defeat the waiting room entirely.
   */
  admitted: string[];
  /** Audio only, for a voice call. */
  audioOnly?: boolean;
  /** False until the caller has actually joined; nothing happens before that. */
  enabled: boolean;
}

/** Public STUN only. See the note on TURN in `start()`. */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

/**
 * The connection settings, and why each one is set.
 *
 *   · `iceCandidatePoolSize` starts gathering candidates as soon as the
 *     connection object exists rather than when the offer is created. On a
 *     slow network gathering is most of the time to first frame, and this is
 *     the single cheapest thing that shortens it.
 *   · `bundlePolicy: 'max-bundle'` puts audio and video on one transport, so
 *     there is one ICE negotiation per peer instead of two. Fewer ports, fewer
 *     chances for one of them to be the one a firewall drops.
 *   · `rtcpMuxPolicy: 'require'` is the same economy for the control channel.
 *
 * All three are defaults in some browsers and not in others; stating them
 * means the meeting behaves the same way everywhere.
 */
const RTC_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 4,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

/**
 * How much video to send per person, given how many people there are.
 *
 * A mesh sends one copy of your camera to every participant, so the upstream
 * cost is the bitrate *times* the number of peers — and upstream is what
 * domestic and mobile connections have least of. Left alone, browsers aim for
 * something like 2Mbps a stream, which four peers turns into 8Mbps up and a
 * meeting that stutters for everybody at once.
 *
 * These figures keep the total under roughly 1.5Mbps up, which is within reach
 * of a poor connection, and are per-stream ceilings rather than targets: a good
 * network still gets a clean picture at the smaller sizes because the encoder
 * is free to use less.
 */
function videoBitrateFor(peers: number): number {
  if (peers <= 1) return 1_200_000;
  if (peers <= 3) return 600_000;
  if (peers <= 6) return 350_000;
  return 200_000;
}

/** A shared screen is text far more often than it is motion. */
const SHARE_BITRATE = 1_500_000;

/**
 * Shape one video sender.
 *
 * `degradationPreference` is the interesting half. Under pressure a browser
 * must give up either resolution or framerate, and the right answer depends
 * entirely on what is being sent: a face stays legible at a lower resolution
 * and becomes a slideshow if the framerate goes, while a shared spreadsheet is
 * unreadable the moment it is scaled down and perfectly usable at eight frames
 * a second.
 */
async function shapeSender(
  sender: RTCRtpSender,
  bitrate: number,
  preference: 'maintain-framerate' | 'maintain-resolution',
) {
  if (!sender.track || sender.track.kind !== 'video') return;
  try {
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = bitrate;
    // Not in every lib.dom yet, and harmless where it is unrecognised.
    (params as { degradationPreference?: string }).degradationPreference = preference;
    await sender.setParameters(params);
  } catch {
    // Some browsers refuse `setParameters` on a sender that has not negotiated
    // yet. The connection is fine without it; the picture is merely less
    // considerate of the network.
  }
}

/**
 * How often the roster and the connections are compared.
 *
 * ── Why a sweep exists at all ────────────────────────────────────────────
 *
 * Connections used to be created by exactly one thing: the `hello` broadcast a
 * browser sends the moment it subscribes. Everybody who receives it and already
 * has that person on their roster opens a connection; everybody who does not,
 * ignores it — and the roster arrives separately, over a different subscription,
 * on its own schedule.
 *
 * So the two racing was the whole bug. A host who leaves and comes back
 * announces themselves to a room whose participant lists still say they are
 * gone, every one of those browsers discards the announcement, and nothing ever
 * says it again. The rejoining host sits looking at a grid of spinners that
 * will never resolve, and so does everybody else. That is the "meeting is stuck
 * loading after the host rejoins" report, and no amount of retrying the *join*
 * fixes it, because the join worked.
 *
 * The cure is to stop treating a broadcast as the source of truth. The server's
 * participant list already says who is in the room; this compares that list
 * with the connections that exist and fixes the difference — so a missed
 * announcement costs a couple of seconds instead of the rest of the meeting.
 * `hello` is kept as the fast path.
 */
const SWEEP_MS = 2500;

/**
 * How long a connection may sit not-connected before it is rebuilt.
 *
 * Long enough for ICE on a slow network with a couple of candidate pairs to
 * try; short enough that somebody does not sit watching a placeholder wondering
 * whether it is them.
 */
const STALL_MS = 12_000;

/** How many times one peer is rebuilt before it is called unreachable. */
const MAX_REBUILDS = 3;

/**
 * How long a connection may sit `disconnected` before it is rebuilt.
 *
 * Most disconnections are a second of packet loss and heal themselves, so
 * tearing down immediately would turn every hiccup into a full renegotiation —
 * which is slower and looks worse than the hiccup. Six seconds is comfortably
 * past the ones that recover and comfortably before anybody decides the meeting
 * is broken.
 */
const DROP_GRACE_MS = 6000;

/**
 * How long before somebody given up on is offered another chance.
 *
 * `MAX_REBUILDS` stops a connection that cannot succeed from retrying for
 * ever — but "cannot succeed" is a judgement about a network, and networks
 * change. A VPN reconnects, a phone finds wifi, a router is restarted. Without
 * this the meeting would stay permanently broken for a pair whose obstacle had
 * gone away half an hour ago, and the only cure would be for one of them to
 * leave and rejoin.
 */
const RETRY_LOST_MS = 60_000;

export function useMeeting({
  meetingId, memberId, admitted, audioOnly, enabled,
}: UseMeetingOptions) {
  const [status, setStatus] = useState<MeetingConnection>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<PeerStream[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(!audioOnly);
  const [sharing, setSharing] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  /** A connection to rebuild after a failure. See the effect below `connect`. */
  const [rebuild, setRebuild] = useState<{ peerId: string; at: number } | null>(null);
  /** Whether the signalling channel is actually carrying anything yet. */
  const [linked, setLinked] = useState(false);
  /**
   * How the connection to each person is actually doing.
   *
   * Rendered rather than left as a spinner. A tile that spins for ever is the
   * single most common way a mesh fails in front of somebody, and it is
   * indistinguishable from a slow network right up until the meeting is over —
   * which is exactly the "appears frozen" complaint. Four states, because they
   * call for four different things from the person watching: wait, nothing,
   * wait a bit longer, and stop waiting.
   */
  const [health, setHealth] = useState<Record<string, PeerHealth>>({});

  const mark = useCallback((peerId: string, state: PeerHealth) => {
    setHealth(prev => (prev[peerId] === state ? prev : { ...prev, [peerId]: state }));
  }, []);

  const connections = useRef(new Map<string, RTCPeerConnection>());
  /**
   * Candidates that arrived before the description they belong to.
   *
   * ICE trickles: the far end starts sending candidates as soon as it has
   * them, which is routinely before its offer or answer has been applied here.
   * `addIceCandidate` on a connection with no remote description throws, so
   * they wait.
   */
  const pendingIce = useRef(new Map<string, RTCIceCandidateInit[]>());
  /**
   * How many times a connection to one person has been rebuilt.
   *
   * ICE fails for reasons that pass: a laptop moving between access points, a
   * VPN reconnecting, a candidate pair that simply loses the race. The previous
   * behaviour was to close the connection and never try again, so a two-second
   * network blip removed somebody from the meeting for its remainder and the
   * only cure was for one of them to leave and rejoin. Bounded, because the
   * other reason ICE fails is that it cannot succeed at all — a symmetric NAT
   * with no TURN server — and retrying that for ever is a loop, not a recovery.
   */
  const rebuilds = useRef(new Map<string, number>());
  /**
   * When each connection was opened, for the stall check in the sweep below.
   *
   * `RTCPeerConnection` reaches `failed` only after ICE has exhausted its own
   * timers, which is tens of seconds — and never at all for the case that
   * matters most here, an offer sent to a browser that was not yet listening.
   * That connection sits in `new` indefinitely with nothing to report.
   */
  const openedAt = useRef(new Map<string, number>());
  /** When a connection went quiet, for the grace period in the sweep. */
  const droppedAt = useRef(new Map<string, number>());
  /** When a peer was given up on, for the occasional fresh attempt. */
  const lostAt = useRef(new Map<string, number>());
  /** The bitrate ceiling currently applied, so it is only re-applied on change. */
  const shapedFor = useRef(0);
  /** Whether a screen is being shared, readable from callbacks that are not re-made. */
  const sharingRef = useRef(false);
  const localRef = useRef<MediaStream | null>(null);
  /** The camera track, kept aside while a screen share is standing in for it. */
  const cameraTrack = useRef<MediaStreamTrack | null>(null);
  const channelRef = useRef<ReturnType<SupabaseClient['channel']> | null>(null);
  const admittedRef = useRef<string[]>(admitted);
  useEffect(() => { admittedRef.current = admitted; });

  // ─── Signalling ──────────────────────────────────────────────────────────

  const post = useCallback((event: string, payload: Record<string, unknown>) => {
    void channelRef.current?.send({ type: 'broadcast', event, payload });
  }, []);

  const dropPeer = useCallback((peerId: string) => {
    connections.current.get(peerId)?.close();
    connections.current.delete(peerId);
    pendingIce.current.delete(peerId);
    openedAt.current.delete(peerId);
    droppedAt.current.delete(peerId);
    setPeers(prev => prev.filter(p => p.memberId !== peerId));
  }, []);

  /**
   * The connection to one other person.
   *
   * ── The rule that stops two offers crossing ──────────────────────────────
   *
   * Both browsers learn about each other at the same moment, and if both send
   * an offer the exchange collapses — a well-known race with a well-known
   * cure. The one whose membership id sorts lower makes the offer; the other
   * waits. It needs no negotiation because both sides already know both ids,
   * and it is stable, so a reconnect resolves the same way.
   */
  const connect = useCallback((peerId: string, initiate: boolean) => {
    if (!memberId || connections.current.has(peerId)) return connections.current.get(peerId)!;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    connections.current.set(peerId, pc);
    openedAt.current.set(peerId, Date.now());
    // A rebuild is not a first attempt, and the difference is the whole point
    // of the distinction: one asks somebody to wait, the other tells them it is
    // already going wrong.
    mark(peerId, (rebuilds.current.get(peerId) ?? 0) > 0 ? 'reconnecting' : 'connecting');

    for (const track of localRef.current?.getTracks() ?? []) {
      const sender = pc.addTrack(track, localRef.current!);
      if (track.kind === 'video') {
        void shapeSender(
          sender,
          sharingRef.current ? SHARE_BITRATE : videoBitrateFor(admittedRef.current.length),
          sharingRef.current ? 'maintain-resolution' : 'maintain-framerate',
        );
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        post('ice', { from: memberId, to: peerId, candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      const [stream] = e.streams;
      if (!stream) return;
      setPeers(prev => {
        const existing = prev.find(p => p.memberId === peerId);
        const next: PeerStream = {
          memberId: peerId,
          stream,
          hasVideo: stream.getVideoTracks().some(t => t.enabled),
        };
        return existing
          ? prev.map(p => (p.memberId === peerId ? next : p))
          : [...prev, next];
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setStatus('connected');
        // It came back, so the budget for rebuilding it is restored — a call
        // that survives four separate blips over an hour is a call that worked.
        rebuilds.current.delete(peerId);
        droppedAt.current.delete(peerId);
        lostAt.current.delete(peerId);
        mark(peerId, 'live');
      }

      /**
       * `disconnected` is not `failed`, and waiting for `failed` is the wrong
       * thing to do about it.
       *
       * It means the far end has gone quiet: a phone changing cell, a laptop
       * moving between access points, a moment of packet loss. Most of them
       * heal on their own within a second or two, which is why this does not
       * tear the connection down. But some never do, and ICE takes tens of
       * seconds to conclude that — during which the picture is frozen and
       * nothing on screen says why. Stamped here and rebuilt by the sweep if it
       * is still quiet a few seconds later; said out loud immediately.
       */
      if (pc.connectionState === 'disconnected') {
        if (!droppedAt.current.has(peerId)) droppedAt.current.set(peerId, Date.now());
        mark(peerId, 'reconnecting');
      }
      /**
       * `failed` is terminal for *this* connection — it will not recover on its
       * own, which is why `disconnected` (usually a blip that heals) is left
       * alone and this is not.
       *
       * Rebuilding it takes both sides: tearing down here and offering again
       * finds the far end holding a connection it still believes in, and no
       * offer is ever made. `reset` is the message that gets the other browser
       * to drop its half too, after which the id ordering decides which of them
       * offers — the same rule that stops two offers crossing on a first join.
       */
      if (pc.connectionState === 'failed') {
        const used = rebuilds.current.get(peerId) ?? 0;
        dropPeer(peerId);
        if (used >= MAX_REBUILDS || !admittedRef.current.includes(peerId)) {
          lostAt.current.set(peerId, Date.now());
          mark(peerId, 'lost');
          return;
        }
        rebuilds.current.set(peerId, used + 1);
        mark(peerId, 'reconnecting');
        post('reset', { from: memberId, to: peerId });
        // Asked for rather than done here: this is the function that would be
        // doing the calling, and a `useCallback` that names itself is not
        // something React's rules can verify. The effect below owns the retry.
        setRebuild({ peerId, at: Date.now() });
      }
    };

    if (initiate) {
      void (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          post('offer', { from: memberId, to: peerId, sdp: pc.localDescription });
        } catch {
          dropPeer(peerId);
        }
      })();
    }

    return pc;
  }, [memberId, post, dropPeer, mark]);

  /**
   * Rebuild one connection, shortly.
   *
   * The delay is for the far end's own teardown to land first — offering into
   * a peer that has not let go of its half is the state this is trying to get
   * out of, not into. `at` is what makes two failures in a row two separate
   * requests rather than one value React sees as unchanged.
   */
  useEffect(() => {
    if (!rebuild || !enabled || !memberId) return;
    const timer = setTimeout(() => {
      if (!admittedRef.current.includes(rebuild.peerId)) return;
      if (connections.current.has(rebuild.peerId)) return;
      connect(rebuild.peerId, memberId < rebuild.peerId);
    }, 400);
    return () => clearTimeout(timer);
  }, [rebuild, enabled, memberId, connect]);

  /**
   * The roster and the connections, compared.
   *
   * See the note on `SWEEP_MS`. Three jobs, in the order they matter:
   *
   *   1. Anybody the server says is in the room that this browser has no
   *      connection to gets one. This is what makes a missed `hello` — the
   *      rejoining host, the participant whose tab was asleep, the browser that
   *      subscribed a second after the announcement went out — cost two seconds
   *      instead of the rest of the meeting.
   *   2. A connection that has sat not-connected past `STALL_MS` is torn down
   *      and rebuilt. `RTCPeerConnection` will not report this itself: an offer
   *      sent to a browser that was not listening leaves a connection in `new`
   *      for ever, with no event and nothing to observe.
   *   3. Anybody who has left keeps nothing open.
   *
   * Gated on `linked`, because every one of those actions sends something, and
   * something sent before the channel has subscribed is discarded — which would
   * make the first sweep of every meeting a wasted round of offers that then
   * have to time out.
   */
  const rosterKey = admitted.join('|');

  useEffect(() => {
    if (!enabled || !memberId || !linked) return;

    const sweep = () => {
      const now = Date.now();
      const roster = admittedRef.current;

      for (const peerId of roster) {
        if (connections.current.has(peerId)) continue;

        // Somebody written off a while ago gets the budget back, once, so a
        // network that has since recovered is not ignored for the rest of the
        // meeting.
        const wrote = lostAt.current.get(peerId);
        if (wrote && now - wrote >= RETRY_LOST_MS) {
          rebuilds.current.delete(peerId);
          lostAt.current.delete(peerId);
        }
        if ((rebuilds.current.get(peerId) ?? 0) >= MAX_REBUILDS) continue;

        const initiate = memberId < peerId;
        connect(peerId, initiate);

        /**
         * The waiting side says hello; the offering side does not.
         *
         * `welcome` tells the far end to throw away a half-negotiated
         * connection and start again, which is exactly what is needed when this
         * browser is the one that waits: the other end's roster was ahead of
         * ours, it already sent an offer we discarded, and nothing would ever
         * make it send another.
         *
         * Sending it from the *offering* side as well would be symmetrical and
         * wrong. Both browsers sweep at the same moment on a first join, so
         * both would ask the other to reset — and the reset would land on the
         * offer that had just been made, discarding it. One direction only, and
         * which direction is decided by the same id ordering that decides who
         * offers, so the two can never disagree.
         */
        if (!initiate) post('welcome', { from: memberId, to: peerId });
      }

      for (const [peerId, pc] of [...connections.current]) {
        const state = pc.connectionState;

        /**
         * Two ways a connection needs rebuilding, with different clocks.
         *
         * One never arrived — `new` or `connecting` past `STALL_MS`, which is
         * the offer that went to a browser that was not listening. The other
         * arrived and went quiet: `disconnected` heals by itself far more often
         * than not, so it is given `DROP_GRACE_MS` to do so before anything is
         * torn down, and only the ones that do not are rebuilt.
         */
        if (state === 'connected') continue;
        const stale = state === 'disconnected'
          ? now - (droppedAt.current.get(peerId) ?? now) >= DROP_GRACE_MS
          : now - (openedAt.current.get(peerId) ?? now) >= STALL_MS;
        if (!stale) continue;

        const used = rebuilds.current.get(peerId) ?? 0;
        dropPeer(peerId);
        if (used >= MAX_REBUILDS || !roster.includes(peerId)) {
          lostAt.current.set(peerId, now);
          mark(peerId, 'lost');
          continue;
        }
        rebuilds.current.set(peerId, used + 1);
        mark(peerId, 'reconnecting');
        // Both halves have to let go, or the offer that follows arrives at a
        // connection the far end still believes in and is discarded.
        post('reset', { from: memberId, to: peerId });
        setRebuild({ peerId, at: now });
      }

      for (const peerId of [...connections.current.keys()]) {
        if (!roster.includes(peerId)) dropPeer(peerId);
      }

      // Somebody who left and came back is a fresh start, not a continuation of
      // whatever went wrong last time — otherwise a rejoin inherits a spent
      // retry budget and is written off before it has tried.
      for (const id of [...rebuilds.current.keys()]) {
        if (!roster.includes(id)) { rebuilds.current.delete(id); lostAt.current.delete(id); }
      }

      /**
       * The bitrate ceiling follows the size of the room.
       *
       * A mesh sends one copy of your camera per person, so the fifth arrival
       * changes what every existing connection can afford — and none of them
       * would otherwise be told. Cheap: `setParameters` on an established
       * sender needs no renegotiation.
       */
      const bitrate = sharingRef.current ? SHARE_BITRATE : videoBitrateFor(roster.length);
      if (bitrate !== shapedFor.current) {
        shapedFor.current = bitrate;
        for (const pc of connections.current.values()) {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            void shapeSender(sender, bitrate,
              sharingRef.current ? 'maintain-resolution' : 'maintain-framerate');
          }
        }
      }

      // Nobody who has left keeps a status on a tile that is no longer drawn.
      setHealth(prev => {
        const next: Record<string, PeerHealth> = {};
        for (const id of roster) if (prev[id]) next[id] = prev[id];
        const same = Object.keys(next).length === Object.keys(prev).length
          && roster.every(id => next[id] === prev[id]);
        return same ? prev : next;
      });
    };

    sweep();
    const timer = setInterval(sweep, SWEEP_MS);
    return () => clearInterval(timer);
    // `rosterKey` rather than `admitted`: the list is rebuilt on every refetch,
    // so depending on the array itself would restart this interval a few times
    // a second while nothing about who is here had changed.
  }, [enabled, memberId, linked, rosterKey, connect, dropPeer, post, mark]);

  const flushIce = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queued = pendingIce.current.get(peerId);
    if (!queued?.length) return;
    pendingIce.current.delete(peerId);
    for (const candidate of queued) {
      try { await pc.addIceCandidate(candidate); } catch { /* a stale candidate is not fatal */ }
    }
  }, []);

  // ─── Joining ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled || !meetingId || !memberId) return;

    let cancelled = false;
    const supabase = createClient();
    const chan = supabase.channel(`meeting:${meetingId}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = chan;

    const start = async () => {
      setStatus('requesting-media');
      try {
        /**
         * Audio is always requested; video only for a video meeting.
         *
         * `echoCancellation` and `noiseSuppression` are on because a laptop
         * speaker feeding a laptop microphone in a room of five is the single
         * most common reason a call is abandoned.
         */
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: audioOnly ? false : { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        localRef.current = stream;
        cameraTrack.current = stream.getVideoTracks()[0] ?? null;
        // The counterpart of the 'detail' hint on a shared screen: a face is
        // motion, and should lose pixels before it loses smoothness.
        try {
          if (cameraTrack.current) cameraTrack.current.contentHint = 'motion';
        } catch { /* not everywhere */ }
        setLocalStream(stream);
        setMediaError(null);
      } catch (err: any) {
        /**
         * A refused camera does not end the meeting.
         *
         * Somebody who declines the permission prompt, or has no camera, can
         * still listen and still be heard once they allow the microphone —
         * and a meeting that refuses to open at all because a webcam is
         * missing is a meeting people stop using. The failure is reported and
         * the room is joined without a local stream.
         */
        setMediaError(
          err?.name === 'NotAllowedError'
            ? 'Your browser blocked the microphone and camera. Allow them in the address bar to be seen and heard.'
            : err?.name === 'NotFoundError'
              ? 'No microphone or camera was found. You can still see and hear everyone else.'
              : 'Your microphone and camera could not be started.',
        );
        setMicOn(false);
        setCamOn(false);
      }

      setStatus('connecting');

      /**
       * Realtime authorises with its own token, set separately from the REST
       * client's session — without this the socket connects as `anon`, the
       * subscription succeeds and receives nothing, and a meeting where
       * nobody can see anybody looks identical to a meeting nobody joined.
       */
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) supabase.realtime.setAuth(token);
      } catch { /* an unauthenticated tab simply signals nothing */ }

      if (cancelled) return;

      chan
        /**
         * Somebody has started listening.
         *
         * Both handlers throw away a connection to that person that has not
         * reached `connected`, and start again. It is not tidiness: an offer
         * sent to a browser that was not yet subscribed went nowhere, and the
         * `RTCPeerConnection` left behind is in `new` with a local description
         * set — so the far end's next attempt finds a connection this side
         * believes is already negotiated, and nothing more is ever sent. That
         * is a permanent spinner, cleared here in one round trip instead of
         * waiting `STALL_MS` for the sweep to notice.
         *
         * The roster is still the gate. A browser that merely *says* it is in
         * the meeting is offered nothing — the participant row is what decides,
         * and if it has not arrived yet the sweep will connect within a couple
         * of seconds once it has.
         */
        .on('broadcast', { event: 'hello' }, ({ payload }: any) => {
          const from = payload?.from;
          if (!from || from === memberId) return;
          if (!admittedRef.current.includes(from)) return;
          // Answer so the newcomer learns who is already here, then let the id
          // ordering decide which of the two makes the offer.
          post('welcome', { from: memberId, to: from });
          const existing = connections.current.get(from);
          if (existing && existing.connectionState !== 'connected') dropPeer(from);
          connect(from, memberId < from);
        })
        .on('broadcast', { event: 'welcome' }, ({ payload }: any) => {
          const from = payload?.from;
          if (!from || payload?.to !== memberId) return;
          if (!admittedRef.current.includes(from)) return;
          const existing = connections.current.get(from);
          if (existing && existing.connectionState !== 'connected') dropPeer(from);
          connect(from, memberId < from);
        })
        .on('broadcast', { event: 'offer' }, ({ payload }: any) => {
          const from = payload?.from;
          if (!from || payload?.to !== memberId) return;
          if (!admittedRef.current.includes(from)) return;
          void (async () => {
            const pc = connect(from, false);
            try {
              await pc.setRemoteDescription(payload.sdp);
              await flushIce(from, pc);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              post('answer', { from: memberId, to: from, sdp: pc.localDescription });
            } catch {
              dropPeer(from);
            }
          })();
        })
        .on('broadcast', { event: 'answer' }, ({ payload }: any) => {
          const from = payload?.from;
          if (!from || payload?.to !== memberId) return;
          const pc = connections.current.get(from);
          if (!pc) return;
          void (async () => {
            try {
              await pc.setRemoteDescription(payload.sdp);
              await flushIce(from, pc);
            } catch { dropPeer(from); }
          })();
        })
        .on('broadcast', { event: 'ice' }, ({ payload }: any) => {
          const from = payload?.from;
          if (!from || payload?.to !== memberId) return;
          const pc = connections.current.get(from);
          if (!pc || !pc.remoteDescription) {
            const queue = pendingIce.current.get(from) ?? [];
            queue.push(payload.candidate);
            pendingIce.current.set(from, queue);
            return;
          }
          void pc.addIceCandidate(payload.candidate).catch(() => undefined);
        })
        .on('broadcast', { event: 'bye' }, ({ payload }: any) => {
          if (payload?.from) dropPeer(payload.from);
        })
        /**
         * The far end's connection to us failed and it is rebuilding.
         *
         * Ours may still look healthy from here — a peer connection can fail
         * in one direction — so it has to be let go deliberately, or the offer
         * that follows arrives at a connection that thinks it is already
         * negotiated and is discarded.
         */
        .on('broadcast', { event: 'reset' }, ({ payload }: any) => {
          const from = payload?.from;
          if (!from || payload?.to !== memberId) return;
          dropPeer(from);
          if (!admittedRef.current.includes(from)) return;
          setRebuild({ peerId: from, at: Date.now() });
        });

      chan.subscribe((state) => {
        if (cancelled) return;
        if (state === 'SUBSCRIBED') {
          // The sweep is gated on this: everything it does is a message, and a
          // message sent before the channel has joined is simply dropped.
          setLinked(true);
          post('hello', { from: memberId });
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
          setLinked(false);
          setStatus('failed');
        }
      });
    };

    void start();

    return () => {
      cancelled = true;
      // Telling everybody before the socket goes is what stops a departed
      // participant sitting in the grid as a frozen frame until their peer
      // connection times out, which takes tens of seconds.
      post('bye', { from: memberId });
      for (const pc of connections.current.values()) pc.close();
      connections.current.clear();
      pendingIce.current.clear();
      rebuilds.current.clear();
      openedAt.current.clear();
      droppedAt.current.clear();
      lostAt.current.clear();
      shapedFor.current = 0;
      sharingRef.current = false;
      setLinked(false);
      setHealth({});
      localRef.current?.getTracks().forEach(t => t.stop());
      localRef.current = null;
      cameraTrack.current = null;
      setLocalStream(null);
      setPeers([]);
      setStatus('idle');
      channelRef.current = null;
      void supabase.removeChannel(chan);
    };
    // `admitted` is deliberately absent: it is read through a ref, because a
    // change to the guest list must not tear down and rebuild every peer
    // connection in the room.
  }, [enabled, meetingId, memberId, audioOnly, connect, dropPeer, flushIce, post]);

  /**
   * Somebody who has left the room loses their connection.
   *
   * Separate from the effect above so that the guest list changing costs one
   * comparison rather than a full re-subscribe.
   */
  useEffect(() => {
    for (const peerId of connections.current.keys()) {
      if (!admitted.includes(peerId)) dropPeer(peerId);
    }
  }, [admitted, dropPeer]);

  // ─── Controls ────────────────────────────────────────────────────────────

  /**
   * Muting disables the track rather than stopping it.
   *
   * A stopped track has to be re-acquired — which re-prompts for permission in
   * some browsers and always renegotiates with every peer. Disabling is
   * instant, and the far end receives silence, which is what mute means.
   */
  const toggleMic = useCallback(() => {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }, []);

  const toggleCam = useCallback(() => {
    const track = localRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
  }, []);

  /** Silence somebody who has been muted by the host. Called from the room. */
  const forceMute = useCallback(() => {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = false;
    setMicOn(false);
  }, []);

  /**
   * Share a screen, or stop.
   *
   * ── Why `replaceTrack` and not a second stream ───────────────────────────
   *
   * Adding the display capture as an extra track means renegotiating with
   * every peer in the mesh — a new offer and answer per participant, each of
   * which can fail on its own. Swapping the track inside the sender that is
   * already carrying the camera needs no renegotiation at all: the far end
   * simply starts receiving different pixels on the track it already has.
   *
   * The consequence, stated plainly: while sharing, your camera is not also
   * visible. That is the trade for a share that connects instantly and cannot
   * half-fail, and it matches what people expect from the button.
   */
  const stopShare = useCallback(async () => {
    const track = cameraTrack.current;
    sharingRef.current = false;
    // Back to a face, which wants its framerate kept and needs far less of the
    // network than a screenful of text did.
    const bitrate = videoBitrateFor(admittedRef.current.length);
    shapedFor.current = bitrate;
    for (const pc of connections.current.values()) {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (!sender) continue;
      await sender.replaceTrack(track ?? null);
      void shapeSender(sender, bitrate, 'maintain-framerate');
    }
    localRef.current?.getVideoTracks()
      .filter(t => t !== track)
      .forEach(t => { t.stop(); localRef.current?.removeTrack(t); });
    if (track) localRef.current?.addTrack(track);
    setSharing(false);
    setLocalStream(localRef.current ? new MediaStream(localRef.current.getTracks()) : null);
  }, []);

  const toggleShare = useCallback(async () => {
    if (sharing) { await stopShare(); return; }

    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenTrack = display.getVideoTracks()[0];
      if (!screenTrack) return;

      /**
       * The browser's own "Stop sharing" bar ends the track without telling
       * this component, so the track itself is what is listened to.
       *
       * It calls `stopShare` rather than `toggleShare`: stopping is
       * unconditional here — the track has already ended — and a toggle read
       * from a stale closure would see `sharing` as false and start a second
       * share instead of tidying up after the first.
       */
      screenTrack.onended = () => { void stopShare(); };

      /**
       * Tell the encoder what it is looking at.
       *
       * `contentHint` is the difference between a shared document that stays
       * sharp and one that turns to mush the moment somebody scrolls: 'detail'
       * asks for spatial fidelity over temporal, which is the opposite of what
       * a camera wants and exactly right for a screen.
       */
      try { screenTrack.contentHint = 'detail'; } catch { /* not everywhere */ }

      sharingRef.current = true;
      shapedFor.current = SHARE_BITRATE;
      for (const pc of connections.current.values()) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (!sender) continue;
        await sender.replaceTrack(screenTrack);
        void shapeSender(sender, SHARE_BITRATE, 'maintain-resolution');
      }

      const camera = localRef.current?.getVideoTracks()[0] ?? null;
      if (camera) { cameraTrack.current = camera; localRef.current?.removeTrack(camera); }
      localRef.current?.addTrack(screenTrack);
      setSharing(true);
      setLocalStream(localRef.current ? new MediaStream(localRef.current.getTracks()) : null);
    } catch {
      // Cancelling the picker is not an error worth showing anybody.
    }
  }, [sharing, stopShare]);

  return {
    status,
    localStream,
    peers,
    micOn,
    camOn,
    sharing,
    mediaError,
    /**
     * How each connection is doing, by membership id.
     *
     * The grid renders it rather than spinning: "connecting", "reconnecting"
     * and "could not connect" ask different things of the person watching, and
     * they were all one animation.
     */
    health,
    toggleMic,
    toggleCam,
    toggleShare,
    forceMute,
  };
}
