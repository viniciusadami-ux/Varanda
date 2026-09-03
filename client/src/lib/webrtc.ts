// WebRTC peer connection management for the voice channel.
//
// Each user maintains one RTCPeerConnection per other participant in the
// same voice channel (mesh topology — adequate for up to 8 users per
// channel, per the product spec).
//
// Audio, camera and screen tracks are added before offer/answer and remote
// tracks are wired to the voice store via ontrack. The signaling flow uses
// polite/impolite negotiation so concurrent track changes do not deadlock.
//
// STUN server: Google's public free STUN is hard-coded for development and
// LAN use. For real internet deployment (users behind symmetric NATs), a
// TURN server will be required — that is out of scope for this phase.
import { getSocket, socketEmit } from './socket';
import { useVoiceStore } from '@/store/voiceStore';

// Public STUN fallback. The authenticated server can replace this with an
// additional TURN entry before a voice participant creates peer connections.
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];
let iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS;

export function configureIceServers(value: RTCIceServer[]): void {
  const valid = value.filter((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.length > 0 && urls.every((url) => typeof url === 'string' && /^(stuns?|turns?):/i.test(url));
  });
  iceServers = valid.length > 0 ? valid : DEFAULT_ICE_SERVERS;
}

type Role = 'initiator' | 'responder';

interface PeerEntry {
  pc: RTCPeerConnection;
  role: Role;
  pendingCandidates: RTCIceCandidateInit[];
  needsRenegotiation: boolean;
  forceRenegotiation: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  restartIceOnNextOffer: boolean;
  iceRestartAttempts: number;
}

// peerSocketId -> entry. Cleared on disconnect or explicit close.
const peers = new Map<string, PeerEntry>();
const socketToUser = new Map<string, number>();
const candidatesBeforePeer = new Map<string, RTCIceCandidateInit[]>();
// The screen-share signal and the media track can arrive in either order.
// Preserve original incoming MediaStreams by user so the late signal can still
// associate its stream id with the already received display track.
const remoteSourceStreams = new Map<number, Map<string, MediaStream>>();

// Listeners that want to know when a peer's connection state changes
// (for UI feedback). Subscribed via onStateChange.
type StateListener = (peerSocketId: string, state: RTCPeerConnectionState) => void;
const stateListeners = new Set<StateListener>();

/**
 * Register a listener that fires whenever a peer's connectionState
 * transitions. Returns an unsubscribe function.
 */
export function onPeerStateChange(fn: StateListener): () => void {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}

function notifyState(peerSocketId: string, state: RTCPeerConnectionState) {
  for (const l of stateListeners) l(peerSocketId, state);
}

function resolveUserId(peerSocketId: string): number | undefined {
  const fromMap = socketToUser.get(peerSocketId);
  if (fromMap !== undefined) return fromMap;
  const participants = useVoiceStore.getState().participants;
  const found = participants.find((p) => p.socketId === peerSocketId)?.userId;
  if (found !== undefined) {
    socketToUser.set(peerSocketId, found);
    return found;
  }
  return undefined;
}

function addTracksFromStream(pc: RTCPeerConnection, stream: MediaStream): boolean {
  const senders = pc.getSenders();
  let added = false;
  for (const track of stream.getTracks()) {
    if (track.readyState !== 'live') continue;
    if (senders.some((s) => s.track && s.track.id === track.id)) continue;
    try {
      pc.addTrack(track, stream);
      added = true;
      console.log(`[webrtc] added local ${track.kind} track ${track.id} to pc`);
    } catch (e) {
      console.warn('[webrtc] addTrack failed:', (e as Error).message);
    }
  }
  return added;
}

function addLocalTracks(pc: RTCPeerConnection): boolean {
  const { localStream, cameraStream, screenStream } = useVoiceStore.getState();
  if (!localStream) {
    console.warn('[webrtc] addLocalTracks: no localStream available');
    return false;
  }
  const audioAdded = addTracksFromStream(pc, localStream);
  const cameraAdded = cameraStream ? addTracksFromStream(pc, cameraStream) : false;
  const screenAdded = screenStream ? addTracksFromStream(pc, screenStream) : false;
  return audioAdded || cameraAdded || screenAdded;
}

