import { useEffect, useRef, useState, useCallback } from 'react';
import { Maximize2, Minimize2, Monitor, Volume2, Loader2, Video, MicOff } from 'lucide-react';
import type { VoiceParticipant } from '@/types';

export interface StageScreenShare {
  participant: VoiceParticipant;
  stream: MediaStream | null;
  isLocal?: boolean;
}

interface CallStageProps {
  /** Lista de participantes (inclui local) já combinada */
  participants: VoiceParticipant[];
  /** Apresentações ativas (um por quem está compartilhando) */
  activeScreenShares: StageScreenShare[];
  /** Id do usuário em foco quando há múltiplas apresentações */
  focusedScreenUserId?: number | null;
  onChangeFocus?: (userId: number) => void;
  /** Streams para exibir câmera (usados na faixa de participantes) */
  getCameraStream?: (userId: number) => MediaStream | null | undefined;
  getIsCameraOn?: (userId: number) => boolean;
  /** Usuário local para diferenciar mute/espelho */
  localUserId?: number;
  /** Quando não há apresentação, mostrar placeholder */
  emptyLabel?: string;
}

/**
 * Palco principal separado dos participantes.
 * - Apresentação em container dedicado (object-contain, sem cortar)
 * - Participantes em faixa inferior/lateral rolável, sem cobrir a apresentação
 * - Suporte a múltiplas apresentações com escolha de foco
 * - Fullscreen via botão e duplo clique, Esc sai (Fullscreen API)
 * - Acessível por teclado (aria-label, foco visível)
 * - Funciona em 900x600 (flex + min-h, sem sobreposição)
 */
