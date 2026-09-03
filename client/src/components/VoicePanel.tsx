import { useMemo, useState } from 'react';
import {
  PhoneOff,
  Mic,
  MicOff,
  Headphones,
  Monitor,
  Video,
  VideoOff,
  Settings,
  Copy,
  Check,
  Volume2,
} from 'lucide-react';
import { Button } from '@/components/ui';
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
  const user = useAppStore((s) => s.user);
  const channel = useAppStore((s) => s.inVoiceChannel);

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
  } = useVoiceStore();

  const [copied, setCopied] = useState(false);

  const participants = useMemo(() => {
    // Combine the local user with the remote participants from the store
    // (populated by useSocketBridge's voice_participants / user_joined_voice
    // listeners). The store's `participants` list is keyed by userId.
    const selfParticipant = user
      ? [
          {
            userId: user.id,
            username: user.username,
            displayName: user.displayName || user.username,
            avatar: user.avatar,
            muted,
            speaking: isSpeaking && !muted,
            deafened,
            screenSharing,
            cameraOn,
          },
        ]
      : [];
    const remoteOnly = storeParticipants.filter((p) => p.userId !== user?.id);
    return [...selfParticipant, ...remoteOnly];
  }, [user, storeParticipants, muted, isSpeaking, deafened, screenSharing, cameraOn]);

  const activeScreenShares = useMemo(
    () =>
      participants.flatMap((participant) => {
        if (!participant.screenSharing) return [];
        const stream =
          participant.userId === user?.id
            ? screenStream
            : remoteScreenStreams[participant.userId];
        return [{ participant, stream: stream ?? null }];
      }),
    [participants, user?.id, screenStream, remoteScreenStreams]
  );

  if (!channel) return null;

  const total = participants.length;
  const gridCls =
    total === 1
      ? 'grid-cols-1 max-w-2xl'
      : total === 2
      ? 'grid-cols-1 md:grid-cols-2 max-w-4xl'
      : total <= 4
      ? 'grid-cols-2 max-w-4xl'
      : total <= 6
      ? 'grid-cols-2 md:grid-cols-3 max-w-5xl'
      : 'grid-cols-2 md:grid-cols-4 max-w-6xl';

  const disconnect = disconnectVoiceSession;
  const toggleScreenShare = async () => {
    if (!user || !channel || screenSharePending) return;
    if (screenSharing) await stopScreenShare();
    else await startScreenShare();
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background relative h-full">
      {/* Hidden audio elements for remote streams — Fase B */}
      <div className="hidden" aria-hidden>
        {Object.entries(remoteStreams).map(([uid, stream]) => (
          <audio
            key={uid}
            autoPlay
            playsInline
            muted={deafened}
            ref={(el) => {
              if (el && stream) {
                const mediaStream = stream as MediaStream;
                if (el.srcObject !== mediaStream) el.srcObject = mediaStream;
                el.muted = deafened;
                el.volume = deafened ? 0 : 1;
                const p = el.play();
                if (p && typeof (p as Promise<void>).catch === 'function')
                  (p as Promise<void>).catch(() => {
                    // Autoplay may be blocked until user gesture; joinVoice click counts as gesture in Electron
                    console.warn('[VoicePanel] audio play blocked for user', uid);
                  });
              }
            }}
          />
        ))}
      </div>
      <div className="min-h-14 px-3 sm:px-6 py-2 flex items-center justify-between gap-3 border-b border-white/5 flex-shrink-0 bg-card/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse shadow-lg shadow-emerald-500/50" />
          <h2 className="font-bold text-foreground text-base tracking-wide">
            {channel.name || 'Canal de Voz'}
          </h2>
          <span className="bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-0.5 rounded-full font-medium border border-emerald-500/20 flex items-center gap-1.5">
            <Volume2 className="w-3 h-3" /> Voz Conectada
          </span>
        </div>
        <Button variant="destructive" size="sm" onClick={disconnect}>
          <PhoneOff className="w-4 h-4 mr-2" />
          Desconectar
        </Button>
      </div>

      <div className={`flex-1 overflow-y-auto p-3 sm:p-6 grid ${gridCls} gap-4 content-center mx-auto w-full`}>
        {activeScreenShares.map(({ participant, stream }) => (
          <div
            key={`screen-${participant.userId}`}
            className="col-span-full aspect-video bg-black rounded-2xl border border-blue-400/40 overflow-hidden relative shadow-xl shadow-blue-500/10"
          >
            {stream ? (
              <video
                autoPlay
                playsInline
                muted
                ref={(element) => {
                  if (element && element.srcObject !== stream) element.srcObject = stream;
                }}
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <Monitor className="w-10 h-10 text-blue-300 animate-pulse" />
                <span>Conectando à tela de {participant.displayName}…</span>
              </div>
            )}
            <div className="absolute top-3 left-3 px-3 py-1.5 bg-black/70 rounded-md text-sm font-medium flex items-center gap-2">
              <Monitor className="w-4 h-4 text-blue-300" />
              Tela de {participant.userId === user?.id ? 'Você' : participant.displayName}
            </div>
          </div>
        ))}
        {participants.map((p) => {
          const stream = p.userId === user?.id ? cameraStream : remoteStreams[p.userId];
          const speaking = Boolean(p.speaking && !p.muted);
          const hasVideo = Boolean(
            stream?.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted) &&
              (p.userId === user?.id ? cameraOn : p.cameraOn)
          );
          return (
            <div
              key={p.userId}
              className={`aspect-video bg-secondary rounded-2xl border flex items-center justify-center relative overflow-hidden transition-all duration-150 ${
                speaking
                  ? 'border-emerald-400 ring-2 ring-emerald-400 ring-offset-2 ring-offset-background shadow-lg shadow-emerald-500/25'
                  : 'border-white/10'
              }`}
              aria-label={speaking ? `${p.displayName} está falando` : p.displayName}
            >
              {hasVideo ? (
                <video
                  autoPlay
                  playsInline
                  muted
                  ref={(el) => {
                    if (el && stream) el.srcObject = stream;
                  }}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center text-2xl font-bold">
                  {p.displayName?.[0]?.toUpperCase()}
                </div>
              )}
              <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 rounded-md text-xs font-medium">
                {p.displayName}
                {p.userId === user?.id ? ' (Você)' : ''}
              </div>
              <div className="absolute bottom-2 right-2 flex gap-1">
                {speaking && (
                  <span className="bg-emerald-500 p-1 rounded-full" title="Falando">
                    <Volume2 className="w-3 h-3 text-white" />
                  </span>
                )}
                {p.muted && (
                  <span className="bg-red-500 p-1 rounded-full">
                    <MicOff className="w-3 h-3 text-white" />
                  </span>
                )}
                {p.deafened && (
                  <span className="bg-red-500 p-1 rounded-full">
                    <Headphones className="w-3 h-3 text-white" />
                  </span>
                )}
                {p.screenSharing && (
                  <span className="bg-blue-500 p-1 rounded-full">
                    <Monitor className="w-3 h-3 text-white" />
                  </span>
                )}
                {p.cameraOn && (
                  <span className="bg-emerald-500 p-1 rounded-full">
                    <Video className="w-3 h-3 text-white" />
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="min-h-16 px-3 sm:px-6 py-2 flex flex-wrap items-center justify-center gap-2 border-t border-white/5 bg-black/30 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setMuted(!muted)}
          className={`p-3 rounded-full ${muted ? 'bg-red-500' : 'bg-white/10 hover:bg-white/20'}`}
          title={muted ? 'Desmutar Microfone' : 'Mutar Microfone'}
        >
          {muted ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
        </button>
        <button
          type="button"
          onClick={() => setDeafened(!deafened)}
          className={`p-3 rounded-full ${deafened ? 'bg-red-500' : 'bg-white/10 hover:bg-white/20'}`}
          title={deafened ? 'Desativar Surdina' : 'Ativar Surdina (Silenciar Áudio)'}
        >
          <Headphones className="w-5 h-5 text-white" />
        </button>
        <button
          type="button"
          onClick={toggleScreenShare}
          disabled={screenSharePending}
          aria-pressed={screenSharing}
          aria-label={screenSharing ? 'Parar compartilhamento de tela' : 'Compartilhar tela'}
          className={`p-3 rounded-full transition-colors disabled:cursor-wait disabled:opacity-60 ${screenSharing ? 'bg-blue-500' : 'bg-white/10 hover:bg-white/20'}`}
          title={screenSharing ? 'Parar Compartilhamento' : 'Compartilhar Tela'}
        >
          <Monitor className="w-5 h-5 text-white" />
        </button>
        <button
          type="button"
          onClick={toggleCamera}
          className={`p-3 rounded-full ${cameraOn ? 'bg-emerald-500' : 'bg-white/10 hover:bg-white/20'}`}
          title={cameraOn ? 'Desligar Câmera' : 'Ligar Câmera'}
        >
          {cameraOn ? <Video className="w-5 h-5 text-white" /> : <VideoOff className="w-5 h-5 text-white" />}
        </button>
        <button
          type="button"
          onClick={() => {
            if (micError) {
              navigator.clipboard.writeText(micError).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }
          }}
          className="p-3 rounded-full bg-white/10 hover:bg-white/20"
          title={micError ? 'Copiar erro de microfone' : 'Sem erro de microfone'}
        >
          {copied ? <Check className="w-5 h-5 text-white" /> : <Copy className="w-5 h-5 text-white" />}
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="p-3 rounded-full bg-white/10 hover:bg-white/20"
          title="Configurações de voz"
          aria-label="Abrir configurações de voz"
        >
          <Settings className="w-5 h-5 text-white" />
        </button>
        {micError && (
          <span className="text-xs text-red-300 ml-3 max-w-xs truncate">{micError}</span>
        )}
        {screenShareError && (
          <span className="text-xs text-amber-200 max-w-xs truncate">{screenShareError}</span>
        )}
      </div>
    </div>
  );
}
