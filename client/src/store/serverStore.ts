import { create } from 'zustand';
import type { Channel, Server, ServerMember } from '@/types';

interface ServerState {
  servers: Server[];
  currentServer: Server | null;
  members: ServerMember[];
  channels: Channel[];
  currentChannelId: number | null;

  setServers: (servers: Server[]) => void;
  setCurrentServer: (server: Server | null) => void;
  patchCurrentServer: (server: Partial<Server> & Pick<Server, 'id'>) => void;
  setMembers: (members: ServerMember[]) => void;
  setChannels: (channels: Channel[]) => void;
  setCurrentChannelId: (id: number | null) => void;
  addServer: (server: Server) => void;
  reset: () => void;
}

export const useServerStore = create<ServerState>((set) => ({
  servers: [],
  currentServer: null,
  members: [],
  channels: [],
  currentChannelId: null,

  setServers: (servers) => set({ servers }),
  setCurrentServer: (server) =>
    set({
      currentServer: server,
      members: [],
      channels: [],
      currentChannelId: null,
    }),
  patchCurrentServer: (server) =>
    set((state) =>
      state.currentServer?.id === server.id
        ? { currentServer: { ...state.currentServer, ...server } }
        : state
    ),
  setMembers: (members) => set({ members }),
  setChannels: (channels) => set({ channels }),
  setCurrentChannelId: (id) => set({ currentChannelId: id }),
  addServer: (server) =>
    set((s) => (s.servers.find((x) => x.id === server.id) ? s : { servers: [...s.servers, server] })),
  reset: () =>
    set({
      servers: [],
      currentServer: null,
      members: [],
      channels: [],
      currentChannelId: null,
    }),
}));
