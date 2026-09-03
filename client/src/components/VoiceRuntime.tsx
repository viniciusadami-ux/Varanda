import { useEffect } from 'react';
import { attachLocalStreamToAllPeers } from '@/lib/webrtc';
import { socketEmit } from '@/lib/socket';
import { useAppStore } from '@/store/appStore';
import { useVoiceStore } from '@/store/voiceStore';

function PersistentAudio({
  stream,
  muted,
  label,
}: {
  stream: MediaStream;
  muted: boolean;
  label: string;
}) {
  return (
    <audio
      autoPlay
      playsInline
      muted={muted}
      aria-label={label}
      ref={(element) => {
        if (!element) return;
        if (element.srcObject !== stream) element.srcObject = stream;
        element.muted = muted;
        element.volume = muted ? 0 : 1;
        void element.play().catch(() => {
          console.warn(`[VoiceRuntime] Audio playback blocked: ${label}`);
        });
      }}
    />
  );
}

/**
 * Owns call media for the whole authenticated application lifetime.
 * Panels may mount/unmount freely; only changing/ending the voice session
 * changes these tracks.
 */
export function VoiceRuntime({ playVoiceAudio }: { playVoiceAudio: boolean }) {
  const channel = useAppStore((state) => state.inVoiceChannel);
  const user = useAppStore((state) => state.user);
  const {
    muted,
    deafened,
    localStream,
    localStreamChannelId,
    remoteStreams,
    remoteScreenStreams,
    setLocalStream,
    setMicError,
    setIsSpeaking,
  } = useVoiceStore();

  useEffect(() => {
    if (!channel || !user) return;
    const current = useVoiceStore.getState();
    const existingIsLive =
      current.localStreamChannelId === channel.id &&
      current.localStream?.getAudioTracks().some((track) => track.readyState === 'live');
    if (existingIsLive) return;

    let acquired: MediaStream | null = null;
    let cancelled = false;
    setMicError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('Captura de microfone nao e suportada neste ambiente.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        acquired = stream;
        stream.getAudioTracks().forEach((track) => {
          track.enabled = !useVoiceStore.getState().muted;
        });
        setLocalStream(stream, channel.id);
      })
      .catch((error) => {
        if (cancelled) return;
        setMicError(error instanceof Error ? error.message : 'Falha ao acessar microfone.');
        setLocalStream(null);
      });

    return () => {
      cancelled = true;
      if (acquired) {
        acquired.getTracks().forEach((track) => track.stop());
        if (useVoiceStore.getState().localStream === acquired) setLocalStream(null);
      }
    };
  }, [channel?.id, user?.id, setLocalStream, setMicError]);

  useEffect(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    if (user && channel) socketEmit.toggleMute(channel.id, user.id, muted);
  }, [channel?.id, user?.id, localStream, muted]);

  useEffect(() => {
    if (user && channel) socketEmit.toggleDeafen(channel.id, user.id, deafened);
  }, [channel?.id, user?.id, deafened]);

  useEffect(() => {
    if (!localStream || localStreamChannelId !== channel?.id) return;
    void attachLocalStreamToAllPeers().catch((error) => {
      console.warn('[VoiceRuntime] Failed to attach microphone:', error);
    });
  }, [channel?.id, localStream, localStreamChannelId]);

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
        publish(volume >= (previousSpeaking ? 0.012 : 0.018));
        animationFrame = requestAnimationFrame(measure);
      };
      measure();
    } catch {
      setIsSpeaking(false);
    }

    return () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      publish(false);
      void audioContext?.close();
    };
  }, [channel?.id, user?.id, localStream, muted, setIsSpeaking]);

  if (!channel) return null;
  return (
    <div className='hidden' aria-hidden>
      {playVoiceAudio && Object.entries(remoteStreams).map(([userId, stream]) => (
        <PersistentAudio
          key={`voice-${userId}`}
          stream={stream}
          muted={deafened}
          label={`Audio de voz de ${userId}`}
        />
      ))}
      {Object.entries(remoteScreenStreams).map(([userId, stream]) => (
        <PersistentAudio
          key={`presentation-${userId}`}
          stream={stream}
          muted={deafened}
          label={`Audio da apresentacao de ${userId}`}
        />
      ))}
    </div>
  );
}
