import { socketEmit } from '@/lib/socket';
import {
  attachCameraStreamToAllPeers,
  attachScreenStreamToAllPeers,
  closeAllPeers,
  removeCameraStreamFromAllPeers,
  removeScreenStreamFromAllPeers,
} from '@/lib/webrtc';
import { useAppStore } from '@/store/appStore';
import { useVoiceStore } from '@/store/voiceStore';
import type { Channel } from '@/types';
import type { ShareSource, ShareSourceSelection } from '@/types/screenShare';

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // The device/window may already have ended.
    }
  });
}

function screenShareError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return 'Compartilhamento cancelado ou nao autorizado.';
  }
  if (name === 'NotFoundError') return 'A fonte selecionada nao esta mais disponivel.';
  return error instanceof Error && error.message
    ? error.message
    : 'Nao foi possivel iniciar o compartilhamento de tela.';
}

export async function listShareSources(): Promise<ShareSource[]> {
  if (!window.electronAPI) return [];
  try {
    return await window.electronAPI.listShareSources();
  } catch (error) {
    useVoiceStore.getState().setScreenShareError(screenShareError(error));
    return [];
  }
}

/**
 * Starts a presentation after the renderer UI selected a temporary source.
 * In a regular browser, omitting selection delegates to the browser picker.
 */
export async function startScreenShare(
  selection?: ShareSourceSelection
): Promise<boolean> {
  const voice = useVoiceStore.getState();
  const { user, inVoiceChannel } = useAppStore.getState();
  if (!user || !inVoiceChannel || voice.screenSharePending || voice.screenStream) return false;

  voice.setScreenShareError(null);
  voice.setScreenSharePending(true);
  let stream: MediaStream | null = null;
  let announced = false;
  const includeAudio = selection?.includeAudio ?? false;

  try {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Compartilhamento de tela nao e suportado neste ambiente.');
    }
    if (window.electronAPI) {
      if (!selection) {
        throw new Error('Selecione uma tela ou janela antes de compartilhar.');
      }
      await window.electronAPI.selectShareSource(selection);
    }

    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 } },
      audio: includeAudio,
    });
    if (useAppStore.getState().inVoiceChannel?.id !== inVoiceChannel.id) {
      throw new DOMException('A chamada foi encerrada durante a selecao.', 'AbortError');
    }
    const displayTrack = stream.getVideoTracks()[0];
    if (!displayTrack) throw new DOMException('Nenhuma fonte selecionada.', 'NotFoundError');
    displayTrack.contentHint = 'detail';

    // Be defensive if a platform returns audio despite audio:false.
    if (!includeAudio) {
      for (const track of stream.getAudioTracks()) {
        stream.removeTrack(track);
        track.stop();
      }
    }

    voice.setScreenStream(stream);
    voice.setScreenSharing(true);
    socketEmit.startScreenShare(inVoiceChannel.id, user.id, stream.id);
    announced = true;
    await attachScreenStreamToAllPeers();
    displayTrack.addEventListener(
      'ended',
      () => {
        if (useVoiceStore.getState().screenStream === stream) {
          void stopScreenShare(stream);
        }
      },
      { once: true }
    );
    return true;
  } catch (error) {
    if (useVoiceStore.getState().screenStream === stream) {
      voice.setScreenStream(null);
      voice.setScreenSharing(false);
    }
    if (stream) {
      try {
        await removeScreenStreamFromAllPeers(stream);
      } catch (renegotiationError) {
        console.warn('[voiceSession] Failed to roll back presentation senders:', renegotiationError);
      }
      stopStream(stream);
    }
    if (announced) socketEmit.stopScreenShare(inVoiceChannel.id, user.id);
    await window.electronAPI?.clearShareSelection().catch(() => undefined);
    voice.setScreenShareError(screenShareError(error));
    return false;
  } finally {
    voice.setScreenSharePending(false);
  }
}

let stoppingScreenShare: Promise<void> | null = null;

export function stopScreenShare(target?: MediaStream | null): Promise<void> {
  if (stoppingScreenShare) return stoppingScreenShare;
  const task = (async () => {
    const voice = useVoiceStore.getState();
    const { user, inVoiceChannel } = useAppStore.getState();
    const stream = target ?? voice.screenStream;
    if (!stream) {
      voice.setScreenSharing(false);
      return;
    }
    voice.setScreenSharePending(true);

    // Clear store ownership before renegotiation, otherwise addLocalTracks
    // would immediately re-add the presentation senders being removed.
    if (voice.screenStream === stream) {
      voice.setScreenStream(null);
      voice.setScreenSharing(false);
    }
    try {
      await removeScreenStreamFromAllPeers(stream);
    } catch (error) {
      voice.setScreenShareError('A apresentacao parou, mas a renegociacao falhou.');
      console.warn('[voiceSession] Failed to renegotiate presentation stop:', error);
    } finally {
      stopStream(stream);
      if (user && inVoiceChannel) {
        socketEmit.stopScreenShare(inVoiceChannel.id, user.id);
      }
      voice.setScreenSharePending(false);
    }
  })();
  stoppingScreenShare = task.finally(() => {
    stoppingScreenShare = null;
  });
  return stoppingScreenShare;
}

export async function toggleCamera(): Promise<void> {
  const voice = useVoiceStore.getState();
  const { user, inVoiceChannel } = useAppStore.getState();
  if (!user || !inVoiceChannel) return;
  if (!voice.cameraOn) {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (useAppStore.getState().inVoiceChannel?.id !== inVoiceChannel.id) {
        stopStream(stream);
        return;
      }
      voice.setCameraStream(stream);
      await attachCameraStreamToAllPeers();
      voice.setCameraOn(true);
      socketEmit.toggleCamera(inVoiceChannel.id, user.id, true);
      stream.getVideoTracks()[0]?.addEventListener(
        'ended',
        () => {
          if (useVoiceStore.getState().cameraStream === stream) void toggleCamera();
        },
        { once: true }
      );
    } catch (error) {
      if (useVoiceStore.getState().cameraStream === stream) voice.setCameraStream(null);
      stopStream(stream);
      voice.setCameraOn(false);
      console.warn('[voiceSession] Camera start failed:', error);
    }
    return;
  }

  const stream = voice.cameraStream;
  voice.setCameraStream(null);
  voice.setCameraOn(false);
  try {
    if (stream) await removeCameraStreamFromAllPeers(stream);
  } catch (error) {
    console.warn('[voiceSession] Camera stop renegotiation failed:', error);
  } finally {
    stopStream(stream);
    socketEmit.toggleCamera(inVoiceChannel.id, user.id, false);
  }
}

export function disconnectVoiceSession(): void {
  const app = useAppStore.getState();
  const voice = useVoiceStore.getState();
  const channel = app.inVoiceChannel;
  const user = app.user;
  if (channel && user) {
    socketEmit.speakingState(channel.id, user.id, false);
    if (voice.screenSharing) socketEmit.stopScreenShare(channel.id, user.id);
    if (voice.cameraOn) socketEmit.toggleCamera(channel.id, user.id, false);
    socketEmit.leaveVoice(channel.id, user.id);
  }
  stopStream(voice.localStream);
  stopStream(voice.cameraStream);
  stopStream(voice.screenStream);
  closeAllPeers();
  voice.reset();
  app.setInVoiceChannel(null);
  void window.electronAPI?.clearShareSelection().catch(() => undefined);
}

export function joinVoiceSession(channel: Channel): void {
  const current = useAppStore.getState().inVoiceChannel;
  if (current?.id === channel.id) return;
  if (current) disconnectVoiceSession();
  useAppStore.getState().setInVoiceChannel(channel);
}
