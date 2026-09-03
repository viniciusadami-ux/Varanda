import { create } from 'zustand';
import { refreshSocketAuth, disconnectSocket, resetSocketConnection } from '@/lib/socket';
import { closeAllPeers } from '@/lib/webrtc';
import { useFriendStore } from '@/store/friendStore';
import { useMessageStore } from '@/store/messageStore';
import { useServerStore } from '@/store/serverStore';
import { useVoiceStore } from '@/store/voiceStore';
import type { Channel, User } from '@/types';

export type Screen = 'connection' | 'login' | 'register' | 'app' | 'loading';
export type ThemeMode = 'light' | 'dark' | 'system';
export type ActivePanel = 'home' | 'chat' | 'friends' | 'settings';
export type UserStatusLocal = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

interface ServerConnection {
  ip: string;
  port: string;
  code: string;
}

interface CurrentDmUser {
  id: number;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
}

type SessionUserPayload = Omit<User, 'displayName' | 'createdAt'> & {
  displayName?: string | null;
  display_name?: string | null;
  createdAt?: string;
  created_at?: string;
};

interface AppState {
  screen: Screen;
  activePanel: ActivePanel;
  theme: ThemeMode;
  darkMode: boolean;
  token: string | null;
  user: User | null;
  serverConnection: ServerConnection | null;
  serverUrl: string;
  serverPort: string;

  showProfile: boolean;
  showCreateServer: boolean;

  currentDmUser: CurrentDmUser | null;

  inVoiceChannel: Channel | null;

  setScreen: (screen: Screen) => void;
  setActivePanel: (p: ActivePanel) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleDark: () => void;
  setDarkMode: (dark: boolean) => void;
  setAuth: (token: string | null, user: User | null) => void;
  setUser: (user: User | null) => void;
  logout: () => void;

  setServerConnection: (ip: string, port: string, code: string) => void;
  setServerUrl: (url: string) => void;
  setServerPort: (port: string) => void;

  setShowProfile: (v: boolean) => void;
  setShowCreateServer: (v: boolean) => void;
  setCurrentDmUser: (u: CurrentDmUser | null) => void;

  setInVoiceChannel: (c: Channel | null) => void;

  initialize: () => void;
}

const STORAGE_KEYS = {
  token: 'd2_token',
  user: 'd2_user',
  theme: 'd2_theme',
  serverUrl: 'd2_server_url',
  serverPort: 'd2_server_port',
} as const;

function readLocal(): {
  token: string | null;
  user: User | null;
  theme: ThemeMode;
  serverUrl: string;
  serverPort: string;
} {
  let token: string | null = null;
  let user: User | null = null;
  let theme: ThemeMode = 'dark';
  let serverUrl = 'localhost';
  let serverPort = '3000';
  try {
    token = localStorage.getItem(STORAGE_KEYS.token);
    const raw = localStorage.getItem(STORAGE_KEYS.user);
    if (raw) user = JSON.parse(raw) as User;
    const t = localStorage.getItem(STORAGE_KEYS.theme);
    if (t === 'light' || t === 'dark' || t === 'system') theme = t;
    const u = localStorage.getItem(STORAGE_KEYS.serverUrl);
    if (u) serverUrl = u;
    const p = localStorage.getItem(STORAGE_KEYS.serverPort);
    if (p) serverPort = p;
  } catch {
    /* ignore */
  }
  return { token, user, theme, serverUrl, serverPort };
}

function computeDark(theme: ThemeMode): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveBaseForValidation(): string {
  try {
    const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
    if (envBase) return envBase.replace(/\/$/, '');
    const host = localStorage.getItem(STORAGE_KEYS.serverUrl) || 'localhost';
    const port = localStorage.getItem(STORAGE_KEYS.serverPort) || '3000';
    const hasProtocol = /^https?:\/\//i.test(host);
    const candidate = hasProtocol ? host : `http://${host}`;
    const url = new URL(candidate);
    if (!url.port && port && /^\d{1,5}$/.test(port)) url.port = port;
    url.pathname = ''; url.search = ''; url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return 'http://localhost:3000';
  }
}