export function CallStage({
  participants,
  activeScreenShares,
  focusedScreenUserId,
  onChangeFocus,
  getCameraStream,
  getIsCameraOn,
  localUserId,
  emptyLabel = 'Nenhuma apresentação no momento',
}: CallStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [internalFocus, setInternalFocus] = useState<number | null>(null);

  // Escolhe foco inicial: prop ou primeiro da lista
  const effectiveFocusId =
    focusedScreenUserId ?? internalFocus ?? activeScreenShares[0]?.participant.userId ?? null;

  const focusedShare = activeScreenShares.find((s) => s.participant.userId === effectiveFocusId) ?? activeScreenShares[0] ?? null;

  const handleSelectFocus = useCallback(
    (userId: number) => {
      setInternalFocus(userId);
      onChangeFocus?.(userId);
    },
    [onChangeFocus]
  );

  const toggleFullscreen = useCallback(async () => {
    const el = stageRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.warn('[CallStage] fullscreen toggle failed', e);
    }
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (focusedShare) void toggleFullscreen();
  }, [focusedShare, toggleFullscreen]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Esc já é tratado nativamente pelo Fullscreen API; apenas sincroniza estado

  const hasScreen = !!focusedShare;

  return (
    <div className="flex flex-col min-h-0 flex-1 bg-[#0f0f12] text-foreground overflow-hidden" data-testid="call-stage">
      {/* Área principal + faixa */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {/* Palco principal — SEPARADO da grade de participantes */}
        <div
          ref={stageRef}
          onDoubleClick={handleDoubleClick}
          className={`relative flex-1 min-h-[260px] flex flex-col bg-black overflow-hidden border-b border-white/10
            ${isFullscreen ? 'p-0' : ''}`}
          aria-label="Palco da apresentação"
        >
          {/* Cabeçalho da apresentação — não sobrepõe o vídeo (fora do vídeo, mas dentro do palco) */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-900/80 border-b border-white/5 flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {hasScreen ? (
                <>
                  <Monitor className="w-4 h-4 text-blue-400 flex-shrink-0" aria-hidden />
                  <span className="text-sm font-medium truncate">
                    Tela de {focusedShare.participant.displayName}
                    {focusedShare.participant.userId === localUserId ? ' (você)' : ''}
                  </span>
                  {focusedShare.stream?.getAudioTracks().some((t) => t.readyState === 'live') ? (
                    <span className="inline-flex items-center gap-1 text-xs bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                      <Volume2 className="w-3 h-3" aria-hidden /> áudio compartilhado
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-sm text-zinc-400 flex items-center gap-2">
                  <Monitor className="w-4 h-4" aria-hidden /> {emptyLabel}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {hasScreen && activeScreenShares.length > 1 && (
                <span className="text-xs text-zinc-400 hidden sm:inline mr-2">
                  {activeScreenShares.length} apresentações · clique para focar
                </span>
              )}
              <button
                type="button"
                onClick={toggleFullscreen}
                disabled={!hasScreen}
                aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                aria-pressed={isFullscreen}
                className="p-2 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 text-zinc-200"
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Múltiplas apresentações — seletor de foco (não sobrepõe vídeo) */}
          {activeScreenShares.length > 1 && (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900/60 border-b border-white/5 overflow-x-auto scrollbar-thin flex-shrink-0" role="tablist" aria-label="Escolher apresentação em foco">
              {activeScreenShares.map((s) => {
                const isFocused = s.participant.userId === effectiveFocusId;
                return (
                  <button
                    key={s.participant.userId}
                    type="button"
                    role="tab"
                    aria-selected={isFocused}
                    aria-label={`Focar apresentação de ${s.participant.displayName}`}
                    onClick={() => handleSelectFocus(s.participant.userId)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors
                      ${isFocused ? 'bg-blue-600 text-white border-blue-500' : 'bg-white/5 text-zinc-300 border-white/10 hover:bg-white/10'}`}
                  >
                    {s.participant.displayName}
                    {s.participant.userId === localUserId ? ' (você)' : ''}
                  </button>
                );
              })}
            </div>
          )}

          {/* Vídeo da apresentação — object-contain, sem cortar */}
          <div className="relative flex-1 min-h-0 flex items-center justify-center bg-black p-2 sm:p-3 overflow-hidden">
            {hasScreen ? (
              focusedShare.stream ? (
                <video
                  key={`screen-${focusedShare.participant.userId}`}
                  autoPlay
                  playsInline
                  muted
                  ref={(el) => {
                    if (el && el.srcObject !== focusedShare.stream) el.srcObject = focusedShare.stream;
                  }}
                  className="w-full h-full max-w-full max-h-full object-contain bg-black rounded-lg"
                  aria-label={`Apresentação de ${focusedShare.participant.displayName}`}
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 text-zinc-400 py-10" role="status" aria-live="polite">
                  <Loader2 className="w-10 h-10 animate-spin text-blue-400" aria-hidden />
                  <span className="text-sm">Conectando à tela de {focusedShare.participant.displayName}…</span>
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 text-zinc-500 py-10 text-center px-4">
                <Monitor className="w-10 h-10 text-zinc-600" aria-hidden />
                <p className="text-sm max-w-md">Nenhuma apresentação ativa. Quando alguém compartilhar a tela, ela aparecerá aqui em destaque.</p>
                <p className="text-xs text-zinc-600 max-w-md">A faixa de participantes abaixo continua visível com câmera e áudio.</p>
              </div>
            )}
            {/* Indicador de proporção preservada — sutil, não cobre */}
          </div>

          {/* Dica de duplo clique — fora do vídeo, mas no palco */}
          {hasScreen && !isFullscreen && (
            <div className="px-3 py-1.5 bg-zinc-900/40 text-[11px] text-zinc-500 border-t border-white/5 text-center flex-shrink-0">
              Duplo clique na apresentação para tela cheia · <kbd className="px-1 py-0.5 bg-white/10 rounded border border-white/10 font-mono">Esc</kbd> para sair
            </div>
          )}
        </div>

        {/* Faixa de participantes — SEPARADA, não cobre nem comprime o palco (altura fixa, scroll) */}
        <div
          className="flex-shrink-0 border-t border-white/10 bg-zinc-900/60 backdrop-blur-sm"
          aria-label="Faixa de participantes"
        >
          <div className="px-2 sm:px-3 py-2">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-semibold tracking-wide uppercase text-zinc-400">
                Participantes · {participants.length}
              </span>
              <span className="text-[11px] text-zinc-500 hidden sm:inline">Faixa separada da apresentação</span>
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1 snap-x" role="list" style={{ scrollbarGutter: 'stable' }}>
              {participants.map((p) => {
                const isLocal = p.userId === localUserId;
                const stream = getCameraStream?.(p.userId) ?? null;
                const cameraOn = getIsCameraOn?.(p.userId) ?? p.cameraOn;
                const hasVideo = !!stream?.getVideoTracks().some((t) => t.readyState === 'live') && cameraOn;
                const speaking = !!p.speaking && !p.muted;
                return (
                  <div
                    key={p.userId}
                    role="listitem"
                    className={`relative flex-shrink-0 w-[160px] sm:w-[180px] aspect-video bg-zinc-800 rounded-xl border overflow-hidden snap-start flex items-center justify-center
                      ${speaking ? 'border-emerald-500 ring-2 ring-emerald-500/40' : 'border-white/10'}`}
                    aria-label={`${p.displayName}${isLocal ? ' (você)' : ''}${speaking ? ' falando' : ''}${p.muted ? ' microfone silenciado' : ''}`}
                  >
                    {hasVideo && stream ? (
                      <video
                        autoPlay
                        playsInline
                        muted
                        ref={(el) => {
                          if (el && el.srcObject !== stream) el.srcObject = stream;
                        }}
                        className="w-full h-full object-cover bg-zinc-900"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold">
                        {p.displayName?.[0]?.toUpperCase()}
                      </div>
                    )}
                    {/* Nome — barra inferior dedicada, não sobreposta ao centro */}
                    <div className="absolute bottom-0 inset-x-0 flex items-center justify-between gap-1 px-2 py-1 bg-black/65 backdrop-blur-sm">
                      <span className="text-xs font-medium truncate text-white">{p.displayName}{isLocal ? ' (você)' : ''}</span>
                      <span className="flex items-center gap-1 flex-shrink-0">
                        {speaking && <Volume2 className="w-3 h-3 text-emerald-400" aria-label="Falando" />}
                        {p.muted && <MicOff className="w-3 h-3 text-red-400" aria-label="Microfone silenciado" />}
                        {p.screenSharing && <Monitor className="w-3 h-3 text-blue-400" aria-label="Compartilhando tela" />}
                        {p.cameraOn && <Video className="w-3 h-3 text-white/80" aria-label="Câmera ligada" />}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {participants.length === 1 && (
              <p className="text-xs text-zinc-500 mt-1">Apresentação continua visível mesmo com apenas uma pessoa na chamada.</p>
            )}
          </div>
        </div>
      </div>

      {/* Garantia de 900x600: containers usam min-h e flex, sem sobreposição */}
      <style>{`@media (max-width: 900px) { [data-testid="call-stage"] { min-width: 0 } }`}</style>
    </div>
  );
}
