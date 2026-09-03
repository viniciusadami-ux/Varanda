import { io, type Socket } from 'socket.io-client';
import type {
  DirectMessage,
  Message,
  Reaction,
  UserStatus,
  VoiceParticipant,
} from '@/types';
import { getStoredServerBaseUrl } from '@/lib/serverUrl';

function resolveBaseUrl(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (envBase) return envBase.replace(/\/$/, '');
  return getStoredServerBaseUrl();
}

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  const token = typeof window !== 'undefined' ? localStorage.getItem('d2_token') : null;
  socket = io(resolveBaseUrl(), {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    auth: token ? { token } : undefined,
    // Keep the authenticated Socket.IO session trying after short network
    // interruptions. useSocketBridge re-enters the active voice room on the
    // next successful connect.
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5_000,
    randomizationFactor: 0.25,
  });
  return socket;
}

export function refreshSocketAuth(): void {
  // Re-create the socket so the new token is sent in the next handshake.
  // The server (io.use middleware) closes any connection with a stale token.
  if (socket) {
    const wasConnected = socket.connected;
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    const fresh = getSocket();
    if (wasConnected) fresh.connect();
  }
}

/** Drop the current Socket.IO client after changing the selected server. */
export function resetSocketConnection(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

export function disconnectSocket(): void {
  if (socket && socket.connected) socket.disconnect();
}

export const socketEmit = {
  authenticate: (userId: number) => getSocket().emit('authenticate', userId),

  joinServer: (serverId: number) => getSocket().emit('join_server', serverId),
  leaveServer: (serverId: number) => getSocket().emit('leave_server', serverId),
  joinChannel: (channelId: number) => getSocket().emit('join_channel', channelId),
  leaveChannel: (channelId: number) => getSocket().emit('leave_channel', channelId),

  sendMessage: (payload: {
    channelId: number;
    content: string;
    userId: number;
    replyTo?: number | null;
    fileUrl?: string | null;
    fileName?: string | null;
    fileType?: string | null;
  }) => getSocket().emit('send_message', payload),

  editMessage: (messageId: number, content: string, userId: number) =>
    getSocket().emit('edit_message', { messageId, content, userId }),

  deleteMessage: (messageId: number, userId: number) =>
    getSocket().emit('delete_message', { messageId, userId }),

  toggleReaction: (messageId: number, userId: number, emoji: string) =>
    getSocket().emit('toggle_reaction', { messageId, userId, emoji }),

  typing: (channelId: number, userId: number, username: string) =>
    getSocket().emit('typing', { channelId, userId, username }),

  joinVoice: (payload: {
    channelId: number;
    userId: number;
    username: string;
    displayName?: string;
    avatar?: string | null;
  }) => getSocket().emit('join_voice', payload),

  leaveVoice: (channelId: number, userId: number) =>
    getSocket().emit('leave_voice', { channelId, userId }),

  rtcOffer: (to: string, offer: RTCSessionDescriptionInit) =>
    getSocket().emit('webrtc_offer', { to, offer }),
  rtcAnswer: (to: string, answer: RTCSessionDescriptionInit) =>
    getSocket().emit('webrtc_answer', { to, answer }),
  rtcIce: (to: string, candidate: RTCIceCandidateInit) =>
    getSocket().emit('webrtc_ice_candidate', { to, candidate }),

  toggleMute: (channelId: number, userId: number, muted: boolean) =>
    getSocket().emit('toggle_mute', { channelId, userId, muted }),
  speakingState: (channelId: number, userId: number, speaking: boolean) =>
    getSocket().emit('speaking_state', { channelId, userId, speaking }),
  toggleDeafen: (channelId: number, userId: number, deafened: boolean) =>
    getSocket().emit('toggle_deafen', { channelId, userId, deafened }),
  startScreenShare: (channelId: number, userId: number, streamId: string) =>
    getSocket().emit('start_screen_share', { channelId, userId, streamId }),
  stopScreenShare: (channelId: number, userId: number) =>
    getSocket().emit('stop_screen_share', { channelId, userId }),
  toggleCamera: (channelId: number, userId: number, cameraOn: boolean) =>
    getSocket().emit('toggle_camera', { channelId, userId, cameraOn }),

  sendDm: (
    senderId: number,
    receiverId: number,
    content: string,
    ack?: (res: { success?: boolean; error?: string; message?: DirectMessage }) => void
  ) => {
    const socket = getSocket();
    if (typeof ack === 'function') {
      socket.emit('send_dm', { senderId, receiverId, content }, ack);
    } else {
      socket.emit('send_dm', { senderId, receiverId, content });
    }
  },

  updateStatus: (userId: number, status: 'online' | 'idle' | 'dnd' | 'invisible') =>
    getSocket().emit('update_status', { userId, status }),
};

export interface IncomingEvents {
  new_message: Message;
  message_edited: { messageId: number; content: string };
  message_deleted: { messageId: number };
  reaction_updated: { messageId: number; reactions: Reaction[] };
  user_typing: { channelId: number; userId: number; username: string };

  user_status: { userId: number; status: UserStatus };
  presence_snapshot: Record<string, UserStatus>;

  new_dm: DirectMessage;
  dm_error: { error: string };
  dm_sent: { message: DirectMessage };

  voice_participants: { channelId: number; participants: VoiceParticipant[]; connectTo?: string[] };
  voice_ice_servers: { iceServers: RTCIceServer[] };
  voice_join_rejected: { channelId: number; reason: 'capacity_reached' };
  user_joined_voice: { channelId: number; participant: VoiceParticipant };
  user_left_voice: { channelId: number; userId: number };
  user_muted: { channelId: number; userId: number; muted: boolean };
  user_speaking: { channelId: number; userId: number; speaking: boolean };
  user_deafened: { channelId: number; userId: number; deafened: boolean };
  user_screen_share_started: { channelId: number; userId: number; streamId: string };
  user_screen_share_stopped: { channelId: number; userId: number };
  user_camera_toggled: { channelId: number; userId: number; cameraOn: boolean };

  webrtc_offer: { offer: RTCSessionDescriptionInit; from: string; fromUserId: number };
  webrtc_answer: { answer: RTCSessionDescriptionInit; from: string; fromUserId: number };
  webrtc_ice_candidate: { candidate: RTCIceCandidateInit; from: string; fromUserId: number };
}

export type SocketEventName = keyof IncomingEvents;