async function flushPendingCandidates(peerSocketId: string, entry: PeerEntry): Promise<void> {
  if (!entry.pc.remoteDescription) return;
  const pending = entry.pendingCandidates.splice(0);
  for (const candidate of pending) {
    try {
      await entry.pc.addIceCandidate(candidate);
    } catch (e) {
      console.warn(`[webrtc] discarded invalid ICE candidate from ${peerSocketId}:`, e);
    }
  }
}

async function renegotiateWithLocalTracks(
  peerSocketId: string,
  entry: PeerEntry,
  force = false
): Promise<void> {
  const pc = entry.pc;
  if (pc.connectionState === 'closed') return;
  if (pc.signalingState !== 'stable') {
    entry.needsRenegotiation = true;
    entry.forceRenegotiation ||= force;
    return;
  }

  const shouldForce = force || entry.forceRenegotiation || entry.restartIceOnNextOffer;
  const shouldRestartIce = entry.restartIceOnNextOffer;
  entry.needsRenegotiation = false;
  entry.forceRenegotiation = false;
  if (!addLocalTracks(pc) && !shouldForce) return;
  entry.makingOffer = true;
  try {
    const offer = await pc.createOffer(shouldRestartIce ? { iceRestart: true } : undefined);
    // A remote offer can arrive while createOffer is resolving. In that case
    // leave the connection to the perfect-negotiation handler and retry once
    // the signaling state is stable again.
    if (pc.signalingState !== 'stable') {
      entry.needsRenegotiation = true;
      entry.forceRenegotiation ||= shouldForce;
      entry.restartIceOnNextOffer ||= shouldRestartIce;
      return;
    }
    await pc.setLocalDescription(offer);
    entry.restartIceOnNextOffer = false;
    socketEmit.rtcOffer(peerSocketId, offer);
    console.log(`[webrtc] renegotiation offer sent to ${peerSocketId}`);
  } catch (e) {
    console.warn(`[webrtc] renegotiation failed for ${peerSocketId}:`, e);
  } finally {
    entry.makingOffer = false;
  }
}

/**
 * Called when localStream becomes available after PCs were already created
 * without tracks. Attaches tracks to all existing peers and renegotiates if
 * needed (initiator creates new offer). Robust for the race where
 * voice_participants arrives before getUserMedia resolves.
 */
export async function attachLocalStreamToAllPeers(): Promise<void> {
  for (const [socketId, entry] of peers.entries()) {
    await renegotiateWithLocalTracks(socketId, entry);
  }
}

/** Add the active camera tracks to every established peer and renegotiate. */
export async function attachCameraStreamToAllPeers(): Promise<void> {
  const cameraStream = useVoiceStore.getState().cameraStream;
  if (!cameraStream?.getVideoTracks().some((track) => track.readyState === 'live')) return;
  for (const [socketId, entry] of peers.entries()) {
    await renegotiateWithLocalTracks(socketId, entry);
  }
}

/** Add the active display tracks to every established peer and renegotiate. */
export async function attachScreenStreamToAllPeers(): Promise<void> {
  const screenStream = useVoiceStore.getState().screenStream;
  if (!screenStream?.getVideoTracks().some((track) => track.readyState === 'live')) return;
  for (const [socketId, entry] of peers.entries()) {
    await renegotiateWithLocalTracks(socketId, entry);
  }
}

async function removeVideoStreamFromAllPeers(stream: MediaStream): Promise<void> {
  const videoTrackIds = new Set(stream.getVideoTracks().map((track) => track.id));
  for (const [socketId, entry] of peers.entries()) {
    for (const sender of entry.pc.getSenders()) {
      if (sender.track && videoTrackIds.has(sender.track.id)) entry.pc.removeTrack(sender);
    }
    await renegotiateWithLocalTracks(socketId, entry, true);
  }
}

/** Remove this camera stream from each peer before renegotiating the SDP. */
export async function removeCameraStreamFromAllPeers(cameraStream: MediaStream): Promise<void> {
  await removeVideoStreamFromAllPeers(cameraStream);
}

/** Remove this display stream from each peer before renegotiating the SDP. */
export async function removeScreenStreamFromAllPeers(screenStream: MediaStream): Promise<void> {
  await removeVideoStreamFromAllPeers(screenStream);
}

/**
 * Associate an already received MediaStream with a remote screen-share event.
 * This closes the signaling/track arrival race without changing the public
 * voice store, which intentionally remains keyed by userId.
 */
