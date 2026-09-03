import { useEffect, useRef, useState } from 'react';
import { Hash, Send, Paperclip, Smile, Reply, Edit3, Trash2, X } from 'lucide-react';
import { Button, TextArea } from '@/components/ui';
import { useAppStore } from '@/store/appStore';
import { useServerStore } from '@/store/serverStore';
import { useMessageStore } from '@/store/messageStore';
import { useFriendStore } from '@/store/friendStore';
import { useSocketBridge } from '@/hooks/useSocketBridge';
import { channelsApi, friendsApi, uploadsApi } from '@/lib/api';
import { socketEmit } from '@/lib/socket';
import type { Message } from '@/types';

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👏'];
const HISTORY_PAGE_SIZE = 50;

function formatTime(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const preserveScrollRef = useRef(false);

  useSocketBridge();

  const currentChannel = channels.find((c) => c.id === channelId);

  // Load history.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setHasOlderMessages(false);
    if (dmUser) {
      friendsApi
        .dms(dmUser.id, { limit: HISTORY_PAGE_SIZE })
        .then((list) => {
          if (cancelled) return;
          setDms(dmUser.id, list);
          setHasOlderMessages(list.length === HISTORY_PAGE_SIZE);
        })
        .catch(console.error);
    } else if (channelId && currentChannel?.type === 'text') {
      channelsApi
        .listMessages(channelId, { limit: HISTORY_PAGE_SIZE })
        .then((list) => {
          if (cancelled) return;
          setMessages(channelId, list);
          setHasOlderMessages(list.length === HISTORY_PAGE_SIZE);
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
    setInput('');
    if (dmUser) {
      socketEmit.sendDm(user.id, dmUser.id, content);
    } else if (channelId) {
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

  const visibleMessages = dmUser ? dmMessages : messages;

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
        {hasOlderMessages && (currentChannel || dmUser) && (
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
        {visibleMessages.length === 0 && currentChannel && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Sem mensagens ainda. Comece a conversa!
          </p>
        )}
        {visibleMessages.map((m) => {
          const mMessage = m as unknown as Message;
          const mine = mMessage.user_id === user?.id;
          const isEditing = editingId === mMessage.id;
          return (
            <div
              key={m.id}
              className="group flex gap-3 hover:bg-white/[0.02] rounded-lg p-2 -mx-2 animate-fade-in"
            >
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
                {m.avatar ? (
                  <img src={m.avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-sm font-bold">{m.username?.[0]?.toUpperCase()}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-semibold text-sm">{m.display_name || m.username}</span>
                  <span className="text-xs text-muted-foreground">{formatTime(m.created_at)}</span>
                </div>
                {mMessage.reply_to && (
                  <div className="text-xs text-muted-foreground mb-1 pl-2 border-l-2 border-white/10">
                    respondendo a <strong>@{mMessage.reply_username || 'mensagem'}</strong>:{' '}
                    {mMessage.reply_content?.slice(0, 80)}
                  </div>
                )}
                {isEditing ? (
                  <div className="space-y-1">
                    <TextArea
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          commitEdit();
                        }
                        if (e.key === 'Escape') {
                          setEditingId(null);
                          setEditingContent('');
                        }
                      }}
                      autoFocus
                    />
                    <div className="flex gap-2 text-xs">
                      <button
                        type="button"
                        onClick={commitEdit}
                        className="text-emerald-400 hover:text-emerald-300"
                      >
                        Salvar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          setEditingContent('');
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {mMessage.file_url ? (
                      mMessage.file_type?.startsWith('image/') ? (
                        <img
                          src={`http://${serverUrl}:${serverPort}${mMessage.file_url}`}
                          alt={mMessage.file_name ?? 'imagem'}
                          className="max-w-md rounded-lg mt-1"
                        />
                      ) : (
                        <a
                          href={`http://${serverUrl}:${serverPort}${mMessage.file_url}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline"
                        >
                          {mMessage.file_name ?? mMessage.file_url}
                        </a>
                      )
                    ) : (
                      <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
                    )}
                    {mMessage.reactions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {mMessage.reactions.map((r) => (
                          <button
                            key={r.emoji}
                            type="button"
                            onClick={() => onToggleReaction(mMessage, r.emoji)}
                            className={`text-xs rounded-full px-2 py-0.5 border ${
                              r.userIds.includes(user?.id ?? -1)
                                ? 'bg-primary/20 border-primary text-primary'
                                : 'bg-white/5 border-white/10 text-foreground hover:bg-white/10'
                            }`}
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
                    <button
                      type="button"
                      onClick={() => setReplyTo(mMessage)}
                      className="text-muted-foreground hover:text-foreground"
                      title="Responder"
                      aria-label="Responder"
                    >
                      <Reply className="w-3.5 h-3.5" />
                    </button>
                    {mine && (
                      <>
                        <button
                          type="button"
                          onClick={() => startEdit(mMessage)}
                          className="text-muted-foreground hover:text-foreground"
                          title="Editar"
                          aria-label="Editar mensagem"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => socketEmit.deleteMessage(mMessage.id, user!.id)}
                          className="text-muted-foreground hover:text-destructive"
                          title="Excluir"
                          aria-label="Excluir mensagem"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {typing.length > 0 && (
          <div className="text-xs text-muted-foreground italic px-2 animate-fade-in">
            {typing.length === 1
              ? `${typing[0].username} está digitando...`
              : `${typing.slice(0, 3).map((entry) => entry.username).join(', ')} estão digitando...`}
          </div>
        )}
      </div>

      {(currentChannel || dmUser) && (
        <div className="px-4 pb-4">
          {replyTo && (
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
          <div className="relative flex items-end gap-2 bg-white/5 rounded-lg p-2">
            {!dmUser && (
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