async function validateSession(token: string) {
  try {
    const baseURL = resolveBaseForValidation();
    const res = await fetch(`${baseURL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`invalid token ${res.status}`);
    const sessionUser = (await res.json()) as SessionUserPayload;
    const normalized: User = {
      id: sessionUser.id,
      username: sessionUser.username,
      displayName: sessionUser.displayName ?? sessionUser.display_name ?? sessionUser.username,
      email: sessionUser.email,
      avatar: sessionUser.avatar,
      status: sessionUser.status,
      createdAt: sessionUser.createdAt ?? sessionUser.created_at,
    };
    try { localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(normalized)); } catch { /* ignore */ }
    useAppStore.setState({ user: normalized, screen: 'app', activePanel: 'home', currentDmUser: null });
    // Ensure server lists are cleared (no auto-select channel/server)
    useServerStore.getState().reset();
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEYS.token);
      localStorage.removeItem(STORAGE_KEYS.user);
    } catch { /* ignore */ }
    disconnectSocket();
    useAppStore.setState({ token: null, user: null, screen: 'connection', activePanel: 'home', currentDmUser: null, inVoiceChannel: null });
    useServerStore.getState().reset();
    useMessageStore.getState().reset();
    useFriendStore.getState().reset();
    useVoiceStore.getState().reset();
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'connection',
  activePanel: 'home',
  theme: 'dark',
  darkMode: true,
  token: null,
  user: null,
  serverConnection: null,
  serverUrl: 'localhost',
  serverPort: '3000',

  showProfile: false,
  showCreateServer: false,

  currentDmUser: null,

  inVoiceChannel: null,

  setScreen: (screen) => set({ screen }),
  setActivePanel: (activePanel) => set({ activePanel }),
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEYS.theme, theme);
    } catch {
      /* ignore */
    }
    set({ theme, darkMode: computeDark(theme) });
  },
  toggleDark: () => {
    const next = !get().darkMode;
    try {
      localStorage.setItem(STORAGE_KEYS.theme, next ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
    set({ theme: next ? 'dark' : 'light', darkMode: next });
  },
  setDarkMode: (darkMode) => set({ darkMode }),
  setAuth: (token, user) => {
    try {
      if (token) localStorage.setItem(STORAGE_KEYS.token, token);
      else localStorage.removeItem(STORAGE_KEYS.token);
      if (user) localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
      else localStorage.removeItem(STORAGE_KEYS.user);
    } catch {
      /* ignore */
    }
    // The socket reads the token from localStorage on each connection;
    // re-create it so the new token is used in the next handshake.
    if (token) refreshSocketAuth();
    else disconnectSocket();
    if (token && user) {
      // After login/register go to home, clear stale DM/server selections but keep voice alive
      useServerStore.getState().reset();
      set({ token, user, activePanel: 'home', currentDmUser: null, screen: 'app' });
    } else {
      set({ token, user });
    }
  },
  setUser: (user) => {
    try {
      if (user) localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
      else localStorage.removeItem(STORAGE_KEYS.user);
    } catch {
      /* ignore */
    }
    set({ user });
  },
  logout: () => {
    try {
      localStorage.removeItem(STORAGE_KEYS.token);
      localStorage.removeItem(STORAGE_KEYS.user);
    } catch {
      /* ignore */
    }
    const voiceState = useVoiceStore.getState();
    for (const stream of [voiceState.localStream, voiceState.cameraStream, voiceState.screenStream]) {
      stream?.getTracks().forEach((track) => track.stop());
    }
    closeAllPeers();
    resetSocketConnection();
    useServerStore.getState().reset();
    useMessageStore.getState().reset();
    useFriendStore.getState().reset();
    voiceState.reset();
    set({
      token: null,
      user: null,
      currentDmUser: null,
      inVoiceChannel: null,
      activePanel: 'home',
      showProfile: false,
      showCreateServer: false,
      screen: 'connection',
    });
  },

  setServerConnection: (ip, port, code) => {
    try {
      localStorage.setItem(STORAGE_KEYS.serverUrl, ip);
      localStorage.setItem(STORAGE_KEYS.serverPort, port);
    } catch {
      /* ignore */
    }
    // Calls may have an old Socket.IO client cached. Disconnect it now so the
    // next login/session always connects to the address the user selected.
    resetSocketConnection();
    set({ serverConnection: { ip, port, code }, serverUrl: ip, serverPort: port });
  },
  setServerUrl: (serverUrl) => {
    try {
      localStorage.setItem(STORAGE_KEYS.serverUrl, serverUrl);
    } catch {
      /* ignore */
    }
    set({ serverUrl });
  },
  setServerPort: (serverPort) => {
    try {
      localStorage.setItem(STORAGE_KEYS.serverPort, serverPort);
    } catch {
      /* ignore */
    }
    set({ serverPort });
  },

  setShowProfile: (showProfile) => set({ showProfile }),
  setShowCreateServer: (showCreateServer) => set({ showCreateServer }),
  setCurrentDmUser: (currentDmUser) => set({ currentDmUser }),

  setInVoiceChannel: (c) => set({ inVoiceChannel: c }),

  initialize: () => {
    const { token, user, theme, serverUrl, serverPort } = readLocal();
    if (token) {
      set({
        token,
        user,
        theme,
        serverUrl,
        serverPort,
        darkMode: computeDark(theme),
        screen: 'loading',
        activePanel: 'home',
        currentDmUser: null,
      });
      void validateSession(token);
    } else {
      set({
        token: null,
        user: null,
        theme,
        serverUrl,
        serverPort,
        darkMode: computeDark(theme),
        screen: 'connection',
        activePanel: 'home',
        currentDmUser: null,
      });
    }
  },
}));
