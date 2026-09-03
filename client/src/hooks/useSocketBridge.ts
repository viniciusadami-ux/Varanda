import { useEffect, useRef } from 'react';
import { getSocket, disconnectSocket, refreshSocketAuth, socketEmit } from '@/lib/socket';
import {
  createInitiatorConnections,
  handleAnswer,
  handleIceCandidate,
  handleOffer,
  closePeer,
  closeAllPeers,
  configureIceServers,
  markRemoteScreenShare,
} from '@/lib/webrtc';
import { useAppStore } from '@/store/appStore';
import { useFriendStore } from '@/store/friendStore';
import { useMessageStore } from '@/store/messageStore';
import { useServerStore } from '@/store/serverStore';
import { useVoiceStore } from '@/store/voiceStore';
import type {
  DirectMessage,
  Message,
  Reaction,
  UserStatus,
  VoiceParticipant,
} from '@/types';

export function useSocketBridge() {
  const token = useAppStore((s) => s.token);
  const user = useAppStore((s) => s.user);
  const currentServer = useServerStore((s) => s.currentServer);
  const currentChannelId = useServerStore((s) => s.currentChannelId);
  const inVoiceChannel = useAppStore((s) => s.inVoiceChannel);

  const setMembers = useServerStore((s) => s.setMembers);
  const setChannels = useServerStore((s) => s.setChannels);
  const patchCurrentServer = useServerStore((s) => s.patchCurrentServer);

  const setFriends = useFriendStore((s) => s.setFriends);
  const setPresence = useFriendStore((s) => s.setPresence);
  const appendDm = useFriendStore((s) => s.appendDm);

  const appendMessage = useMessageStore((s) => s.appendMessage);
  const updateMessage = useMessageStore((s) => s.updateMessage);
  const removeMessage = useMessageStore((s) => s.removeMessage);
  const setReactions = useMessageStore((s) => s.setReactions);

  const setParticipants = useVoiceStore((s) => s.setParticipants);
  const addVoiceParticipant = useVoiceStore((s) => s.addParticipant);
  const removeVoiceParticipant = useVoiceStore((s) => s.removeParticipant);
  const updateVoiceParticipant = useVoiceStore((s) => s.updateParticipant);
  const localStream = useVoiceStore((s) => s.localStream);
  const localStreamChannelId = useVoiceStore((s) => s.localStreamChannelId);

  const wiredRef = useRef(false);

  useEffect(() => {
    if (!token || !user) {
      disconnectSocket();
      wiredRef.current = false;
      return;
    }
    // New token → re-create socket so handshake picks it up.
    refreshSocketAuth();
    const socket = getSocket();

    const rejoinActiveVoiceChannel = () => {
      const appState = useAppStore.getState();
      const voiceState = useVoiceStore.getState();
      const activeVoiceChannel = appState.inVoiceChannel;
      const activeUser = appState.user;
      const microphoneIsLive = voiceState.localStream
        ?.getAudioTracks()
        .some((track) => track.readyState === 'live');

      if (
        !activeVoiceChannel ||
        !activeUser ||
        !microphoneIsLive ||
        voiceState.localStreamChannelId !== activeVoiceChannel.id
      ) {
        return;
      }

      socketEmit.joinVoice({
        channelId: activeVoiceChannel.id,
        userId: activeUser.id,
        username: activeUser.username,
        displayName: activeUser.displayName,
        avatar: activeUser.avatar,
      });

      // The server's participant entry is tied to the socket id, so restore
      // state that is intentionally kept local across a transport reconnect.
      // These events stay after join_voice on the same Socket.IO connection.
      socketEmit.toggleMute(activeVoiceChannel.id, activeUser.id, voiceState.muted);
      socketEmit.toggleDeafen(activeVoiceChannel.id, activeUser.id, voiceState.deafened);
      const cameraIsLive = voiceState.cameraStream
        ?.getVideoTracks()
        .some((track) => track.readyState === 'live') ?? false;
      socketEmit.toggleCamera(activeVoiceChannel.id, activeUser.id, cameraIsLive);
      const screenIsLive = voiceState.screenStream
        ?.getVideoTracks()
        .some((track) => track.readyState === 'live') ?? false;
      if (screenIsLive && voiceState.screenStream) {
        socketEmit.startScreenShare(activeVoiceChannel.id, activeUser.id, voiceState.screenStream.id);
      }
    };

    const onConnect = () => {
      // Socket.IO gives a reconnect a new socket id. Its previous peer
      // connections cannot be reused, so start fresh while preserving local
      // media (mute/deafen state and captured tracks stay untouched).
      closeAllPeers();
      useVoiceStore.getState().setParticipants([]);
      rejoinActiveVoiceChannel();
    };

    const onDisconnect = (reason: string) => {
      // Explicit logout/unmount already performs cleanup; a transport loss
      // must also discard stale RTCPeerConnections before the next connect.
      if (reason === 'io client disconnect') return;
      closeAllPeers();
      useVoiceStore.getState().setParticipants([]);
    };

    const onUserStatus = (payload: { userId: number; status: UserStatus }) => {
      setPresence(payload.userId, payload.status);
    };

    const onNewMessage = (message: Message) => {
      appendMessage(message.channel_id, message);
    };

    const onMessageEdited = (payload: { messageId: number; content: string }) => {
      const all = useMessageStore.getState().byChannel;
      for (const channelIdStr of Object.keys(all)) {
        const cid = Number(channelIdStr);
        if (all[cid].some((m) => m.id === payload.messageId)) {
          updateMessage(cid, payload.messageId, payload.content);
          break;
        }
      }
    };

    const onMessageDeleted = (payload: { messageId: number }) => {
      const all = useMessageStore.getState().byChannel;
      for (const channelIdStr of Object.keys(all)) {
        const cid = Number(channelIdStr);
        if (all[cid].some((m) => m.id === payload.messageId)) {
          removeMessage(cid, payload.messageId);
          break;
        }
      }
    };

    const onReactionUpdated = (payload: { messageId: number; reactions: Reaction[] }) => {
      const all = useMessageStore.getState().byChannel;
      for (const channelIdStr of Object.keys(all)) {
        const cid = Number(channelIdStr);
        if (all[cid].some((m) => m.id === payload.messageId)) {
          setReactions(cid, payload.messageId, payload.reactions);
          break;
        }
      }
    };

    const onNewDm = (dm: DirectMessage) => {
      const otherId = dm.sender_id === user.id ? dm.receiver_id : dm.sender_id;
      appendDm(otherId, dm);
    };

    const onVoiceParticipants = (payload: {
      channelId: number;
      participants: VoiceParticipant[];
      connectTo?: string[];
    }) => {
      const activeVoiceChannel = useAppStore.getState().inVoiceChannel;
      if (activeVoiceChannel?.id === payload.channelId) {
        setParticipants(payload.participants);
        // The server sends connectTo only to the newest member. That member
        // is the sole offerer for each pair, avoiding simultaneous offers.
        const remoteSocketIds = (payload.connectTo ?? []).filter(
          (socketId): socketId is string => typeof socketId === 'string'
        );
        if (remoteSocketIds.length > 0) {
          createInitiatorConnections(remoteSocketIds).catch((e) =>
            console.warn('[webrtc] createInitiatorConnections failed:', e)
          );
        }
      }
    };

    const onUserJoinedVoice = (payload: { channelId: number; participant: VoiceParticipant }) => {
      if (useAppStore.getState().inVoiceChannel?.id === payload.channelId) {
        addVoiceParticipant(payload.participant);
      }
    };

    const onVoiceIceServers = (payload: { iceServers: RTCIceServer[] }) => {
      configureIceServers(payload.iceServers);
    };

    const onVoiceJoinRejected = (payload: { channelId: number; reason: 'capacity_reached' }) => {
      if (useAppStore.getState().inVoiceChannel?.id === payload.channelId) {
        console.warn('[voice] Não foi possível entrar: limite de participantes atingido.');
      }
    };

    const onUserLeftVoice = (payload: { channelId: number; userId: number }) => {
      if (useAppStore.getState().inVoiceChannel?.id !== payload.channelId) return;
      const before = useVoiceStore.getState().participants;
      const leaver = before.find((p) => p.userId === payload.userId);
      removeVoiceParticipant(payload.channelId, payload.userId);
      useVoiceStore.getState().setRemoteStream(payload.userId, null);
      useVoiceStore.getState().setRemoteScreenStream(payload.userId, null);
      if (leaver?.socketId) {
        closePeer(leaver.socketId);
      } else {
        console.warn(`[socketBridge] user_left_voice without socketId for user ${payload.userId}`);
      }
    };

    const onUserMuted = (payload: { channelId: number; userId: number; muted: boolean }) => {
      if (useAppStore.getState().inVoiceChannel?.id === payload.channelId) {
        updateVoiceParticipant(payload.userId, { muted: payload.muted, ...(payload.muted ? { speaking: false } : {}) });
      }
    };

    const onUserSpeaking = (payload: { channelId: number; userId: number; speaking: boolean }) => {
      if (useAppStore.getState().inVoiceChannel?.id === payload.channelId) {
        updateVoiceParticipant(payload.userId, { speaking: payload.speaking });
      }
    };

    const onUserDeafened = (payload: { channelId: number; userId: number; deafened: boolean }) => {
      if (useAppStore.getState().inVoiceChannel?.id === payload.channelId) {
        updateVoiceParticipant(payload.userId, { deafened: payload.deafened });
      }
    };

    const onScreenShareStarted = (payload: { channelId: number; userId: number; streamId: string }) => {
      if (useAppStore.getState().inVoiceChannel?.id === payload.channelId) {
        updateVoiceParticipant(payload.userId, { screenSharing: true, screenStreamId: payload.streamId });
        markRemoteScreenShare(payload.userId, payload.streamId);
      }
    };

    const onScreenShareStopped = (payload: { channelId: number; userId: number }) => {
      if (useAppStore.getState().inVoiceChannel?.id === payload.channelId) {
        updateVoiceParticipant(payload.userId, { screenSharing: false, screenStreamId: null });
        useVoiceStore.getState().setRemoteScreenStream(payload.userId, null);
      }
    };

    const onCameraToggled = (payload: { channelId: number; userId: number; cameraOn: boolean }) => {
      if (useAppStore.getState().inVoiceChannel?.id === payload.channelId) {
        updateVoiceParticipant(payload.userId, { cameraOn: payload.cameraOn });
      }
    };

    const onWebRTCOffer = (payload: {
      offer: RTCSessionDescriptionInit;
      from: string;
      fromUserId: number;
    }) => {
      handleOffer(payload.from, payload.offer, payload.fromUserId).catch((e) =>
        console.warn(`[webrtc] handleOffer from ${payload.from} failed:`, e)
      );
    };

    const onWebRTCAnswer = (payload: {
      answer: RTCSessionDescriptionInit;
      from: string;
      fromUserId: number;
    }) => {
      handleAnswer(payload.from, payload.answer, payload.fromUserId).catch((e) =>
        console.warn(`[webrtc] handleAnswer from ${payload.from} failed:`, e)
      );
    };

    const onWebRTCIceCandidate = (payload: {
      candidate: RTCIceCandidateInit;
      from: string;
      fromUserId: number;
    }) => {
      handleIceCandidate(payload.from, payload.candidate, payload.fromUserId).catch((e) =>
        // addIceCandidate may log a warning when the remote description
        // isn't set yet — that's expected and harmless.
        console.warn(`[webrtc] handleIceCandidate from ${payload.from} deferred:`, (e as Error)?.message)
      );
    };

    socket.on('connect', onConnect);
    socket.on('user_status', onUserStatus);
    socket.on('new_message', onNewMessage);
    socket.on('message_edited', onMessageEdited);
    socket.on('message_deleted', onMessageDeleted);
    socket.on('reaction_updated', onReactionUpdated);
    socket.on('new_dm', onNewDm);
    socket.on('voice_ice_servers', onVoiceIceServers);
    socket.on('voice_join_rejected', onVoiceJoinRejected);
    socket.on('voice_participants', onVoiceParticipants);
    socket.on('user_joined_voice', onUserJoinedVoice);
    socket.on('user_left_voice', onUserLeftVoice);
    socket.on('user_muted', onUserMuted);
    socket.on('user_speaking', onUserSpeaking);
    socket.on('user_deafened', onUserDeafened);
    socket.on('user_screen_share_started', onScreenShareStarted);
    socket.on('user_screen_share_stopped', onScreenShareStopped);
    socket.on('user_camera_toggled', onCameraToggled);
    socket.on('webrtc_offer', onWebRTCOffer);
    socket.on('webrtc_answer', onWebRTCAnswer);
    socket.on('webrtc_ice_candidate', onWebRTCIceCandidate);
    socket.on('disconnect', onDisconnect);

    wiredRef.current = true;

    // Register all lifecycle handlers before dialing. refreshSocketAuth can
    // hand us an already connected socket after a token refresh, so handle
    // that case explicitly as well.
    if (socket.connected) onConnect();
    else socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('user_status', onUserStatus);
      socket.off('new_message', onNewMessage);
      socket.off('message_edited', onMessageEdited);
      socket.off('message_deleted', onMessageDeleted);
      socket.off('reaction_updated', onReactionUpdated);
      socket.off('new_dm', onNewDm);
      socket.off('voice_ice_servers', onVoiceIceServers);
      socket.off('voice_join_rejected', onVoiceJoinRejected);
      socket.off('voice_participants', onVoiceParticipants);
      socket.off('user_joined_voice', onUserJoinedVoice);
      socket.off('user_left_voice', onUserLeftVoice);
      socket.off('user_muted', onUserMuted);
      socket.off('user_speaking', onUserSpeaking);
      socket.off('user_deafened', onUserDeafened);
      socket.off('user_screen_share_started', onScreenShareStarted);
      socket.off('user_screen_share_stopped', onScreenShareStopped);
      socket.off('user_camera_toggled', onCameraToggled);
      socket.off('webrtc_offer', onWebRTCOffer);
      socket.off('webrtc_answer', onWebRTCAnswer);
      socket.off('webrtc_ice_candidate', onWebRTCIceCandidate);
      socket.off('disconnect', onDisconnect);
      // Tear down all peer connections when the bridge unmounts (e.g. logout).
      closeAllPeers();
    };
  }, [token, user]);

  // Channel enter/leave side-effects.
  useEffect(() => {
    if (!token) return;
    if (currentChannelId != null) socketEmit.joinChannel(currentChannelId);
    return () => {
      if (currentChannelId != null) socketEmit.leaveChannel(currentChannelId);
    };
  }, [currentChannelId, token]);

  // Server enter/leave.
  useEffect(() => {
    if (!token || !currentServer) return;
    socketEmit.joinServer(currentServer.id);
    return () => {
      socketEmit.leaveServer(currentServer.id);
    };
  }, [currentServer?.id, token]);

  // Friend refresh on connect.
  const setFriendsRef = useRef(setFriends);
  setFriendsRef.current = setFriends;
  useEffect(() => {
    if (!token) return;
    const onConnect = async () => {
      try {
        const baseURL =
          (import.meta.env.VITE_API_URL as string | undefined)?.trim() ||
          `http://${useAppStore.getState().serverUrl}:${useAppStore.getState().serverPort}`;
        const res = await fetch(`${baseURL}/api/friends`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setFriendsRef.current(data);
        }
      } catch {
        /* ignore */
      }
    };
    const socket = getSocket();
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
    };
  }, [token]);

  // Expose members/channels updates on join (server detail refreshes).
  useEffect(() => {
    if (!token || !currentServer) return;
    const baseURL =
      (import.meta.env.VITE_API_URL as string | undefined)?.trim() ||
      `http://${useAppStore.getState().serverUrl}:${useAppStore.getState().serverPort}`;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${baseURL}/api/servers/${currentServer.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (data.members) setMembers(data.members);
          if (data.channels) setChannels(data.channels);
          if (data.id && data.name) {
            patchCurrentServer(data);
          }
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentServer?.id, token, patchCurrentServer, setChannels, setMembers]);

  // Do not announce ourselves to the voice room until the microphone stream
  // belongs to this channel and is live. That guarantees initial offers carry
  // audio tracks and avoids renegotiation races during getUserMedia.
  useEffect(() => {
    const microphoneIsLive = localStream?.getAudioTracks().some((track) => track.readyState === 'live');
    if (!token || !inVoiceChannel || !user || !microphoneIsLive || localStreamChannelId !== inVoiceChannel.id) {
      return;
    }
    socketEmit.joinVoice({
      channelId: inVoiceChannel.id,
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
    });
    return () => {
      socketEmit.leaveVoice(inVoiceChannel.id, user.id);
    };
  }, [inVoiceChannel?.id, token, user?.id, localStream, localStreamChannelId]);
}
