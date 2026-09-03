import { useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  Check,
  Copy,
  Headphones,
  Mic,
  MicOff,
  Monitor,
  PhoneOff,
  Settings,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { CallStage } from '@/components/CallStage';
import { ScreenSharePicker } from '@/components/ScreenSharePicker';
import { useAppStore } from '@/store/appStore';
import { useVoiceStore } from '@/store/voiceStore';
import {
  disconnectVoiceSession,
  startScreenShare,
  stopScreenShare,
  toggleCamera,
} from '@/lib/voiceSession';

interface VoicePanelProps {
  onOpenSettings: () => void;
}

export function VoicePanel({ onOpenSettings }: VoicePanelProps) {
  const user = useAppStore((state) => state.user);
  const channel = useAppStore((state) => state.inVoiceChannel);
  const {
    muted,
    deafened,
    cameraOn,
    screenSharing,
    cameraStream,
    screenStream,
    remoteStreams,
    remoteScreenStreams,
    participants: storeParticipants,
    isSpeaking,
    micError,
    screenShareError,
    screenSharePending,
    setMuted,
    setDeafened,
    setScreenShareError,
  } = useVoiceStore();

  const [copied, setCopied] = useState(false);
  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  const [focusedScreenUserId, setFocusedScreenUserId] = useState<number | null>(null);
  const shareTriggerRef = useRef<HTMLButtonElement>(null);

  const participants = useMemo(() => {
    const selfParticipant = user
      ? [{
          userId: user.id,
          username: user.username,
          displayName: user.displayName || user.username,
          avatar: user.avatar,
          muted,
          speaking: isSpeaking && !muted,
          deafened,
          screenSharing,
          cameraOn,
        }]
      : [];
    return [
      ...selfParticipant,
      ...storeParticipants.filter((participant) => participant.userId !== user?.id),
    ];
  }, [user, storeParticipants, muted, isSpeaking, deafened, screenSharing, cameraOn]);

  const activeScreenShares = useMemo(
    () =>
      participants.flatMap((participant) => {
        if (!participant.screenSharing) return [];
        const stream =
          participant.userId === user?.id
            ? screenStream
            : remoteScreenStreams[participant.userId];
        return [{
          participant,
          stream: stream ?? null,
          isLocal: participant.userId === user?.id,
        }];
      }),
    [participants, user?.id, screenStream, remoteScreenStreams]
  );

  if (!channel) return null;

  const toggleScreenShare = async () => {
    if (!user || screenSharePending) return;
    if (screenSharing) {
      await stopScreenShare();
    } else if (window.electronAPI) {
      setScreenShareError(null);
      setSharePickerOpen(true);
    } else {
      await startScreenShare();
    }
  };

  const closeSharePicker = () => {
    setSharePickerOpen(false);
    requestAnimationFrame(() => shareTriggerRef.current?.focus());
  };

  return (
    <div className='relative flex h-full min-w-0 flex-1 flex-col bg-background'>
      <div className='hidden' aria-hidden>
        {Object.entries(remoteStreams).map(([userId, stream]) => (
          <audio
            key={'voice-' + userId}
            autoPlay
            playsInline
            muted={deafened}
            ref={(element) => {
              if (!element) return;
              if (element.srcObject !== stream) element.srcObject = stream;
              element.muted = deafened;
              element.volume = deafened ? 0 : 1;
              void element.play().catch(() => {
                console.warn('[VoicePanel] audio play blocked for user', userId);
              });
            }}
          />
        ))}
      </div>

      <header className='flex min-h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-white/5 bg-card/80 px-3 py-2 backdrop-blur-md sm:px-6'>
        <div className='flex min-w-0 items-center gap-3'>
          <span className='h-3 w-3 flex-none animate-pulse rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/50' />
          <h2 className='truncate text-base font-bold tracking-wide text-foreground'>
            {channel.name || 'Canal de voz'}
          </h2>
          <span className='hidden items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400 sm:flex'>
            <Volume2 className='h-3 w-3' />
            Voz conectada
          </span>
        </div>
        <Button variant='destructive' size='sm' onClick={disconnectVoiceSession}>
          <PhoneOff className='mr-2 h-4 w-4' />
          Desconectar
        </Button>
      </header>

      <CallStage
        participants={participants}
        activeScreenShares={activeScreenShares}
        focusedScreenUserId={focusedScreenUserId}
        onChangeFocus={setFocusedScreenUserId}
        localUserId={user?.id}
        getCameraStream={(userId) =>
          userId === user?.id ? cameraStream : remoteStreams[userId] ?? null
        }
        getIsCameraOn={(userId) =>
          userId === user?.id
            ? cameraOn
            : participants.find((participant) => participant.userId === userId)?.cameraOn ?? false
        }
      />

      <div className='flex min-h-16 flex-wrap items-center justify-center gap-2 border-t border-white/5 bg-black/30 px-3 py-2 backdrop-blur-md sm:px-6'>
        <button
          type='button'
          onClick={() => setMuted(!muted)}
          className={clsx('rounded-full p-3 transition-colors', muted ? 'bg-red-500' : 'bg-white/10 hover:bg-white/20')}
          title={muted ? 'Desmutar microfone' : 'Mutar microfone'}
          aria-pressed={muted}
        >
          {muted ? <MicOff className='h-5 w-5 text-white' /> : <Mic className='h-5 w-5 text-white' />}
        </button>
        <button
          type='button'
          onClick={() => setDeafened(!deafened)}
          className={clsx('rounded-full p-3 transition-colors', deafened ? 'bg-red-500' : 'bg-white/10 hover:bg-white/20')}
          title={deafened ? 'Desativar surdina' : 'Ativar surdina'}
          aria-pressed={deafened}
        >
          <Headphones className='h-5 w-5 text-white' />
        </button>
        <button
          ref={shareTriggerRef}
          type='button'
          onClick={() => void toggleScreenShare()}
          disabled={screenSharePending}
          aria-pressed={screenSharing}
          aria-label={screenSharing ? 'Parar compartilhamento de tela' : 'Compartilhar tela'}
          className={clsx(
            'rounded-full p-3 transition-colors disabled:cursor-wait disabled:opacity-60',
            screenSharing ? 'bg-blue-500' : 'bg-white/10 hover:bg-white/20'
          )}
          title={screenSharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
        >
          <Monitor className='h-5 w-5 text-white' />
        </button>
        <button
          type='button'
          onClick={() => void toggleCamera()}
          className={clsx('rounded-full p-3 transition-colors', cameraOn ? 'bg-emerald-500' : 'bg-white/10 hover:bg-white/20')}
          title={cameraOn ? 'Desligar câmera' : 'Ligar câmera'}
          aria-pressed={cameraOn}
        >
          {cameraOn ? <Video className='h-5 w-5 text-white' /> : <VideoOff className='h-5 w-5 text-white' />}
        </button>
        <button
          type='button'
          onClick={() => {
            if (!micError) return;
            void navigator.clipboard.writeText(micError).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
          className='rounded-full bg-white/10 p-3 transition-colors hover:bg-white/20'
          title={micError ? 'Copiar erro de microfone' : 'Sem erro de microfone'}
          aria-label='Copiar erro de microfone'
        >
          {copied ? <Check className='h-5 w-5 text-white' /> : <Copy className='h-5 w-5 text-white' />}
        </button>
        <button
          type='button'
          onClick={onOpenSettings}
          className='rounded-full bg-white/10 p-3 transition-colors hover:bg-white/20'
          title='Configurações de voz'
          aria-label='Abrir configurações de voz'
        >
          <Settings className='h-5 w-5 text-white' />
        </button>
        {micError && <span className='ml-3 max-w-xs truncate text-xs text-red-300'>{micError}</span>}
        {screenShareError && (
          <span className='max-w-xs truncate text-xs text-amber-200' role='alert'>
            {screenShareError}
          </span>
        )}
      </div>

      <ScreenSharePicker
        open={sharePickerOpen}
        pending={screenSharePending}
        shareError={screenShareError}
        onClose={closeSharePicker}
        onStarted={closeSharePicker}
      />
    </div>
  );
}
