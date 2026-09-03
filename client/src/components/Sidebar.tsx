import { useEffect, useState } from 'react';
import {
  Plus,
  MessageCircle,
  Mic,
  MicOff,
  Headphones,
  LogOut,
  Search,
  UserPlus,
  Pencil,
  X,
  Copy,
  Check,
  Home,
} from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { channelsApi, friendsApi, serversApi } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useAppStore } from '@/store/appStore';
import { useServerStore } from '@/store/serverStore';
import { useFriendStore } from '@/store/friendStore';
import { useVoiceStore } from '@/store/voiceStore';
import type { Server as ServerT } from '@/types';

function getInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function statusDot(status?: string): string {
  switch (status) {
    case 'online':
      return 'bg-green-500';
    case 'idle':
    case 'away':
      return 'bg-yellow-500';
    case 'dnd':
      return 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
}

export function ServerRail() {
  const token = useAppStore((s) => s.token);
  const serverUrl = useAppStore((s) => s.serverUrl);
  const serverPort = useAppStore((s) => s.serverPort);
  const activePanel = useAppStore((s) => s.activePanel);
  const setActivePanel = useAppStore((s) => s.setActivePanel);
  const setShowCreateServer = useAppStore((s) => s.setShowCreateServer);
  const setChannels = useServerStore((s) => s.setChannels);
  const setCurrentServer = useServerStore((s) => s.setCurrentServer);
  const setCurrentChannelId = useServerStore((s) => s.setCurrentChannelId);
  const setCurrentDmUser = useAppStore((s) => s.setCurrentDmUser);
  const currentServer = useServerStore((s) => s.currentServer);
  const servers = useServerStore((s) => s.servers);
  const setServers = useServerStore((s) => s.setServers);
  const [hoveredId, setHoveredId] = useState<number | 'friends' | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    serversApi
      .list()
      .then((list) => {
        if (!cancelled) setServers(list);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [token, serverUrl, serverPort, setServers]);

  const selectServer = (s: ServerT) => {
    setCurrentServer(s);
    setActivePanel('chat');
    setChannels([]);
    setCurrentChannelId(null);
    setCurrentDmUser(null);
  };

  return (
    <div className="w-[72px] min-w-[72px] bg-secondary flex flex-col items-center py-3 gap-2 overflow-y-auto scrollbar-thin">
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setActivePanel('home');
            setCurrentServer(null);
            setChannels([]);
            setCurrentChannelId(null);
            setCurrentDmUser(null);
          }}
          className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200 ${
            activePanel === 'home'
              ? 'bg-primary text-white rounded-2xl'
              : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-primary/20 hover:rounded-xl'
          }`}
          aria-label="Início"
        >
          <Home className="w-5 h-5" />
        </button>
        {activePanel === 'home' && (
          <span className="absolute -left-[6px] top-1/2 -translate-y-1/2 w-1 h-10 bg-white rounded-r-full transition-all" />
        )}
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setActivePanel('friends');
            setCurrentServer(null);
            setChannels([]);
            setCurrentChannelId(null);
            setCurrentDmUser(null);
          }}
          className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200 ${
            activePanel === 'friends'
              ? 'bg-primary text-white rounded-2xl'
              : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-primary/20 hover:rounded-xl'
          }`}
          aria-label="Amigos"
        >
          <MessageCircle className="w-5 h-5" />
        </button>
        {activePanel === 'friends' && (
          <span className="absolute -left-[6px] top-1/2 -translate-y-1/2 w-1 h-10 bg-white rounded-r-full transition-all" />
        )}
      </div>

      <div className="w-8 h-[2px] bg-white/10 rounded-full my-1" />

      {servers.map((s) => (
        <div key={s.id} className="relative">
          <button
            type="button"
            onClick={() => selectServer(s)}
            onMouseEnter={() => setHoveredId(s.id)}
            onMouseLeave={() => setHoveredId(null)}
            className={`w-12 h-12 flex items-center justify-center font-bold text-sm rounded-2xl transition-all duration-200 ${
              currentServer?.id === s.id
                ? 'bg-primary text-white rounded-2xl'
                : 'bg-secondary text-foreground hover:bg-primary/20 hover:text-foreground hover:rounded-xl'
            }`}
            aria-label={s.name}
          >
            {s.icon ? (
              <img src={s.icon} alt="" className="w-full h-full rounded-2xl object-cover" />
            ) : (
              getInitials(s.name)
            )}
          </button>
          {(hoveredId === s.id || currentServer?.id === s.id) && (
            <span className="absolute -left-[6px] top-1/2 -translate-y-1/2 w-1 h-10 bg-white rounded-r-full transition-all" />
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={() => setShowCreateServer(true)}
        className="w-12 h-12 rounded-2xl bg-secondary text-green-500 hover:bg-green-500/20 hover:rounded-xl transition-all duration-200 flex items-center justify-center"
        aria-label="Adicionar servidor"
      >
        <Plus className="w-5 h-5" />
      </button>
    </div>
  );
}

export function UserBar() {
  const user = useAppStore((s) => s.user);
  const setShowProfile = useAppStore((s) => s.setShowProfile);
  const logout = useAppStore((s) => s.logout);
  const muted = useVoiceStore((s) => s.muted);
  const setMuted = useVoiceStore((s) => s.setMuted);

  if (!user) return null;

  return (
    <div className="h-14 px-2 flex items-center gap-2 bg-card border-t border-white/5 flex-shrink-0">
      <button
        type="button"
        onClick={() => setShowProfile(true)}
        className="flex items-center gap-2 flex-1 min-w-0 hover:bg-white/5 rounded-lg px-2 py-1 transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center relative flex-shrink-0">
          {user.avatar ? (
            <img src={user.avatar} alt="" className="w-full h-full rounded-full object-cover" />
          ) : (
            <span className="text-xs font-bold">
              {(user.displayName || user.username)?.[0]?.toUpperCase()}
            </span>
          )}
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 ${statusDot(user.status)} rounded-full border-2 border-card`}
          />
        </div>
        <div className="min-w-0 text-left">
          <p className="text-sm font-medium truncate">{user.displayName || user.username}</p>
          <p className="text-xs text-muted-foreground truncate">@{user.username}</p>
        </div>
      </button>
      <button
        type="button"
        onClick={() => setMuted(!muted)}
        aria-pressed={muted}
        title={muted ? 'Ativar microfone' : 'Silenciar microfone'}
        className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-white/5 transition-colors"
      >
        {muted ? <MicOff className="w-4 h-4 text-red-400" /> : <Mic className="w-4 h-4" />}
      </button>
      <button
        type="button"
        onClick={logout}
        title="Sair"
        className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-white/5 transition-colors"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ChannelSidebar() {
  const token = useAppStore((s) => s.token);
  const user = useAppStore((s) => s.user);
  const serverUrl = useAppStore((s) => s.serverUrl);
  const serverPort = useAppStore((s) => s.serverPort);
  const currentServer = useServerStore((s) => s.currentServer);
  const patchCurrentServer = useServerStore((s) => s.patchCurrentServer);
  const channels = useServerStore((s) => s.channels);
  const setChannels = useServerStore((s) => s.setChannels);
  const currentChannelId = useServerStore((s) => s.currentChannelId);
  const setCurrentChannelId = useServerStore((s) => s.setCurrentChannelId);
  const inVoiceChannel = useAppStore((s) => s.inVoiceChannel);
  const setInVoiceChannel = useAppStore((s) => s.setInVoiceChannel);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'text' | 'voice'>('text');
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !currentServer) return;
    serversApi
      .detail(currentServer.id)
      .then((detail) => {
        setChannels(detail.channels || []);
      })
      .catch(console.error);
  }, [token, currentServer?.id, serverUrl, serverPort, setChannels]);

  useEffect(() => {
    if (!token || !currentServer) return;
    const socket = getSocket();
    const refreshChannels = (payload: { serverId: number }) => {
      if (payload.serverId !== currentServer.id) return;
      serversApi.detail(currentServer.id).then((detail) => setChannels(detail.channels || [])).catch(console.error);
    };
    socket.on('server_channels_updated', refreshChannels);
    return () => {
      socket.off('server_channels_updated', refreshChannels);
    };
  }, [token, currentServer?.id, setChannels]);

  const textChannels = channels.filter((c) => c.type === 'text');
  const voiceChannels = channels.filter((c) => c.type === 'voice');
  const isOwner = !!user && !!currentServer && currentServer.owner_id === user.id;

  const createChannel = async () => {
    if (!newName.trim() || !currentServer) return;
    try {
      const created = await channelsApi.create({
        serverId: currentServer.id,
        name: newName.trim().toLowerCase().replace(/\s+/g, '-'),
        type: newType,
      });
      setChannels([...channels, created]);
      setNewName('');
      setCreating(false);
    } catch (e) {
      console.error('Failed to create channel:', e);
    }
  };

  const removeChannel = async (id: number) => {
    if (!window.confirm('Deseja realmente excluir este canal?')) return;
    try {
      await channelsApi.delete(id);
      setChannels(channels.filter((c) => c.id !== id));
      if (currentChannelId === id) setCurrentChannelId(null);
    } catch (e) {
      console.error('Failed to delete channel:', e);
    }
  };

  const startRename = (id: number, name: string) => {
    setRenameId(id);
    setRenameValue(name);
  };

  const commitRename = async () => {
    if (renameId == null) return;
    try {
      await channelsApi.rename(renameId, renameValue);
      setChannels(
        channels.map((c) => (c.id === renameId ? { ...c, name: renameValue } : c))
      );
    } catch (e) {
      console.error('Failed to rename channel:', e);
    } finally {
      setRenameId(null);
      setRenameValue('');
    }
  };

  const copyInviteCode = async () => {
    if (!currentServer) return;
    setInviteError(null);

    try {
      let code = currentServer.invite_code;

      // The server list can be stale (especially after joining an existing
      // server), so obtain the current invite instead of silently doing nothing.
      if (!code) {
        const detail = await serversApi.detail(currentServer.id);
        code = detail.invite_code;
      }

      // Servers created by older app versions can lack an invite. Only the
      // owner may create the first one; other members still receive a clear
      // message instead of an inert button.
      if (!code && isOwner) {
        const created = await serversApi.invite(currentServer.id);
        code = created.code;
      }

      if (!code) {
        setInviteError('Este servidor ainda não possui um código de convite. Peça ao dono para criar um.');
        return;
      }

      patchCurrentServer({ id: currentServer.id, invite_code: code });
      setInviteCode(code);

      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(code);
          copied = true;
        } catch {
          // Electron/file origins can deny the Clipboard API. The code remains
          // visible below and the legacy browser copy fallback is attempted.
        }
      }

      if (!copied) {
        const input = document.createElement('textarea');
        input.value = code;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        copied = document.execCommand('copy');
        input.remove();
      }

      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1800);
      if (!copied) setInviteError('Copie o código mostrado abaixo e envie para seu amigo.');
    } catch {
      setInviteError('Não foi possível gerar o convite agora. Tente novamente em instantes.');
    }
  };

  if (!currentServer) return null;

  return (
    <div className="w-60 min-w-[240px] flex flex-col bg-card border-r border-white/5 h-full overflow-x-hidden">
      <div className="h-14 px-4 flex items-center justify-between gap-2 border-b border-white/5 flex-shrink-0 shadow-md">
        <h2 className="font-bold text-foreground truncate">{currentServer.name}</h2>
        <button
          type="button"
          onClick={() => void copyInviteCode()}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          title="Copiar código de convite para enviar a outra conta"
          aria-label="Copiar código de convite"
        >
          {inviteCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {inviteCopied ? 'Copiado' : 'Convidar'}
        </button>
      </div>

      {(inviteCode || inviteError) && (
        <div className="mx-2 mt-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs" role="status">
          {inviteCode && (
            <>
              <p className="font-medium text-foreground">Código de convite</p>
              <p className="mt-1 select-all break-all font-mono text-primary">{inviteCode}</p>
              <p className="mt-1 text-muted-foreground">Envie este código para seu amigo entrar no servidor.</p>
            </>
          )}
          {inviteError && <p className={inviteCode ? 'mt-2 text-amber-500' : 'text-amber-500'}>{inviteError}</p>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-4">
        <div>
          <div className="flex items-center justify-between px-2 py-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <span>Canais de Texto</span>
            {isOwner && (
              <button
                type="button"
                onClick={() => {
                  setCreating(true);
                  setNewType('text');
                }}
                className="hover:text-foreground"
                aria-label="Criar canal de texto"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="space-y-0.5">
            {textChannels.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer ${
                  currentChannelId === c.id
                    ? 'bg-white/10 text-foreground'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                }`}
                onClick={() => {
                  if (renameId === c.id) return;
                  setCurrentChannelId(c.id);
                  setInVoiceChannel(null);
                }}
              >
                <span className="text-base leading-none opacity-70">#</span>
                {renameId === c.id ? (
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') {
                        setRenameId(null);
                        setRenameValue('');
                      }
                    }}
                    autoFocus
                    className="h-6 py-0 text-sm"
                  />
                ) : (
                  <span className="text-sm truncate flex-1">{c.name}</span>
                )}
                {isOwner && renameId !== c.id && (
                  <div className="hidden group-hover:flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(c.id, c.name);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Renomear"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeChannel(c.id);
                      }}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Excluir"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {creating && newType === 'text' && (
              <div className="flex items-center gap-1 px-2 py-1">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createChannel();
                    if (e.key === 'Escape') {
                      setCreating(false);
                      setNewName('');
                    }
                  }}
                  placeholder="Nome do canal"
                  autoFocus
                  className="h-7 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void createChannel()}
                  className="text-primary hover:text-primary/80"
                >
                  Criar
                </button>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between px-2 py-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <span>Canais de Voz</span>
            {isOwner && (
              <button
                type="button"
                onClick={() => {
                  setCreating(true);
                  setNewType('voice');
                }}
                className="hover:text-foreground"
                aria-label="Criar canal de voz"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="space-y-0.5">
            {voiceChannels.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer ${
                  inVoiceChannel?.id === c.id
                    ? 'bg-white/10 text-foreground'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                }`}
                onClick={() => {
                  if (renameId === c.id) return;
                  setCurrentChannelId(c.id);
                  setInVoiceChannel(c);
                }}
              >
                <Headphones className="w-4 h-4 opacity-70" />
                {renameId === c.id ? (
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') {
                        setRenameId(null);
                        setRenameValue('');
                      }
                    }}
                    autoFocus
                    className="h-6 py-0 text-sm"
                  />
                ) : (
                  <span className="text-sm truncate flex-1">{c.name}</span>
                )}
                {isOwner && renameId !== c.id && (
                  <div className="hidden group-hover:flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(c.id, c.name);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Renomear"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeChannel(c.id);
                      }}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Excluir"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {creating && newType === 'voice' && (
              <div className="flex items-center gap-1 px-2 py-1">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createChannel();
                    if (e.key === 'Escape') {
                      setCreating(false);
                      setNewName('');
                    }
                  }}
                  placeholder="Nome do canal"
                  autoFocus
                  className="h-7 text-sm"
                />
                <Button size="sm" onClick={() => void createChannel()}>
                  Criar
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <UserBar />
    </div>
  );
}

export function FriendsSidebar() {
  const token = useAppStore((s) => s.token);
  const user = useAppStore((s) => s.user);
  const setCurrentDmUser = useAppStore((s) => s.setCurrentDmUser);
  const setActivePanel = useAppStore((s) => s.setActivePanel);
  const setCurrentChannelId = useServerStore((s) => s.setCurrentChannelId);
  const setInVoiceChannel = useAppStore((s) => s.setInVoiceChannel);
  const setCurrentServer = useServerStore((s) => s.setCurrentServer);

  const friends = useFriendStore((s) => s.friends);
  const presence = useFriendStore((s) => s.presence);
  const setFriends = useFriendStore((s) => s.setFriends);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'online' | 'all' | 'pending' | 'add'>('online');
  const [addUsername, setAddUsername] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const accept = async (id: number) => {
    try {
      await friendsApi.accept(id);
      await reload();
    } catch (e) {
      console.error('Failed to accept:', e);
    }
  };

  const decline = async (id: number) => {
    try {
      await friendsApi.decline(id);
      await reload();
    } catch (e) {
      console.error('Failed to decline:', e);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm('Deseja remover este amigo?')) return;
    try {
      await friendsApi.remove(id);
      await reload();
    } catch (e) {
      console.error('Failed to remove friend:', e);
    }
  };

  const reload = async () => {
    if (!token) return;
    try {
      setFriends(await friendsApi.list());
    } catch (e) {
      console.error('Failed to load friends:', e);
    }
  };

  useEffect(() => {
    void reload();
  }, [token, setFriends]);

  useEffect(() => {
    if (!token) return;
    const socket = getSocket();
    const refreshFriends = () => void reload();
    socket.on('friends_updated', refreshFriends);
    return () => {
      socket.off('friends_updated', refreshFriends);
    };
  }, [token]);

  const openDm = (friendId: number, username: string, displayName: string | null, avatar: string | null) => {
    setCurrentServer(null);
    setCurrentChannelId(null);
    setInVoiceChannel(null);
    setCurrentDmUser({ id: friendId, username, displayName, avatar });
    setActivePanel('friends');
  };

  const sendRequest = async () => {
    if (!addUsername.trim()) return;
    setFeedback(null);
    try {
      await friendsApi.request(addUsername.trim());
      setFeedback({ type: 'success', text: `Pedido de amizade enviado para @${addUsername.trim()}!` });
      setAddUsername('');
      await reload();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.response?.data?.error ?? err?.message ?? 'Falha na conexão com o servidor.',
      });
    }
  };

  const accepted = friends.filter((f) => f.status === 'accepted');
  const incoming = friends.filter((f) => f.status === 'pending' && f.receiver_id === user?.id);
  const outgoing = friends.filter((f) => f.status === 'pending' && f.sender_id === user?.id);

  const filtered = accepted.filter((f) => {
    if (filter === 'online') return (presence[f.friend_id] ?? f.friend_status ?? 'offline') === 'online';
    if (filter === 'all') return true;
    return true;
  });

  const displayFriends = (filter === 'pending' ? incoming : filtered).filter((f) =>
    search.trim()
      ? f.friend_username.toLowerCase().includes(search.trim().toLowerCase()) ||
        (f.friend_display_name || '').toLowerCase().includes(search.trim().toLowerCase())
      : true
  );

  return (
    <div className="w-60 min-w-[240px] flex flex-col bg-card border-r border-white/5 h-full">
      <div className="h-14 px-4 flex items-center border-b border-white/5 flex-shrink-0">
        <h2 className="font-bold text-foreground">Amigos</h2>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar amigos..."
            className="pl-9"
          />
        </div>

        <div className="grid grid-cols-2 gap-1 text-xs">
          {(['online', 'all', 'pending', 'add'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`min-w-0 px-2 py-1 rounded-md capitalize whitespace-nowrap ${
                filter === k
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-white/5 text-muted-foreground hover:text-foreground'
              }`}
            >
              {k === 'add'
                ? 'Adicionar'
                : k === 'pending'
                ? `Pendentes${incoming.length ? ` (${incoming.length})` : ''}`
                : k === 'all'
                ? 'Todos'
                : 'Online'}
            </button>
          ))}
        </div>

        {filter === 'add' && (
          <div className="space-y-2 bg-white/5 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">
              Você pode adicionar amigos usando o nome de usuário deles no Discord 2.
            </p>
            <div className="flex gap-2">
              <Input
                value={addUsername}
                onChange={(e) => setAddUsername(e.target.value)}
                placeholder="Digite o nome de usuário"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void sendRequest();
                }}
              />
              <Button
                size="sm"
                onClick={() => void sendRequest()}
                disabled={!addUsername.trim()}
                aria-label="Enviar pedido de amizade"
              >
                <UserPlus className="w-4 h-4" />
              </Button>
            </div>
            {feedback && (
              <p
                role={feedback.type === 'error' ? 'alert' : 'status'}
                className={`text-xs ${feedback.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {feedback.text}
              </p>
            )}
            {outgoing.length > 0 && (
              <div className="space-y-1 mt-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase">
                  Pedidos enviados
                </p>
                {outgoing.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between text-sm bg-black/20 rounded px-2 py-1"
                  >
                    <span>@{f.friend_username}</span>
                    <span className="text-xs text-muted-foreground">pendente</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {filter === 'pending' && (
          <div className="space-y-1">
            {displayFriends.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2">Nenhum pedido pendente.</p>
            ) : (
              displayFriends.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between bg-white/5 rounded-lg px-2 py-1.5"
                >
                  <span className="text-sm">@{f.friend_username}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => void accept(f.id)}
                      className="text-emerald-400 hover:text-emerald-300 text-xs"
                    >
                      Aceitar
                    </button>
                    <button
                      type="button"
                      onClick={() => void decline(f.id)}
                      className="text-red-400 hover:text-red-300 text-xs"
                    >
                      Recusar
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {(filter === 'online' || filter === 'all') && (
          <div className="space-y-0.5">
            {displayFriends.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-3">
                {filter === 'online'
                  ? 'Nenhum amigo online. Convide alguém!'
                  : 'Nenhum amigo disponível no momento.'}
              </p>
            ) : (
              displayFriends.map((f) => {
                const status = (presence[f.friend_id] ?? f.friend_status ?? 'offline') as string;
                return (
                  <div
                    key={f.id}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openDm(f.friend_id, f.friend_username, f.friend_display_name, f.friend_avatar);
                      }
                    }}
                    className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={() =>
                      openDm(f.friend_id, f.friend_username, f.friend_display_name, f.friend_avatar)
                    }
                  >
                    <div className="relative flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
                        {f.friend_avatar ? (
                          <img src={f.friend_avatar} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs font-bold">
                            {f.friend_username[0]?.toUpperCase()}
                          </span>
                        )}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 ${statusDot(status)} rounded-full border-2 border-card`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {f.friend_display_name || f.friend_username}
                      </p>
                      <p className="text-xs text-muted-foreground truncate capitalize">{status}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void remove(f.id);
                      }}
                      className="text-muted-foreground hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                      aria-label="Remover amigo"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <UserBar />
    </div>
  );
}