export function markRemoteScreenShare(userId: number, streamId: string): void {
  const sourceStream = remoteSourceStreams.get(userId)?.get(streamId);
  if (sourceStream) useVoiceStore.getState().setRemoteScreenStream(userId, sourceStream);
}

function buildPeerConnection(peerSocketId: string, role: Role): RTCPeerConnection {
  const pc = new RTCPeerConnection({
    iceServers,
    // Don't bundle because Chrome/Electron may not implement it well.
    bundlePolicy: 'balanced',
  });
  const entry: PeerEntry = {
    pc,
    role,
    pendingCandidates: candidatesBeforePeer.get(peerSocketId) ?? [],
    needsRenegotiation: false,
    forceRenegotiation: false,
    makingOffer: false,
    ignoreOffer: false,
    restartIceOnNextOffer: false,
    iceRestartAttempts: 0,
  };
  candidatesBeforePeer.delete(peerSocketId);

  pc.addEventListener('icecandidate', (e) => {
    if (e.candidate) {
      socketEmit.rtcIce(peerSocketId, e.candidate.toJSON());
    }
  });

  pc.addEventListener('connectionstatechange', () => {
    console.log(`[webrtc] peer ${peerSocketId} state ->`, pc.connectionState);
    notifyState(peerSocketId, pc.connectionState);
    const current = peers.get(peerSocketId);
    if (pc.connectionState === 'failed' && current) {
      // A transient route/NAT failure can often be repaired by exchanging new
      // ICE credentials. Both sides may ask at once; handleOffer resolves that
      // offer collision safely below.
      if (current.iceRestartAttempts < 2) {
        current.iceRestartAttempts += 1;
        current.restartIceOnNextOffer = true;
        void renegotiateWithLocalTracks(peerSocketId, current, true);
      } else {
        closePeer(peerSocketId);
      }
    } else if (pc.connectionState === 'closed') {
      closePeer(peerSocketId);
    } else if (pc.connectionState === 'connected' && current) {
      current.iceRestartAttempts = 0;
    }
  });

  pc.addEventListener('signalingstatechange', () => {
    const current = peers.get(peerSocketId);
    if (pc.signalingState === 'stable' && current?.needsRenegotiation) {
      void renegotiateWithLocalTracks(
        peerSocketId,
        current,
        current.forceRenegotiation || current.restartIceOnNextOffer
      );
    }
  });

  pc.addEventListener('track', (e) => {
    console.log(
      `[webrtc] track from ${peerSocketId}:`,
      e.track.kind,
      e.streams.length,
      'streams'
    );
    const userId = resolveUserId(peerSocketId);
    if (userId === undefined) {
      console.warn(`[webrtc] ontrack from unknown peer ${peerSocketId} (no userId mapping), ignoring`);
      return;
    }
    socketToUser.set(peerSocketId, userId);
    const existing = useVoiceStore.getState().remoteStreams[userId];
    // Audio and camera can arrive in separate MediaStreams after
    // renegotiation. Keep one stable stream per user so adding video never
    // replaces their audio element's source.
    const targetStream = existing ?? new MediaStream();
    if (!targetStream.getTracks().some((track) => track.id === e.track.id)) {
      targetStream.addTrack(e.track);
    }
    const remoteParticipant = useVoiceStore
      .getState()
      .participants.find((participant) => participant.userId === userId);
    const sourceStream = e.streams[0];
    if (sourceStream) {
      const sources = remoteSourceStreams.get(userId) ?? new Map<string, MediaStream>();
      sources.set(sourceStream.id, sourceStream);
      remoteSourceStreams.set(userId, sources);
    }
    const isScreenTrack =
      e.track.kind === 'video' &&
      remoteParticipant?.screenSharing === true &&
      (sourceStream?.id === remoteParticipant.screenStreamId || e.track.contentHint === 'detail');
    if (isScreenTrack && sourceStream) {
      useVoiceStore.getState().setRemoteScreenStream(userId, sourceStream);
    }
    // Keep stream alive: when track ends, clean up
    e.track.addEventListener('ended', () => {
      const cur = useVoiceStore.getState().remoteStreams[userId];
      if (!cur) return;
      try { cur.removeTrack(e.track); } catch {}
      const remaining = cur.getTracks().filter((t) => t.readyState !== 'ended');
      if (remaining.length === 0) {
        useVoiceStore.getState().setRemoteStream(userId, null);
        console.log(`[webrtc] track ended, removed remoteStream for user ${userId}`);
      } else {
        useVoiceStore.getState().setRemoteStream(userId, cur);
      }
      if (isScreenTrack) useVoiceStore.getState().setRemoteScreenStream(userId, null);
      if (sourceStream) {
        const sources = remoteSourceStreams.get(userId);
        sources?.delete(sourceStream.id);
        if (sources?.size === 0) remoteSourceStreams.delete(userId);
      }
    });
    useVoiceStore.getState().setRemoteStream(userId, targetStream);
    console.log(`[webrtc] setRemoteStream userId=${userId} stream=${targetStream.id} tracks=${targetStream.getTracks().map((t) => t.kind+':'+t.id).join(',')}`);
  });

  peers.set(peerSocketId, entry);
  console.log(`[webrtc] created ${role} pc for ${peerSocketId}`);
  return pc;
}

