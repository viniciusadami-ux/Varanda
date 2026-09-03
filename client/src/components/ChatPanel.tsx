import { useEffect, useRef, useState, Component, ReactNode } from 'react';
import { Hash, Send, Paperclip, Smile, Reply, Edit3, Trash2, X } from 'lucide-react';
import { Button, TextArea } from '@/components/ui';
import { useAppStore } from '@/store/appStore';
import { useServerStore } from '@/store/serverStore';
import { useMessageStore } from '@/store/messageStore';
import { useFriendStore } from '@/store/friendStore';
import { channelsApi, friendsApi, uploadsApi } from '@/lib/api';
import { getSocket, socketEmit } from '@/lib/socket';
import type { DirectMessage, Message } from '@/types';

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👏'];
const HISTORY_PAGE_SIZE = 50;

function formatTime(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Error boundary per message to avoid one broken message crashing the whole panel
class MessageRowBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: unknown) { console.error('[ChatPanel] message render error', error); }
  render() {
    if (this.state.hasError) {
      return <div className="text-xs text-amber-400 px-2 py-1 border border-amber-400/20 rounded">Esta mensagem não pôde ser exibida.</div>;
    }
    return this.props.children;
  }
}

function ChannelMessageRow({
  message,
  userId,
  isEditing,
  editingContent,
  onStartEdit,
  onCancelEdit,
  onCommitEdit,
  onChangeEdit,
  onReply,
  onToggleReaction,
  onDelete,
  serverUrl,
  serverPort,
}: {
  message: Message;
  userId?: number;
  isEditing: boolean;
  editingContent: string;
  onStartEdit: (m: Message) => void;
  onCancelEdit: () => void;
  onCommitEdit: () => void;
  onChangeEdit: (v: string) => void;
  onReply: (m: Message) => void;
  onToggleReaction: (m: Message, emoji: string) => void;
  onDelete: (m: Message) => void;
  serverUrl: string;
  serverPort: string;
}) {
  const mine = message.user_id === userId;
  const reactions = Array.isArray(message.reactions) ? message.reactions : [];
  return (
    <div className="group flex gap-3 hover:bg-white/[0.02] rounded-lg p-2 -mx-2 animate-fade-in">
      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {message.avatar ? (
          <img src={message.avatar} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-sm font-bold">{message.username?.[0]?.toUpperCase()}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-semibold text-sm">{message.display_name || message.username}</span>
          <span className="text-xs text-muted-foreground">{formatTime(message.created_at)}</span>
        </div>
        {message.reply_to != null && (
          <div className="text-xs text-muted-foreground mb-1 pl-2 border-l-2 border-white/10">
            respondendo a <strong>@{message.reply_username || 'mensagem'}</strong>:{' '}
            {message.reply_content?.slice(0, 80)}
          </div>
        )}
        {isEditing ? (
          <div className="space-y-1">
            <TextArea
              value={editingContent}
              onChange={(e) => onChangeEdit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onCommitEdit(); }
                if (e.key === 'Escape') { onCancelEdit(); }
              }}
              autoFocus
            />
            <div className="flex gap-2 text-xs">
              <button type="button" onClick={onCommitEdit} className="text-emerald-400 hover:text-emerald-300">Salvar</button>
              <button type="button" onClick={onCancelEdit} className="text-muted-foreground hover:text-foreground">Cancelar</button>
            </div>
          </div>
        ) : (
          <>
            {message.file_url ? (
              message.file_type?.startsWith('image/') ? (
                <img src={`http://${serverUrl}:${serverPort}${message.file_url}`} alt={message.file_name ?? 'imagem'} className="max-w-md rounded-lg mt-1" />
              ) : (
                <a href={`http://${serverUrl}:${serverPort}${message.file_url}`} target="_blank" rel="noreferrer" className="text-primary underline">{message.file_name ?? message.file_url}</a>
              )
            ) : (
              <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
            )}
            {reactions.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {reactions.map((r) => (
                  <button
                    key={r.emoji}
                    type="button"
                    onClick={() => onToggleReaction(message, r.emoji)}
                    className={`text-xs rounded-full px-2 py-0.5 border ${r.userIds.includes(userId ?? -1) ? 'bg-primary/20 border-primary text-primary' : 'bg-white/5 border-white/10 text-foreground hover:bg-white/10'}`}
                  >
                    {r.emoji} {r.count}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {!isEditing && (
          <div className="flex items-center gap-1 mt-1 text-xs sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <button type="button" onClick={() => onReply(message)} className="text-muted-foreground hover:text-foreground" title="Responder" aria-label="Responder">
              <Reply className="w-3.5 h-3.5" />
            </button>
            {mine && (
              <>
                <button type="button" onClick={() => onStartEdit(message)} className="text-muted-foreground hover:text-foreground" title="Editar" aria-label="Editar mensagem">
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => onDelete(message)} className="text-muted-foreground hover:text-destructive" title="Excluir" aria-label="Excluir mensagem">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DirectMessageRow({ dm, userId }: { dm: DirectMessage; userId?: number }) {
  const mine = dm.sender_id === userId;
  return (
    <div className="group flex gap-3 hover:bg-white/[0.02] rounded-lg p-2 -mx-2 animate-fade-in">
      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {dm.avatar ? (
          <img src={dm.avatar} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-sm font-bold">{dm.username?.[0]?.toUpperCase() ?? '?'}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-semibold text-sm">{dm.display_name || dm.username}{mine ? ' (você)' : ''}</span>
          <span className="text-xs text-muted-foreground">{formatTime(dm.created_at)}</span>
        </div>
        <p className="text-sm whitespace-pre-wrap break-words">{dm.content}</p>
      </div>
    </div>
  );
}

export function ChatPanel() {
  const token = useAppStore((s) => s.token);
  const user = useAppStore((s) => s.user);
  const serverUrl = useAppStore((s) => s.serverUrl);
  const serverPort = useAppStore((s) => s.serverPort);
  const dmUser = useAppStore((s) => s.currentDmUser);

  const channelId = useServerStore((s) => s.currentChannelId);
  const channels = useServerStore((s) => s.channels);

  const setMessages = useMessageStore((s) => s.setMessages);
  const messages = useMessageStore((s) =>
    channelId != null ? (s.byChannel[channelId] ?? []) : []
  );
  const typing = useMessageStore((s) =>
    channelId != null ? (s.typing[channelId] ?? []) : []
  );

  const setDms = useFriendStore((s) => s.setDms);
  const dmMessages = useFriendStore((s) =>
    dmUser ? (s.dmByFriend[dmUser.id] ?? []) : []
  );

  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [dmFeedback, setDmFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const preserveScrollRef = useRef(false);

  const currentChannel = channels.find((c) => c.id === channelId);

  // Load history.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setHasOlderMessages(false);
    setDmFeedback(null);
    if (dmUser) {
      friendsApi
        .dms(dmUser.id, { limit: HISTORY_PAGE_SIZE })
        .then((list) => {
          if (cancelled) return;
          // Normalize: ensure list is array, defensive
          const safe = Array.isArray(list) ? list : [];
          setDms(dmUser.id, safe);
          setHasOlderMessages(safe.length === HISTORY_PAGE_SIZE);
        })
        .catch((e) => {
          console.error(e);
          if (!cancelled) setDms(dmUser.id, []);
        });
    } else if (channelId && currentChannel?.type === 'text') {
      channelsApi
        .listMessages(channelId, { limit: HISTORY_PAGE_SIZE })
        .then((list) => {
          if (cancelled) return;
          const safe = Array.isArray(list) ? list : [];
          setMessages(channelId, safe);
          setHasOlderMessages(safe.length === HISTORY_PAGE_SIZE);
        })
        .catch(console.error);
    }
    return () => {
      cancelled = true;
    };
  }, [token, channelId, dmUser?.id, currentChannel?.type, serverUrl, serverPort, setMessages, setDms]);

  // Auto-scroll on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && !preserveScrollRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, dmMessages.length, dmUser?.id]);

  useEffect(() => {
    if (!dmFeedback) return;
    const t = window.setTimeout(() => setDmFeedback(null), 4000);
    return () => window.clearTimeout(t);
  }, [dmFeedback]);

  const loadOlderMessages = async () => {
    const currentList = dmUser ? dmMessages : messages;
    const before = currentList[0]?.id;
    if (!before || loadingOlderMessages || !hasOlderMessages) return;

    const el = scrollRef.current;
    const previousHeight = el?.scrollHeight ?? 0;
    const previousTop = el?.scrollTop ?? 0;
    preserveScrollRef.current = true;
    setLoadingOlderMessages(true);

    try {
      if (dmUser) {
        const older = await friendsApi.dms(dmUser.id, { before, limit: HISTORY_PAGE_SIZE });
        const knownIds = new Set(dmMessages.map((message) => message.id));
        setDms(dmUser.id, [...older.filter((message) => !knownIds.has(message.id)), ...dmMessages]);
        setHasOlderMessages(older.length === HISTORY_PAGE_SIZE);
      } else if (channelId) {
        const older = await channelsApi.listMessages(channelId, { before, limit: HISTORY_PAGE_SIZE });
        const knownIds = new Set(messages.map((message) => message.id));
        setMessages(channelId, [...older.filter((message) => !knownIds.has(message.id)), ...messages]);
        setHasOlderMessages(older.length === HISTORY_PAGE_SIZE);
      }
      requestAnimationFrame(() => {
        const currentEl = scrollRef.current;
        if (currentEl) currentEl.scrollTop = currentEl.scrollHeight - previousHeight + previousTop;
        preserveScrollRef.current = false;
      });
    } catch (error) {
      console.error('Failed to load older messages:', error);
      preserveScrollRef.current = false;
    } finally {
      setLoadingOlderMessages(false);
    }
  };

  const send = () => {
    const content = input.trim();
    if (!content || !user) return;
    setDmFeedback(null);
    if (dmUser) {
      // Use ack callback if server supports it
      const socket = getSocket();
      setInput('');
      // Emit with ack handling
      try {
        // socketEmit.sendDm now expects ack via socket's ack
        socket.emit(
          'send_dm',
          { receiverId: dmUser.id, content },
          (ack: { success?: boolean; error?: string; message?: DirectMessage }) => {
          if (ack?.error) {
            setDmFeedback({ type: 'error', text: ack.error });
            setInput(content); // restore
          } else if (ack?.success) {
            setDmFeedback({ type: 'success', text: 'Mensagem enviada' });
            window.setTimeout(() => setDmFeedback(null), 1500);
          }
          }
        );
        // Fallback: also listen for dm_error events for older server
        const onError = (payload: { error: string }) => {
          if (payload?.error) setDmFeedback({ type: 'error', text: payload.error });
        };
        socket.once('dm_error', onError);
        window.setTimeout(() => socket.off('dm_error', onError), 3000);
      } catch (e) {
        console.error('send_dm failed', e);
        setDmFeedback({ type: 'error', text: 'Falha ao enviar DM.' });
      }
    } else if (channelId) {
      setInput('');
      socketEmit.sendMessage({
        channelId,
        content,
        userId: user.id,
        replyTo: replyTo?.id ?? null,
      });
      setReplyTo(null);
    }
  };

  const startTyping = () => {
    if (!user || (!channelId && !dmUser)) return;
    if (typingTimeoutRef.current) return;
    if (dmUser) return;
    socketEmit.typing(channelId!, user.id, user.displayName || user.username);
    typingTimeoutRef.current = window.setTimeout(() => {
      typingTimeoutRef.current = null;
    }, 3000);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !channelId || !user) return;
    setUploading(true);
    try {
      const res = await uploadsApi.upload(file);
      socketEmit.sendMessage({
        channelId,
        content: '',
        userId: user.id,
        fileUrl: res.url,
        fileName: res.name,
        fileType: res.type,
      });
    } catch (e) {
      console.error('Upload failed:', e);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startEdit = (m: Message) => {
    setEditingId(m.id);
    setEditingContent(m.content);
  };

  const commitEdit = () => {
    if (!editingId || !user) return;
    socketEmit.editMessage(editingId, editingContent, user.id);
    setEditingId(null);
    setEditingContent('');
  };

  const onToggleReaction = (m: Message, emoji: string) => {
    if (!user) return;
    socketEmit.toggleReaction(m.id, user.id, emoji);
  };

  const isDmMode = !!dmUser;
  const visibleCount = isDmMode ? dmMessages.length : messages.length;
  const hasActiveConversation = isDmMode || !!currentChannel;

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background h-full">
      <div className="h-14 px-6 flex items-center border-b border-white/5 flex-shrink-0 bg-card/80 backdrop-blur-md">
        {dmUser ? (
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
              {dmUser.avatar ? (
                <img src={dmUser.avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-sm font-bold">
                  {(dmUser.displayName || dmUser.username)?.[0]?.toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <h2 className="font-bold truncate">{dmUser.displayName || dmUser.username}</h2>
              <p className="text-xs text-muted-foreground truncate">
                Mensagem direta com @{dmUser.username}
              </p>
            </div>
          </div>
        ) : currentChannel ? (
          <div className="flex items-center gap-2 min-w-0">
            <Hash className="w-5 h-5 text-muted-foreground" />
            <h2 className="font-bold truncate">{currentChannel.name}</h2>
          </div>
        ) : (
          <h2 className="font-bold text-muted-foreground">
            Selecione um servidor ou converse com amigos
          </h2>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
        {hasOlderMessages && hasActiveConversation && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={() => void loadOlderMessages()}
              disabled={loadingOlderMessages}
              className="text-xs text-primary hover:text-primary/80 disabled:opacity-50"
            >
              {loadingOlderMessages ? 'Carregando mensagens…' : 'Carregar mensagens anteriores'}
            </button>
          </div>
        )}
        {visibleCount === 0 && hasActiveConversation && (
          <p className="text-sm text-muted-foreground text-center py-8">
            {isDmMode ? 'Nenhuma mensagem ainda. Diga olá!' : 'Sem mensagens ainda. Comece a conversa!'}
          </p>
        )}
        {isDmMode
          ? dmMessages.map((dm) => (
              <MessageRowBoundary key={dm.id}>
                <DirectMessageRow dm={dm} userId={user?.id} />
              </MessageRowBoundary>
            ))
          : messages.map((m) => {
              const isEditing = editingId === m.id;
              return (
                <MessageRowBoundary key={m.id}>
                  <ChannelMessageRow
                    message={m}
                    userId={user?.id}
                    isEditing={isEditing}
                    editingContent={editingContent}
                    onStartEdit={startEdit}
                    onCancelEdit={() => { setEditingId(null); setEditingContent(''); }}
                    onCommitEdit={commitEdit}
                    onChangeEdit={setEditingContent}
                    onReply={setReplyTo}
                    onToggleReaction={onToggleReaction}
                    onDelete={(msg) => socketEmit.deleteMessage(msg.id, user!.id)}
                    serverUrl={serverUrl}
                    serverPort={serverPort}
                  />
                </MessageRowBoundary>
              );
            })}
        {typing.length > 0 && !isDmMode && (
          <div className="text-xs text-muted-foreground italic px-2 animate-fade-in">
            {typing.length === 1
              ? `${typing[0].username} está digitando...`
              : `${typing.slice(0, 3).map((entry) => entry.username).join(', ')} estão digitando...`}
          </div>
        )}
      </div>

      {hasActiveConversation && (
        <div className="px-4 pb-4">
          {replyTo && !isDmMode && (
            <div className="flex items-center justify-between mb-2 px-3 py-2 bg-white/5 rounded-lg border-l-2 border-primary">
              <div className="text-xs text-muted-foreground min-w-0">
                Respondendo a <strong>@{replyTo.username}</strong>:{' '}
                <span className="truncate">{replyTo.content.slice(0, 80)}</span>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {dmFeedback && (
            <div className={`mb-2 text-xs px-3 py-1.5 rounded ${dmFeedback.type === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`} role="status">
              {dmFeedback.text}
            </div>
          )}
          <div className="relative flex items-end gap-2 bg-white/5 rounded-lg p-2">
            {!isDmMode && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFile}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-50 p-2"
                  title="Enviar arquivo ou foto"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
              </>
            )}
            <div className="relative flex-1">
              <TextArea
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  startTyping();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={
                  dmUser
                    ? `Mensagem para @${dmUser.username}`
                    : `Mensagem em #${currentChannel?.name ?? ''}`
                }
                className="min-h-[40px] max-h-32"
                rows={1}
              />
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setEmojiOpen(!emojiOpen)}
                  className="absolute right-2 bottom-2 text-muted-foreground hover:text-foreground"
                  aria-label="Emojis"
                >
                  <Smile className="w-4 h-4" />
                </button>
                {emojiOpen && (
                  <div className="absolute bottom-8 right-0 bg-card border border-border rounded-lg p-2 grid grid-cols-8 gap-1 shadow-lg z-10">
                    {EMOJIS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => {
                          setInput(input + e);
                          setEmojiOpen(false);
                        }}
                        className="text-lg hover:bg-white/10 rounded p-1"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <Button
              size="icon"
              onClick={send}
              disabled={!input.trim() || uploading}
              className="flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
