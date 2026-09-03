import { Headphones, Mic, MicOff, PhoneOff, Radio } from 'lucide-react';
import { disconnectVoiceSession } from '@/lib/voiceSession';
import { useAppStore } from '@/store/appStore';
import { useServerStore } from '@/store/serverStore';
import { useVoiceStore } from '@/store/voiceStore';

export function VoiceMiniPanel() {
  const channel = useAppStore((s) => s.inVoiceChannel);
  const user = useAppStore((s) => s.user);
  const setActivePanel = useAppStore((s) => s.setActivePanel);
  const setCurrentDmUser = useAppStore((s) => s.setCurrentDmUser);
  const currentServer = useServerStore((s) => s.currentServer);
  const servers = useServerStore((s) => s.servers);
  const setCurrentServer = useServerStore((s) => s.setCurrentServer);
  const setCurrentChannelId = useServerStore((s) => s.setCurrentChannelId);
  const participants = useVoiceStore((s) => s.participants);
  const muted = useVoiceStore((s) => s.muted);
  const deafened = useVoiceStore((s) => s.deafened);
  const setMuted = useVoiceStore((s) => s.setMuted);
  const setDeafened = useVoiceStore((s) => s.setDeafened);
  if (!channel) return null;

  const count = participants.filter((p) => p.userId !== user?.id).length + (user ? 1 : 0);
  const returnToCall = () => {
    const server = servers.find((item) => item.id === channel.server_id);
    if (server && currentServer?.id !== server.id) setCurrentServer(server);
    setCurrentDmUser(null);
    setActivePanel('chat');
    setCurrentChannelId(channel.id);
  };

  return (
    <aside aria-label='Chamada em andamento' className='absolute bottom-3 right-3 z-30 flex items-center gap-2 rounded-xl border bg-card p-2 shadow-xl'>
      <button type='button' onClick={returnToCall} className='flex min-w-0 items-center gap-2 p-2'>
        <Radio className='h-4 w-4 text-emerald-400' />
        <span className='min-w-0'>
          <span className='block truncate text-sm font-semibold'>{channel.name}</span>
          <span className='block text-xs text-muted-foreground'>
            {count} participante{count === 1 ? '' : 's'}
          </span>
        </span>
      </button>
      <button
        type='button'
        onClick={() => setMuted(!muted)}
        className={muted ? 'rounded-full bg-red-500 p-2' : 'rounded-full bg-white/10 p-2'}
        aria-label={muted ? 'Desmutar microfone' : 'Mutar microfone'}
      >
        {muted ? <MicOff className='h-4 w-4' /> : <Mic className='h-4 w-4' />}
      </button>
      <button
        type='button'
        onClick={() => setDeafened(!deafened)}
        className={deafened ? 'rounded-full bg-red-500 p-2' : 'rounded-full bg-white/10 p-2'}
        aria-label={deafened ? 'Desativar surdina' : 'Ativar surdina'}
      >
        <Headphones className='h-4 w-4' />
      </button>
      <button
        type='button'
        onClick={disconnectVoiceSession}
        className='rounded-full bg-red-500 p-2 hover:bg-red-600'
        aria-label='Desconectar da chamada'
      >
        <PhoneOff className='h-4 w-4' />
      </button>
    </aside>
  );
}
