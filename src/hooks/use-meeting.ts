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

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    connections.current.set(peerId, pc);

    for (const track of localRef.current?.getTracks() ?? []) {
      pc.addTrack(track, localRef.current!);
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
      if (pc.connectionState === 'connected') setStatus('connected');
      // `failed` is terminal and means the connection will not recover on its
      // own; `disconnected` is often a blip and recovers, so it is left alone.
      if (pc.connectionState === 'failed') dropPeer(peerId);
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
  }, [memberId, post, dropPeer]);

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
        .on('broadcast', { event: 'hello' }, ({ payload }: any) => {
          const from = payload?.from;
          if (!from || from === memberId) return;
          if (!admittedRef.current.includes(from)) return;
          // Answer so the newcomer learns who is already here, then let the id
          // ordering decide which of the two makes the offer.
          post('welcome', { from: memberId, to: from });
          connect(from, memberId < from);
        })
        .on('broadcast', { event: 'welcome' }, ({ payload }: any) => {
          const from = payload?.from;
          if (!from || payload?.to !== memberId) return;
          if (!admittedRef.current.includes(from)) return;
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
        });

      chan.subscribe((state) => {
        if (state === 'SUBSCRIBED' && !cancelled) {
          post('hello', { from: memberId });
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
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
    for (const pc of connections.current.values()) {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(track ?? null);
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

      for (const pc of connections.current.values()) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(screenTrack);
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
    toggleMic,
    toggleCam,
    toggleShare,
    forceMute,
  };
}
