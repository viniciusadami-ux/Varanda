import { useEffect, useState } from 'react';
import { MessageCircle, UserPlus, Clock, Phone, Settings, Hash, Headphones, Check, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { useAppStore } from '@/store/appStore';
import { useFriendStore } from '@/store/friendStore';
import { useServerStore } from '@/store/serverStore';
import { friendsApi } from '@/lib/api';

function statusDot(status?: string): string {
  switch (status) {
    case 'online': return 'bg-emerald-500';
    case 'idle': case 'away': return 'bg-amber-500';
    case 'dnd': return 'bg-red-500';
    case 'invisible': return 'bg-zinc-500';
    default: return 'bg-zinc-500';
  }
}

function statusLabel(status?: string): string {
  switch (status) {
    case 'online': return 'Online';
    case 'idle': return 'Ausente';
    case 'dnd': return 'Não perturbe';
    case 'invisible': return 'Invisível';
    case 'offline': return 'Offline';
    default: return status ?? 'offline';
  }
}

export function HomePanel() {
  const user = useAppStore((s) => s.user);
  const setShowProfile = useAppStore((s) => s.setShowProfile);
  const setActivePanel = useAppStore((s) => s.setActivePanel);
  const setCurrentDmUser = useAppStore((s) => s.setCurrentDmUser);
  const inVoiceChannel = useAppStore((s) => s.inVoiceChannel);

  const friends = useFriendStore((s) => s.friends);
  const presence = useFriendStore((s) => s.presence);
  const servers = useServerStore((s) => s.servers);
  const setCurrentServer = useServerStore((s) => s.setCurrentServer);
  const setCurrentChannelId = useServerStore((s) => s.setCurrentChannelId);

  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const accepted = friends.filter((f) => f.status === 'accepted');
  const onlineFriends = accepted.filter((f) => {
    const eff = presence[f.friend_id] ?? f.friend_status ?? 'offline';
    return eff === 'online';
  });
  const pendingIncoming = friends.filter((f) => f.status === 'pending' && f.receiver_id === user?.id);
  const pendingOutgoing = friends.filter((f) => f.status === 'pending' && f.sender_id === user?.id);

  // Keep friend list fresh while on home (if not already refreshed elsewhere)
  useEffect(() => {
    if (!user) return;
    // Silent refresh handled elsewhere, but ensure home has data after reload
  }, [user]);

  const openDm = (friendId: number, username: string, displayName: string | null, avatar: string | null) => {
    setCurrentDmUser({ id: friendId, username, displayName, avatar });
    setActivePanel('friends');
    setCurrentServer(null);
    setCurrentChannelId(null);
  };

  const openServer = (serverId: number) => {
    const srv = servers.find((s) => s.id === serverId);
    if (!srv) return;
    setCurrentServer(srv);
    setActivePanel('chat');
    setCurrentDmUser(null);
    setCurrentChannelId(null);
  };

  const accept = async (id: number) => {
    try {
      await friendsApi.accept(id);
      // Refresh via store? FriendsSidebar will reload on next mount, but we can optimistically refresh
      const refreshed = await friendsApi.list();
      useFriendStore.getState().setFriends(refreshed);
      setActionFeedback('Pedido aceito');
      setTimeout(() => setActionFeedback(null), 2000);
    } catch {
      setActionFeedback('Falha ao aceitar');
    }
  };
  const decline = async (id: number) => {
    try {
      await friendsApi.decline(id);
      const refreshed = await friendsApi.list();
      useFriendStore.getState().setFriends(refreshed);
      setActionFeedback('Pedido recusado');
      setTimeout(() => setActionFeedback(null), 2000);
    } catch {
      setActionFeedback('Falha ao recusar');
    }
  };

  if (!user) return null;

  return (
    <div className="flex-1 overflow-y-auto bg-background p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Profile card */}
        <div className="rounded-xl border border-white/10 bg-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className="relative w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden flex-shrink-0">
              {user.avatar ? (
                <img src={user.avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xl font-bold">{(user.displayName || user.username)?.[0]?.toUpperCase()}</span>
              )}
              <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 ${statusDot(user.status)} rounded-full border-2 border-card`} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-tight truncate">{user.displayName || user.username}</h1>
              <p className="text-sm text-muted-foreground truncate">@{user.username} · {statusLabel(user.status)}</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowProfile(true)} className="gap-2">
              <Settings className="w-4 h-4" />
              Editar perfil
            </Button>
          </div>
        </div>

        {inVoiceChannel && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">Chamada em andamento — #{inVoiceChannel.name}</p>
                <p className="text-xs text-muted-foreground">Sua voz continua ativa ao navegar</p>
              </div>
            </div>
            <Button size="sm" onClick={() => setActivePanel('chat')}>
              <Phone className="w-4 h-4 mr-2" />
              Voltar à chamada
            </Button>
          </div>
        )}

        {actionFeedback && (
          <div className="text-sm px-3 py-2 rounded-md bg-white/5 border border-white/10 text-muted-foreground" role="status">
            {actionFeedback}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Online friends */}
          <div className="lg:col-span-2 rounded-xl border border-white/10 bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-500 rounded-full" />
                Amigos online — {onlineFriends.length}
              </h2>
              <button type="button" onClick={() => setActivePanel('friends')} className="text-xs text-primary hover:underline">Ver todos</button>
            </div>
            {onlineFriends.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center border border-dashed border-white/10 rounded-lg">
                <p>Nenhum amigo online agora.</p>
                <button type="button" onClick={() => setActivePanel('friends')} className="text-primary text-xs mt-2 hover:underline">Adicionar amigos</button>
              </div>
            ) : (
              <div className="space-y-1">
                {onlineFriends.slice(0, 5).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => openDm(f.friend_id, f.friend_username, f.friend_display_name, f.friend_avatar)}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/5 text-left transition-colors"
                  >
                    <div className="relative flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
                        {f.friend_avatar ? <img src={f.friend_avatar} alt="" className="w-full h-full object-cover" /> : <span className="text-xs font-bold">{f.friend_username[0]?.toUpperCase()}</span>}
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 ${statusDot(presence[f.friend_id] ?? f.friend_status)} rounded-full border-2 border-card`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{f.friend_display_name || f.friend_username}</p>
                      <p className="text-xs text-muted-foreground truncate">online · @{f.friend_username}</p>
                    </div>
                    <MessageCircle className="w-4 h-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Pending requests */}
          <div className="rounded-xl border border-white/10 bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-amber-400" />
                Pedidos pendentes
              </h2>
              <span className="text-xs bg-amber-500/10 text-amber-300 border border-amber-500/20 px-2 py-0.5 rounded-full">{pendingIncoming.length}</span>
            </div>
            {pendingIncoming.length === 0 && pendingOutgoing.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center border border-dashed border-white/10 rounded-lg">Sem pendências</p>
            ) : (
              <div className="space-y-3">
                {pendingIncoming.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recebidos</p>
                    {pendingIncoming.slice(0, 3).map((f) => (
                      <div key={f.id} className="flex items-center justify-between gap-2 bg-white/5 rounded-lg px-2 py-2">
                        <span className="text-sm truncate">@{f.friend_username}</span>
                        <span className="flex gap-1">
                          <button type="button" onClick={() => void accept(f.id)} className="p-1.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" title="Aceitar"><Check className="w-3.5 h-3.5" /></button>
                          <button type="button" onClick={() => void decline(f.id)} className="p-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20" title="Recusar"><X className="w-3.5 h-3.5" /></button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {pendingOutgoing.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Enviados</p>
                    {pendingOutgoing.slice(0, 3).map((f) => (
                      <div key={f.id} className="flex items-center justify-between bg-black/20 rounded px-2 py-1.5 text-sm">
                        <span className="truncate">@{f.friend_username}</span>
                        <span className="text-xs text-muted-foreground">pendente</span>
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => setActivePanel('friends')} className="w-full text-xs text-primary hover:underline pt-1">Gerenciar amizades</button>
              </div>
            )}
          </div>
        </div>

        {/* Recent servers + quick actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          <div className="lg:col-span-2 rounded-xl border border-white/10 bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                Servidores recentes
              </h2>
              <span className="text-xs text-muted-foreground">{servers.length} no total</span>
            </div>
            {servers.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-white/10 rounded-lg">
                <p>Você ainda não participa de servidores.</p>
                <p className="text-xs mt-1">Crie um servidor ou entre com um convite.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {servers.slice(0, 5).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => openServer(s.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 text-left transition-colors"
                  >
                    <div className="w-8 h-8 rounded-md bg-primary/20 flex items-center justify-center text-xs font-bold overflow-hidden flex-shrink-0">
                      {s.icon ? <img src={s.icon} alt="" className="w-full h-full object-cover" /> : s.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{s.name}</p>
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                        <Hash className="w-3 h-3" /> canais • <Headphones className="w-3 h-3" /> voz
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-card p-4 flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Atalhos</h2>
            <Button variant="ghost" className="justify-start w-full" onClick={() => setActivePanel('friends')}>
              <UserPlus className="w-4 h-4 mr-2" />
              Adicionar amigo
            </Button>
            <Button variant="ghost" className="justify-start w-full" onClick={() => useAppStore.getState().setShowCreateServer(true)}>
              <Hash className="w-4 h-4 mr-2" />
              Criar ou entrar em servidor
            </Button>
            <Button variant="ghost" className="justify-start w-full" onClick={() => setShowProfile(true)}>
              <Settings className="w-4 h-4 mr-2" />
              Configurações de perfil
            </Button>
            <p className="text-xs text-muted-foreground pt-2 border-t border-white/5">
              Dica: sua chamada permanece ativa ao navegar entre Início, Amigos e Servidores.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