/**
 * Get the RTCPeerConnection for a given peer socket id, or undefined.
 */
export function getPeer(peerSocketId: string): RTCPeerConnection | undefined {
  return peers.get(peerSocketId)?.pc;
}

/**
 * List of current peer socket ids we have a connection for.
 */
export function listPeers(): string[] {
  return Array.from(peers.keys());
}

/**
 * Initiator side: new joiner creates connections to every existing
 * participant. Returns the array of peer socket ids a connection was
 * created for.
 */
export async function createInitiatorConnections(peersToConnectTo: string[]): Promise<string[]> {
  const localStream = useVoiceStore.getState().localStream;
  if (!localStream?.getAudioTracks().some((track) => track.readyState === 'live')) {
    console.warn('[webrtc] refusing to negotiate before the local microphone is ready');
    return [];
  }
  const created: string[] = [];
  for (const peerId of peersToConnectTo) {
    if (peers.has(peerId)) continue;
    const resolvedUserId = resolveUserId(peerId);
    if (resolvedUserId !== undefined) socketToUser.set(peerId, resolvedUserId);
    const pc = buildPeerConnection(peerId, 'initiator');
    const entry = peers.get(peerId);
    if (!entry) continue;
    addLocalTracks(pc);
    entry.makingOffer = true;
    try {
      const offer = await pc.createOffer();
      if (pc.signalingState !== 'stable') continue;
      await pc.setLocalDescription(offer);
      socketEmit.rtcOffer(peerId, offer);
    } finally {
      entry.makingOffer = false;
    }
    created.push(peerId);
  }
  return created;
}

/**
 * Responder side: handle an incoming offer. Creates a PC if needed,
 * sets the remote description, generates an answer, sets the local
 * description, and sends the answer back.
 */
export async function handleOffer(fromSocketId: string, offer: RTCSessionDescriptionInit, fromUserId?: number): Promise<void> {
  if (fromUserId !== undefined) socketToUser.set(fromSocketId, fromUserId);
  else {
    const resolved = resolveUserId(fromSocketId);
    if (resolved !== undefined) socketToUser.set(fromSocketId, resolved);
  }
  let entry = peers.get(fromSocketId);
  if (!entry) {
    buildPeerConnection(fromSocketId, 'responder');
    entry = peers.get(fromSocketId);
  }
  if (!entry) return;
  const pc = entry.pc;
  const offerCollision = entry.makingOffer || pc.signalingState !== 'stable';
  // The responder is the polite side. The initiator ignores a colliding
  // offer, while the responder rolls its local offer back and answers. This
  // is the standard "perfect negotiation" tie-breaker.
  const isPolite = entry.role === 'responder';
  entry.ignoreOffer = !isPolite && offerCollision;
  if (entry.ignoreOffer) {
    console.log(`[webrtc] ignored colliding offer from ${fromSocketId}`);
    return;
  }

  if (offerCollision && pc.signalingState === 'have-local-offer') {
    // The local change still needs to be reflected after answering the
    // remote offer, so schedule a fresh offer once the answer is stable.
    entry.needsRenegotiation = true;
    entry.forceRenegotiation = true;
    await pc.setLocalDescription({ type: 'rollback' });
  }

  await pc.setRemoteDescription(offer);
  await flushPendingCandidates(fromSocketId, entry);
  addLocalTracks(pc);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socketEmit.rtcAnswer(fromSocketId, answer);
}

