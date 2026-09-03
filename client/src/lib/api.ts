import axios, { AxiosError } from 'axios';
import type {
  AuthResponse,
  Channel,
  DirectMessage,
  Friend,
  Message,
  Server,
  User,
} from '@/types';
import { getStoredServerBaseUrl } from '@/lib/serverUrl';

const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
export const api = axios.create({
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  // The selected server can change without reloading Electron. Resolve the
  // address for every request instead of freezing it when this module loads.
  config.baseURL = config.baseURL || envBase || getStoredServerBaseUrl();
  try {
    const token = localStorage.getItem('d2_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch {
    /* ignore */
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => Promise.reject(err)
);

export const authApi = {
  register: (payload: { username: string; displayName?: string; email: string; password: string }) =>
    api.post<AuthResponse>('/api/auth/register', payload).then((r) => r.data),
  login: (payload: { email: string; password: string }) =>
    api.post<AuthResponse>('/api/auth/login', payload).then((r) => r.data),
  me: () => api.get<User>('/api/auth/me').then((r) => r.data),
  updateProfile: (payload: { displayName?: string; avatar?: string; status?: string }) =>
    api.put('/api/auth/profile', payload).then((r) => r.data),
};

export const serversApi = {
  list: () => api.get<Server[]>('/api/servers').then((r) => r.data),
  create: (payload: { name: string; icon?: string | null }) =>
    api.post<{ id: number; name: string; inviteCode: string }>('/api/servers', payload).then((r) => r.data),
  join: (payload: { code: string }) =>
    api.post<{ success: true; server: Server }>('/api/servers/join', payload).then((r) => r.data),
  leave: (serverId: number) =>
    api.post(`/api/servers/${serverId}/leave`).then((r) => r.data),
  delete: (serverId: number) =>
    api.delete(`/api/servers/${serverId}`).then((r) => r.data),
  invite: (serverId: number) =>
    api.post<{ code: string }>(`/api/servers/${serverId}/invite`).then((r) => r.data),
  detail: (serverId: number) =>
    api.get<Server & { members: import('@/types').ServerMember[]; channels: Channel[] }>(
      `/api/servers/${serverId}`
    ).then((r) => r.data),
};

export const channelsApi = {
  create: (payload: { serverId: number; categoryId?: number | null; name: string; type?: 'text' | 'voice' }) =>
    api.post<Channel>('/api/channels', payload).then((r) => r.data),
  delete: (channelId: number) =>
    api.delete(`/api/channels/${channelId}`).then((r) => r.data),
  rename: (channelId: number, name: string) =>
    api.put(`/api/channels/${channelId}`, { name }).then((r) => r.data),
  listMessages: (channelId: number, options?: { before?: number; limit?: number }) =>
    api.get<Message[]>(`/api/channels/${channelId}/messages`, { params: options }).then((r) => r.data),
};

export const messagesApi = {
  send: (payload: {
    channelId: number;
    content: string;
    replyTo?: number | null;
    fileUrl?: string | null;
    fileName?: string | null;
    fileType?: string | null;
  }) => api.post<Message>('/api/messages', payload).then((r) => r.data),
  toggleReaction: (messageId: number, emoji: string) =>
    api.post<{ messageId: number; reactions: Message['reactions'] }>(
      `/api/messages/${messageId}/reactions`,
      { emoji }
    ).then((r) => r.data),
};

export const friendsApi = {
  list: () => api.get<Friend[]>('/api/friends').then((r) => r.data),
  request: (username: string) =>
    api.post('/api/friends/request', { username }).then((r) => r.data),
  accept: (id: number) => api.put(`/api/friends/${id}`, { status: 'accepted' }).then((r) => r.data),
  decline: (id: number) => api.put(`/api/friends/${id}`, { status: 'declined' }).then((r) => r.data),
  remove: (id: number) => api.delete(`/api/friends/${id}`).then((r) => r.data),
  dms: (otherUserId: number, options?: { before?: number; limit?: number }) =>
    api.get<DirectMessage[]>(`/api/friends/dm/${otherUserId}`, { params: options }).then((r) => r.data),
};

export const uploadsApi = {
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api
      .post<{ url: string; name: string; type: string; size: number }>('/api/uploads', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
};
