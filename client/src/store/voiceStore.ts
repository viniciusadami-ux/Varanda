import { create } from 'zustand';
import type { VoiceParticipant } from '@/types';

interface VoiceState {
  participants: VoiceParticipant[];
  muted: boolean;
  deafened: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
  isSpeaking: boolean;
  micError: string | null;
  screenShareError: string | null;
  screenSharePending: boolean;
  localStream: MediaStream | null;
  localStreamChannelId: number | null;
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
  remoteStreams: Record<number, MediaStream>;
  remoteScreenStreams: Record<number, MediaStream>;

  setParticipants: (p: VoiceParticipant[]) => void;
  addParticipant: (p: VoiceParticipant) => void;
  removeParticipant: (channelId: number, userId: number) => void;
  setMuted: (v: boolean) => void;
  setDeafened: (v: boolean) => void;
  setCameraOn: (v: boolean) => void;
  setScreenSharing: (v: boolean) => void;
  setIsSpeaking: (v: boolean) => void;
  setMicError: (message: string | null) => void;
  setScreenShareError: (message: string | null) => void;
  setScreenSharePending: (pending: boolean) => void;
  setLocalStream: (s: MediaStream | null, channelId?: number | null) => void;
  setCameraStream: (s: MediaStream | null) => void;
  setScreenStream: (s: MediaStream | null) => void;
  setRemoteStream: (userId: number, s: MediaStream | null) => void;
  setRemoteScreenStream: (userId: number, s: MediaStream | null) => void;
  updateParticipant: (userId: number, patch: Partial<VoiceParticipant>) => void;
  reset: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  participants: [],
  muted: false,
  deafened: false,
  cameraOn: false,
  screenSharing: false,
  isSpeaking: false,
  micError: null,
  screenShareError: null,
  screenSharePending: false,
  localStream: null,
  localStreamChannelId: null,
  cameraStream: null,
  screenStream: null,
  remoteStreams: {},
  remoteScreenStreams: {},

  setParticipants: (participants) => set({ participants }),
  addParticipant: (p) =>
    set((s) =>
      s.participants.some((x) => x.userId === p.userId)
        ? { participants: s.participants.map((x) => (x.userId === p.userId ? p : x)) }
        : { participants: [...s.participants, p] }
    ),
  removeParticipant: (_channelId, userId) =>
    set((s) => ({ participants: s.participants.filter((p) => p.userId !== userId) })),
  setMuted: (muted) => set({ muted }),
  setDeafened: (deafened) => set({ deafened }),
  setCameraOn: (cameraOn) => set({ cameraOn }),
  setScreenSharing: (screenSharing) => set({ screenSharing }),
  setIsSpeaking: (isSpeaking) => set({ isSpeaking }),
  setMicError: (micError) => set({ micError }),
  setScreenShareError: (screenShareError) => set({ screenShareError }),
  setScreenSharePending: (screenSharePending) => set({ screenSharePending }),
  setLocalStream: (localStream, channelId = null) =>
    set({ localStream, localStreamChannelId: localStream ? channelId : null }),
  setCameraStream: (cameraStream) => set({ cameraStream }),
  setScreenStream: (screenStream) => set({ screenStream }),
  setRemoteStream: (userId, s) =>
    set((state) => {
      const next = { ...state.remoteStreams };
      if (s) next[userId] = s;
      else delete next[userId];
      return { remoteStreams: next };
    }),
  setRemoteScreenStream: (userId, s) =>
    set((state) => {
      const next = { ...state.remoteScreenStreams };
      if (s) next[userId] = s;
      else delete next[userId];
      return { remoteScreenStreams: next };
    }),
  updateParticipant: (userId, patch) =>
    set((s) => ({
      participants: s.participants.map((participant) =>
        participant.userId === userId ? { ...participant, ...patch } : participant
      ),
    })),
  reset: () =>
    set({
      participants: [],
      muted: false,
      deafened: false,
      cameraOn: false,
      screenSharing: false,
      isSpeaking: false,
      micError: null,
      screenShareError: null,
      screenSharePending: false,
      localStream: null,
      localStreamChannelId: null,
      cameraStream: null,
      screenStream: null,
      remoteStreams: {},
      remoteScreenStreams: {},
    }),
}));