/**
 * Handle an incoming answer (on the initiator side). Sets the remote
 * description on the existing PC.
 */
export async function handleAnswer(fromSocketId: string, answer: RTCSessionDescriptionInit, fromUserId?: number): Promise<void> {
  if (fromUserId !== undefined) socketToUser.set(fromSocketId, fromUserId);
  const entry = peers.get(fromSocketId);
  if (!entry) {
    console.warn(`[webrtc] answer from unknown peer ${fromSocketId}`);
    return;
  }
  if (entry.pc.signalingState !== 'have-local-offer') {
    console.warn(`[webrtc] ignored unexpected answer from ${fromSocketId} in ${entry.pc.signalingState}`);
    return;
  }
  await entry.pc.setRemoteDescription(answer);
  await flushPendingCandidates(fromSocketId, entry);
}

/**
 * Handle an incoming ICE candidate. Candidates that arrive before the peer
 * or remote description are queued explicitly and flushed after SDP is set.
 */
export async function handleIceCandidate(fromSocketId: string, candidate: RTCIceCandidateInit, fromUserId?: number): Promise<void> {
  if (fromUserId !== undefined) socketToUser.set(fromSocketId, fromUserId);
  const entry = peers.get(fromSocketId);
  if (!entry) {
    const pending = candidatesBeforePeer.get(fromSocketId) ?? [];
    pending.push(candidate);
    candidatesBeforePeer.set(fromSocketId, pending);
    return;
  }
  if (entry.ignoreOffer) return;
  if (!entry.pc.remoteDescription) {
    entry.pendingCandidates.push(candidate);
    return;
  }
  try {
    await entry.pc.addIceCandidate(candidate);
  } catch (e) {
    console.warn(`[webrtc] addIceCandidate from ${fromSocketId} failed:`, (e as Error).message);
  }
}

/**
 * Close and remove a single peer's connection.
 */
export function closePeer(peerSocketId: string): void {
  const userId = socketToUser.get(peerSocketId) ?? resolveUserId(peerSocketId);
  const entry = peers.get(peerSocketId);
  if (!entry) {
    if (userId !== undefined) {
      useVoiceStore.getState().setRemoteStream(userId, null);
      useVoiceStore.getState().setRemoteScreenStream(userId, null);
      remoteSourceStreams.delete(userId);
      socketToUser.delete(peerSocketId);
      console.log(`[webrtc] cleared remoteStream for user ${userId} (peer ${peerSocketId} already gone)`);
    }
    return;
  }
  // Remove the entry before pc.close() fires connectionstatechange; otherwise
  // a synchronous "closed" event can recursively attempt the same cleanup.
  peers.delete(peerSocketId);
  candidatesBeforePeer.delete(peerSocketId);
  try {
    entry.pc.close();
  } catch {
    /* noop */
  }
  if (userId !== undefined) {
    useVoiceStore.getState().setRemoteStream(userId, null);
    useVoiceStore.getState().setRemoteScreenStream(userId, null);
    remoteSourceStreams.delete(userId);
    socketToUser.delete(peerSocketId);
    console.log(`[webrtc] closed peer ${peerSocketId} (user ${userId}) and cleared remoteStream`);
  } else {
    console.log(`[webrtc] closed peer ${peerSocketId}`);
  }
}

/**
 * Close all peer connections. Called on logout / app shutdown.
 */
export function closeAllPeers(): void {
  for (const id of Array.from(peers.keys())) closePeer(id);
  socketToUser.clear();
  candidatesBeforePeer.clear();
  remoteSourceStreams.clear();
  // Ensure any orphan remoteStreams are cleared (voiceStore.reset also does)
  const store = useVoiceStore.getState();
  for (const uid of Object.keys(store.remoteStreams)) {
    store.setRemoteStream(Number(uid), null);
  }
  for (const uid of Object.keys(store.remoteScreenStreams)) {
    store.setRemoteScreenStream(Number(uid), null);
  }
}

/**
 * Helper for debugging: dump current peer map.
 */
export function _debugPeers(): string[] {
  return Array.from(peers.keys());
}

// Sanity: ensure the socket is the same used elsewhere.
export function _selfCheck(): void {
  void getSocket();
}
