export type UserStatus = 'online' | 'offline' | 'idle' | 'dnd' | 'invisible';

export interface User {
  id: number;
  username: string;
  displayName: string;
  email?: string;
  avatar: string | null;
  status: UserStatus;
  createdAt?: string;
}

export interface Server {
  id: number;
  name: string;
  icon: string | null;
  owner_id: number;
  invite_code: string;
  created_at?: string;
}

export interface ServerMember {
  id: number;
  username: string;
  display_name: string | null;
  avatar: string | null;
  status: UserStatus;
  role: 'owner' | 'admin' | 'member';
}

export interface Category {
  id: number;
  server_id: number;
  name: string;
  position: number;
}

export type ChannelType = 'text' | 'voice';

export interface Channel {
  id: number;
  server_id: number;
  category_id: number | null;
  category_name?: string | null;
  name: string;
  type: ChannelType;
  position: number;
}

export interface Reaction {
  emoji: string;
  count: number;
  userIds: number[];
}

export interface Message {
  id: number;
  channel_id: number;
  user_id: number;
  username: string;
  display_name: string | null;
  avatar: string | null;
  content: string;
  reply_to?: number | null;
  reply_content?: string | null;
  reply_username?: string | null;
  reply_display_name?: string | null;
  file_url?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  reactions: Reaction[];
  created_at?: string;
  updated_at?: string;
}

export interface DirectMessage {
  id: number;
  sender_id: number;
  receiver_id: number;
  content: string;
  username?: string;
  display_name?: string | null;
  avatar?: string | null;
  created_at?: string;
}

export interface VoiceParticipant {
  userId: number;
  socketId?: string;
  username: string;
  displayName: string;
  avatar: string | null;
  muted: boolean;
  speaking?: boolean;
  deafened: boolean;
  screenSharing: boolean;
  screenStreamId?: string | null;
  cameraOn: boolean;
}

export interface Friend {
  id: number;
  sender_id: number;
  receiver_id: number;
  status: 'pending' | 'accepted' | 'declined' | 'blocked';
  friend_id: number;
  friend_username: string;
  friend_display_name: string | null;
  friend_avatar: string | null;
  friend_status?: UserStatus;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface JoinResponse {
  success: true;
  server: Server;
}
