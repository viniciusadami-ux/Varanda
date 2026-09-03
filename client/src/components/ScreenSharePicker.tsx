import { useEffect, useMemo, useRef, useState } from 'react';
import { Monitor, AppWindow, Volume2, Loader2, AlertCircle, X, Check, Info } from 'lucide-react';
import { Button } from '@/components/ui';
import type { ScreenSource, ScreenShareSelection, PickerTab } from '@/lib/screenShareContract';
import { fetchScreenSources, getScreenShareCapabilities, isElectronEnvironment } from '@/lib/screenShareContract';

interface ScreenSharePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (selection: ScreenShareSelection) => void;
  onCancel?: () => void;
  /** Fontes injetadas (para testes ou núcleo). Se não fornecido, o picker busca via adaptador */
  sources?: ScreenSource[];
  isLoadingProp?: boolean;
  errorProp?: string | null;
  /** Suporte a áudio vindo do contrato; se não fornecido, detecta */
  supportsAudioProp?: boolean;
}

export function ScreenSharePicker({
  isOpen,
  onClose,
  onSelect,
  onCancel,
  sources: injectedSources,
  isLoadingProp,
  errorProp,
  supportsAudioProp,
}: ScreenSharePickerProps) {
  const [activeTab, setActiveTab] = useState<PickerTab>('screen');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [withAudio, setWithAudio] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLButtonElement>(null);

  const capabilities = useMemo(() => getScreenShareCapabilities(), []);
  const supportsAudio = supportsAudioProp ?? capabilities.supportsSystemAudio;
  const isElectron = isElectronEnvironment();

  // Carrega fontes quando abre (se não injetadas)
  useEffect(() => {
    if (!isOpen) return;
    setSelectedId(null);
    setError(errorProp ?? null);
    if (injectedSources !== undefined) {
      setSources(injectedSources);
      setIsLoading(!!isLoadingProp);
      return;
    }
    if (isLoadingProp !== undefined) setIsLoading(isLoadingProp);
    else {
      setIsLoading(true);
      fetchScreenSources()
        .then(({ sources: fetched, error: fetchError }) => {
          setSources(fetched);
          if (fetchError) setError(fetchError);
        })
        .catch((e) => setError((e as Error).message))
        .finally(() => setIsLoading(false));
    }
  }, [isOpen, injectedSources, isLoadingProp, errorProp]);

  useEffect(() => {
    if (errorProp !== undefined) setError(errorProp);
  }, [errorProp]);

  // Foco inicial e trap
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => firstFocusRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  const handleCancel = () => {
    onCancel?.();
    onClose();
  };

  const handleConfirm = () => {
    if (!selectedId) return;
    onSelect({ sourceId: selectedId, withAudio: supportsAudio ? withAudio : false });
  };

  const handleUseNative = async () => {
    // Fallback navegador: devolve seleção especial que o núcleo interpretará como "usar picker nativo"
    // Não alegamos isolamento por app — será áudio do sistema quando disponível
    onSelect({ sourceId: '__native_picker__', withAudio: supportsAudio ? withAudio : false });
  };

  const filtered = useMemo(() => {
    if (!sources.length) return [];
    return sources.filter((s) => (activeTab === 'screen' ? s.kind === 'screen' : s.kind === 'window'));
  }, [sources, activeTab]);

  const screenCount = sources.filter((s) => s.kind === 'screen').length;
  const windowCount = sources.filter((s) => s.kind === 'window').length;

  if (!isOpen) return null;

  const hasSources = sources.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="screenshare-picker-title"
        aria-describedby="screenshare-picker-desc"
        className="w-full max-w-3xl max-h-[85vh] sm:max-h-[80vh] bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        tabIndex={-1}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-white/10 flex-shrink-0">
          <div>
            <h2 id="screenshare-picker-title" className="text-base font-semibold text-white">
              Compartilhar sua tela
            </h2>
            <p id="screenshare-picker-desc" className="text-xs text-zinc-400 mt-0.5">
              Escolha o que deseja compartilhar. A apresentação ficará em destaque no palco.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Fechar seletor"
            className="p-2 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs — sempre visíveis, mesmo em 900x600 */}
        <div className="flex items-center gap-1 px-4 sm:px-5 py-2 border-b border-white/5 bg-zinc-900/50 flex-shrink-0" role="tablist" aria-label="Tipos de fonte">
          <button
            ref={firstFocusRef}
            type="button"
            role="tab"
            aria-selected={activeTab === 'screen'}
            aria-label={`Telas, ${screenCount} opções`}
            onClick={() => setActiveTab('screen')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors ${
              activeTab === 'screen' ? 'bg-white text-zinc-900 border-white' : 'bg-white/5 text-zinc-300 border-white/10 hover:bg-white/10'
            }`}
          >
            <Monitor className="w-4 h-4" aria-hidden /> Telas
            {screenCount > 0 && <span className="text-xs opacity-70">· {screenCount}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'window'}
            aria-label={`Janelas e aplicativos, ${windowCount} opções`}
            onClick={() => setActiveTab('window')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors ${
              activeTab === 'window' ? 'bg-white text-zinc-900 border-white' : 'bg-white/5 text-zinc-300 border-white/10 hover:bg-white/10'
            }`}
          >
            <AppWindow className="w-4 h-4" aria-hidden /> Janelas e aplicativos
            {windowCount > 0 && <span className="text-xs opacity-70">· {windowCount}</span>}
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 bg-zinc-950/30">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-zinc-400" role="status" aria-live="polite">
              <Loader2 className="w-8 h-8 animate-spin text-blue-400" aria-hidden />
              <span className="text-sm">Carregando telas e janelas…</span>
              <span className="text-xs text-zinc-500">Aguardando fontes do sistema</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3 text-center" role="alert">
              <AlertCircle className="w-8 h-8 text-amber-400" aria-hidden />
              <p className="text-sm text-zinc-200">{error}</p>
              <p className="text-xs text-zinc-500 max-w-md">Você pode tentar novamente ou usar o seletor nativo sem fechar a chamada.</p>
              <div className="flex gap-2 mt-2">
                <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>
                  Tentar novamente
                </Button>
                <Button size="sm" onClick={handleCancel}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : !hasSources ? (
            // Fallback navegador / sem fontes (não inventa falsas em produção)
            <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center">
                <Monitor className="w-8 h-8 text-blue-400" aria-hidden />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Seletor nativo do navegador</h3>
                <p className="text-xs text-zinc-400 mt-1 max-w-md">
                  Seu ambiente abrirá o seletor do sistema para escolher tela ou janela. Selecione uma única fonte e confirme.
                </p>
              </div>
              <Button onClick={handleUseNative} className="gap-2" disabled={!supportsAudio && false} aria-label="Abrir seletor nativo">
                <Monitor className="w-4 h-4" /> Escolher via seletor nativo
              </Button>
              <p className="text-[11px] text-zinc-500 max-w-md">
                Dica: a interface está pronta para receber fontes reais do núcleo Electron quando disponível.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-zinc-500 text-sm">
              Nenhuma {activeTab === 'screen' ? 'tela' : 'janela'} encontrada nesta aba.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" role="listbox" aria-label={`Lista de ${activeTab === 'screen' ? 'telas' : 'janelas'}`}>
              {filtered.map((src) => {
                const selected = selectedId === src.id;
                return (
                  <button
                    key={src.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-label={`${src.name} ${selected ? 'selecionado' : ''}`}
                    onClick={() => setSelectedId(src.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(src.id);
                      }
                    }}
                    className={`group relative text-left rounded-xl border overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-all
                      ${selected ? 'border-blue-500 ring-2 ring-blue-500 bg-blue-500/10' : 'border-white/10 bg-zinc-900 hover:border-white/20 hover:bg-zinc-800'}`}
                  >
                    <div className="aspect-video bg-black relative overflow-hidden">
                      {src.thumbnailDataUrl ? (
                        <img src={src.thumbnailDataUrl} alt={`Miniatura de ${src.name}`} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-zinc-800 text-zinc-500">
                          {src.kind === 'screen' ? <Monitor className="w-8 h-8" aria-hidden /> : <AppWindow className="w-8 h-8" aria-hidden />}
                        </div>
                      )}
                      {src.appIconDataUrl && (
                        <img
                          src={src.appIconDataUrl}
                          alt=""
                          aria-hidden
                          className="absolute bottom-1 left-1 w-6 h-6 rounded bg-black/60 backdrop-blur-sm p-0.5 border border-white/10"
                        />
                      )}
                      {selected && (
                        <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center border border-white/20">
                          <Check className="w-3.5 h-3.5" aria-hidden />
                        </span>
                      )}
                    </div>
                    <div className="px-2.5 py-2">
                      <p className="text-xs font-medium text-white truncate" title={src.name}>
                        {src.name}
                      </p>
                      <p className="text-[11px] text-zinc-500 capitalize">{src.kind === 'screen' ? 'Tela' : 'Janela'}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Áudio + ações — fixo, não derruba call em erro */}
        <div className="border-t border-white/10 bg-zinc-900 px-4 sm:px-5 py-3 flex-shrink-0 space-y-3">
          <label className={`flex items-start gap-3 p-2.5 rounded-xl border ${supportsAudio ? 'bg-white/5 border-white/10 hover:bg-white/[0.07] cursor-pointer' : 'bg-zinc-800/50 border-white/5 opacity-60 cursor-not-allowed'}`}>
            <input
              type="checkbox"
              checked={withAudio}
              onChange={(e) => setWithAudio(e.target.checked)}
              disabled={!supportsAudio}
              aria-label="Compartilhar áudio do computador"
              className="mt-0.5 w-4 h-4 rounded border-white/20 bg-zinc-800 text-blue-600 focus:ring-blue-500 focus:ring-2"
            />
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium text-white">
                <Volume2 className="w-4 h-4 text-zinc-400" aria-hidden /> Compartilhar áudio do computador
              </span>
              <span className="block text-xs text-zinc-400 mt-0.5 leading-relaxed">
                {supportsAudio ? (
                  isElectron ? (
                    <>No Windows/Electron, o áudio do sistema pode incluir sons de outros aplicativos. Não é possível garantir isolamento apenas ao app selecionado.</>
                  ) : (
                    <>Quando disponível, o navegador compartilhará o áudio do sistema da fonte escolhida. O isolamento por aplicativo não é garantido.</>
                  )
                ) : (
                  <span className="text-amber-300 flex items-center gap-1">
                    <Info className="w-3 h-3" aria-hidden /> Áudio do sistema não suportado nesta plataforma/navegador.
                  </span>
                )}
              </span>
            </span>
          </label>

          {error && !isLoading && hasSources && (
            <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2" role="status">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden />
              <span>{error} — a chamada permanece ativa.</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={handleCancel} aria-label="Cancelar seleção">
              Cancelar
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!selectedId || isLoading}
              aria-label={selectedId ? `Compartilhar ${filtered.find((s) => s.id === selectedId)?.name ?? 'seleção'}` : 'Selecione uma fonte para compartilhar'}
              className="min-w-[140px] gap-2"
            >
              <Monitor className="w-4 h-4" aria-hidden /> Compartilhar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
