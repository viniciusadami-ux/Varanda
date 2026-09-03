import { create } from 'zustand';
import type { DirectMessage, Friend, UserStatus } from '@/types';

interface FriendState {
  friends: Friend[];
  incomingRequests: Friend[];
  presence: Record<number, UserStatus>;
  dmByFriend: Record<number, DirectMessage[]>;
  activeDmFriendId: number | null;

  setFriends: (friends: Friend[]) => void;
  setIncomingRequests: (reqs: Friend[]) => void;
  setPresence: (userId: number, status: UserStatus) => void;
  setDms: (friendId: number, dms: DirectMessage[]) => void;
  appendDm: (friendId: number, dm: DirectMessage) => void;
  setActiveDmFriendId: (id: number | null) => void;
  reset: () => void;
}

export const useFriendStore = create<FriendState>((set) => ({
  friends: [],
  incomingRequests: [],
  presence: {},
  dmByFriend: {},
  activeDmFriendId: null,

  setFriends: (friends) => set({ friends }),
  setIncomingRequests: (reqs) => set({ incomingRequests: reqs }),
  setPresence: (userId, status) =>
    set((s) => ({ presence: { ...s.presence, [userId]: status } })),

  setDms: (friendId, dms) =>
    set((s) => ({ dmByFriend: { ...s.dmByFriend, [friendId]: dms } })),

  appendDm: (friendId, dm) =>
    set((s) => {
      const list = s.dmByFriend[friendId] ?? [];
      if (list.some((m) => m.id === dm.id)) return s;
      return { dmByFriend: { ...s.dmByFriend, [friendId]: [...list, dm] } };
    }),

  setActiveDmFriendId: (id) => set({ activeDmFriendId: id }),
  reset: () =>
    set({
      friends: [],
      incomingRequests: [],
      presence: {},
      dmByFriend: {},
      activeDmFriendId: null,
    }),
}));