import { create } from 'zustand';
import type { Message, Reaction } from '@/types';

interface MessageState {
  byChannel: Record<number, Message[]>;
  typing: Record<number, Array<{ userId: number; username: string }>>;

  setMessages: (channelId: number, messages: Message[]) => void;
  appendMessage: (channelId: number, message: Message) => void;
  updateMessage: (channelId: number, messageId: number, content: string) => void;
  removeMessage: (channelId: number, messageId: number) => void;
  setReactions: (channelId: number, messageId: number, reactions: Reaction[]) => void;
  setTyping: (channelId: number, users: Array<{ userId: number; username: string }>) => void;
  reset: () => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  byChannel: {},
  typing: {},

  setMessages: (channelId, messages) =>
    set((s) => ({ byChannel: { ...s.byChannel, [channelId]: messages } })),

  appendMessage: (channelId, message) =>
    set((s) => {
      const list = s.byChannel[channelId] ?? [];
      if (list.some((m) => m.id === message.id)) return s;
      return { byChannel: { ...s.byChannel, [channelId]: [...list, message] } };
    }),

  updateMessage: (channelId, messageId, content) =>
    set((s) => {
      const list = s.byChannel[channelId];
      if (!list) return s;
      return {
        byChannel: {
          ...s.byChannel,
          [channelId]: list.map((m) => (m.id === messageId ? { ...m, content } : m)),
        },
      };
    }),

  removeMessage: (channelId, messageId) =>
    set((s) => {
      const list = s.byChannel[channelId];
      if (!list) return s;
      return {
        byChannel: {
          ...s.byChannel,
          [channelId]: list.filter((m) => m.id !== messageId),
        },
      };
    }),

  setReactions: (channelId, messageId, reactions) =>
    set((s) => {
      const list = s.byChannel[channelId];
      if (!list) return s;
      return {
        byChannel: {
          ...s.byChannel,
          [channelId]: list.map((m) => (m.id === messageId ? { ...m, reactions } : m)),
        },
      };
    }),

  setTyping: (channelId, users) =>
    set((s) => ({ typing: { ...s.typing, [channelId]: users } })),

  reset: () => set({ byChannel: {}, typing: {} }),
}));