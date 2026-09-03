import { useEffect, useMemo, useState, useCallback } from 'react';
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
import { socketEmit } from '@/lib/socket';
import {
  attachCameraStreamToAllPeers,
  attachLocalStreamToAllPeers,
  attachScreenStreamToAllPeers,
  closeAllPeers,
  removeCameraStreamFromAllPeers,
  removeScreenStreamFromAllPeers,
} from '@/lib/webrtc';
import { CallStage } from '@/components/CallStage';
import { ScreenSharePicker } from '@/components/ScreenSharePicker';
import type { ScreenShareSelection } from '@/lib/screenShareContract';
import { createScreenStreamFromSelection } from '@/lib/screenShareContract';

interface VoicePanelProps {
  onOpenSettings: () => void;
}

export function VoicePanel({ onOpenSettings }: VoicePanelProps) {
  const user = useAppStore((s) => s.user);
  const setInVoiceChannel = useAppStore((s) => s.setInVoiceChannel);
  const channel = useAppStore((s) => s.inVoiceChannel);

  const {
    muted,
    deafened,
    cameraOn,
    screenSharing,
    localStream,
    cameraStream,
    screenStream,
    remoteStreams,
    remoteScreenStreams,
    participants: storeParticipants,
    isSpeaking,
    setMuted,
    setDeafened,
    setCameraOn,
    setScreenSharing,
    setLocalStream,
    setCameraStream,
    setScreenStream,
    setIsSpeaking,
    reset,
  } = useVoiceStore();

  const [micError, setMicError] = useState<string | null>(null);
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  const [screenSharePending, setScreenSharePending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusedScreenUserId, setFocusedScreenUserId] = useState<number | null>(null);

  useEffect(() => {
    if (!channel || !user) return;
    setMicError(null);
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ audio: true, video: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        s.getAudioTracks().forEach((t) => (t.enabled = !useVoiceStore.getState().muted));
        setLocalStream(s, channel.id);
      })
      .catch((err) => {
        if (cancelled) return;
        setMicError(err?.message ?? 'Falha ao acessar microfone.');
        setLocalStream(null);
      });
    return () => {
      cancelled = true;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (useVoiceStore.getState().localStream === stream) setLocalStream(null);
    };
  }, [channel?.id]);

  // Apply mute toggle to live track.
  useEffect(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
    if (user && channel) socketEmit.toggleMute(channel.id, user.id, muted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted]);

  useEffect(() => {
    if (!user || !channel) return;
    socketEmit.toggleDeafen(channel.id, user.id, deafened);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deafened]);

  // Detect local voice activity from the microphone. We send only changes of
  // state (speaking/not speaking), never audio or levels, so peers share the
  // same green speaking indicator without adding media traffic to Socket.IO.
  useEffect(() => {
    let audioContext: AudioContext | null = null;
    let animationFrame: number | null = null;
    let previousSpeaking = false;

    const publish = (speaking: boolean) => {
      if (previousSpeaking === speaking) return;
      previousSpeaking = speaking;
      setIsSpeaking(speaking);
      if (user && channel) socketEmit.speakingState(channel.id, user.id, speaking);
    };

    if (!user || !channel || !localStream || muted || localStream.getAudioTracks().length === 0) {
      setIsSpeaking(false);
      if (user && channel) socketEmit.speakingState(channel.id, user.id, false);
      return;
    }

    try {
      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(localStream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      void audioContext.resume().catch(() => undefined);

      const samples = new Uint8Array(analyser.fftSize);
      const measure = () => {
        analyser.getByteTimeDomainData(samples);
        let squaredSum = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          squaredSum += normalized * normalized;
        }
        const volume = Math.sqrt(squaredSum / samples.length);
        // Hysteresis prevents the indicator from flashing on quiet syllables.
        const threshold = previousSpeaking ? 0.012 : 0.018;
        publish(volume >= threshold);
        animationFrame = requestAnimationFrame(measure);
      };
      measure();
    } catch {
      // Voice continues to work when a browser does not expose Web Audio; only
      // the visual activity feedback is unavailable in that environment.
      setIsSpeaking(false);
    }

    return () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      publish(false);
      void audioContext?.close();
    };
  }, [channel?.id, user?.id, localStream, muted, setIsSpeaking]);

  // Fase B: when localStream becomes available after PCs were created
  // (race voice_participants before getUserMedia), attach tracks and renegotiate.
  useEffect(() => {
    if (!localStream) return;
    attachLocalStreamToAllPeers().catch((e) =>
      console.warn('[VoicePanel] attachLocalStream failed', e)
    );
  }, [localStream]);

  // Cleanup peers when leaving voice channel (channel becomes null)
  useEffect(() => {
    if (!channel) {
      closeAllPeers();
    }
  }, [channel?.id]);

  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  useEffect(() => {
    return () => {
      screenStream?.getTracks().forEach((track) => track.stop());
    };
  }, [screenStream]);

  useEffect(() => {
    return () => {
      cameraStream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraStream]);

  if (!channel) return null;

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
        return [{ participant, stream: stream ?? null, isLocal: participant.userId === user?.id }];
      }),
    [participants, user?.id, screenStream, remoteScreenStreams]
  );

  const disconnect = () => {
    setInVoiceChannel(null);
    closeAllPeers();
    reset();
  };

  const stopScreenShare = async (stream = screenStream) => {
    try {
      if (stream) await removeScreenStreamFromAllPeers(stream);
    } finally {
      setScreenStream(null);
      stream?.getTracks().forEach((track) => track.stop());
      setScreenSharing(false);
      if (user && channel) socketEmit.stopScreenShare(channel.id, user.id);
    }
  };

  const executeScreenShare = useCallback(async (selection: ScreenShareSelection) => {
    if (!user || !channel) return;
    setScreenShareError(null);
    setScreenSharePending(true);
    let stream: MediaStream | null = null;
    try {
      // Usa adaptador tipado — em Electron pode usar desktopCapturer, no browser fallback nativo
      stream = await createScreenStreamFromSelection(selection);
      const displayTrack = stream.getVideoTracks()[0];
      if (!displayTrack) throw new Error('Nenhuma tela foi selecionada.');
      displayTrack.contentHint = 'detail';
      setScreenStream(stream);
      setScreenSharing(true);
      // Notify peers before the offer so ontrack can associate the incoming
      // MediaStream with this screen share.
      socketEmit.startScreenShare(channel.id, user.id, stream.id);
      await attachScreenStreamToAllPeers();
      displayTrack.addEventListener('ended', () => {
        if (useVoiceStore.getState().screenStream === stream) {
          void stopScreenShare(stream);
        }
      });
    } catch (error) {
      if (stream) {
        await removeScreenStreamFromAllPeers(stream);
        stream.getTracks().forEach((track) => track.stop());
      }
      setScreenStream(null);
      setScreenSharing(false);
      socketEmit.stopScreenShare(channel.id, user.id);
      const name = error instanceof DOMException ? error.name : '';
      const msg = (error as Error)?.message ?? '';
      if (name === 'NotAllowedError' || /denied|NotAllowed|Permission/i.test(msg)) {
        setScreenShareError('Compartilhamento cancelado ou não autorizado.');
      } else if (/not supported|not found/i.test(msg)) {
        setScreenShareError('Fonte de tela não encontrada ou não suportada.');
      } else {
        setScreenShareError('Não foi possível iniciar o compartilhamento de tela.');
      }
    } finally {
      setScreenSharePending(false);
    }
  }, [user, channel]);

  const handlePickerSelect = useCallback(async (selection: ScreenShareSelection) => {
    setPickerOpen(false);
    await executeScreenShare(selection);
  }, [executeScreenShare]);

  const handlePickerCancel = useCallback(() => {
    setPickerOpen(false);
    // Não altera estado da call — erro não derruba
  }, []);

  const toggleScreenShare = async () => {
    if (!user || !channel || screenSharePending) return;
    setScreenShareError(null);
    if (!screenSharing) {
      // Abre seletor visual antes de iniciar (Fase 4)
      setPickerOpen(true);
    } else {
      setScreenSharePending(true);
      try {
        await stopScreenShare();
      } finally {
        setScreenSharePending(false);
      }
    }
  };

  const toggleCamera = async () => {
    if (!user || !channel) return;
    if (!cameraOn) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        setCameraStream(s);
        await attachCameraStreamToAllPeers();
        setCameraOn(true);
        socketEmit.toggleCamera(channel.id, user.id, true);
        s.getVideoTracks()[0].addEventListener('ended', () => {
          if (useVoiceStore.getState().cameraStream !== s) return;
          void removeCameraStreamFromAllPeers(s);
          setCameraStream(null);
          setCameraOn(false);
          socketEmit.toggleCamera(channel.id, user.id, false);
        });
      } catch {
        setCameraOn(false);
      }
    } else {
      if (cameraStream) {
        await removeCameraStreamFromAllPeers(cameraStream);
        setCameraStream(null);
        cameraStream.getTracks().forEach((track) => track.stop());
      }
      if (!cameraStream) setCameraStream(null);
      setCameraOn(false);
      socketEmit.toggleCamera(channel.id, user.id, false);
    }
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

      {/* Novo palco separado (Fase 3) — substitui grade mista anterior, mantendo compatibilidade */}
      <CallStage
        participants={participants}
        activeScreenShares={activeScreenShares}
        focusedScreenUserId={focusedScreenUserId}
        onChangeFocus={setFocusedScreenUserId}
        localUserId={user?.id}
        getCameraStream={(uid) => (uid === user?.id ? cameraStream : remoteStreams[uid] ?? null)}
        getIsCameraOn={(uid) => (uid === user?.id ? cameraOn : participants.find((p) => p.userId === uid)?.cameraOn ?? false)}
      />

      <div className="min-h-16 px-3 sm:px-6 py-2 flex flex-wrap items-center justify-center gap-2 border-t border-white/5 bg-black/30 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setMuted(!muted)}
          className={`p-3 rounded-full ${muted ? 'bg-red-500' : 'bg-white/10 hover:bg-white/20'}`}
          title={muted ? 'Desmutar Microfone' : 'Mutar Microfone'}
          aria-label={muted ? 'Desmutar microfone' : 'Mutar microfone'}
        >
          {muted ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
        </button>
        <button
          type="button"
          onClick={() => setDeafened(!deafened)}
          className={`p-3 rounded-full ${deafened ? 'bg-red-500' : 'bg-white/10 hover:bg-white/20'}`}
          title={deafened ? 'Desativar Surdina' : 'Ativar Surdina (Silenciar Áudio)'}
          aria-label={deafened ? 'Desativar fone' : 'Ativar fone'}
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
          aria-label={cameraOn ? 'Desligar câmera' : 'Ligar câmera'}
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
          aria-label="Copiar erro"
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
          <span className="text-xs text-amber-200 max-w-xs truncate" role="alert">{screenShareError}</span>
        )}
      </div>

      <ScreenSharePicker
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onCancel={handlePickerCancel}
        onSelect={handlePickerSelect}
      />
    </div>
  );
}
