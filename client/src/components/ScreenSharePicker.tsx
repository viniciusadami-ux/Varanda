import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Check, LoaderCircle, Monitor, RefreshCw, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { listShareSources, startScreenShare } from '@/lib/voiceSession';
import type { ShareSource, ShareSourceSelection } from '@/types/screenShare';

interface ScreenSharePickerProps {
  open: boolean;
  pending: boolean;
  shareError: string | null;
  onClose: () => void;
  onStarted: () => void;
}

export function ScreenSharePicker({
  open,
  pending,
  shareError,
  onClose,
  onStarted,
}: ScreenSharePickerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [sources, setSources] = useState<ShareSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [includeAudio, setIncludeAudio] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setIncludeAudio(false);
    setSelectedSourceId(null);
    setLocalError(null);
    const frame = requestAnimationFrame(() => dialogRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLocalError(null);
    void listShareSources()
      .then((nextSources) => {
        if (cancelled) return;
        setSources(nextSources);
        setSelectedSourceId((current) => {
          if (current && nextSources.some((source) => source.id === current)) return current;
          return nextSources[0]?.id ?? null;
        });
        if (nextSources.length === 0) {
          setLocalError('Nenhuma tela ou janela disponível para compartilhar.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, refreshToken]);

  const groupedSources = useMemo(
    () => ({
      screen: sources.filter((source) => source.kind === 'screen'),
      window: sources.filter((source) => source.kind === 'window'),
    }),
    [sources]
  );

  if (!open) return null;

  const close = () => {
    if (!pending) onClose();
  };

  const submit = async () => {
    if (!selectedSourceId || pending) return;
    const selection: ShareSourceSelection = { sourceId: selectedSourceId, includeAudio };
    setLocalError(null);
    if (await startScreenShare(selection)) onStarted();
    else setLocalError('Não foi possível iniciar. Atualize as fontes e tente novamente.');
  };

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, a') ?? []
    ).filter((element) => !element.hasAttribute('disabled') && element.tabIndex >= 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const visibleError = shareError || localError;

  return (
    <div
      className='fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-3 backdrop-blur-md sm:p-6'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role='dialog'
        aria-modal='true'
        aria-labelledby='screen-share-title'
        aria-describedby='screen-share-description'
        onKeyDown={trapFocus}
        className='flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111218] shadow-2xl shadow-black/60 outline-none animate-scale-in'
      >
        <header className='flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6'>
          <div className='min-w-0'>
            <div className='mb-1 flex items-center gap-2 text-indigo-300'>
              <Monitor className='h-5 w-5' />
              <span className='text-xs font-bold uppercase tracking-[0.18em]'>Apresentação</span>
            </div>
            <h2 id='screen-share-title' className='text-xl font-bold text-white sm:text-2xl'>
              O que você quer compartilhar?
            </h2>
            <p id='screen-share-description' className='mt-1 text-sm text-zinc-400'>
              Escolha uma tela inteira ou uma janela aberta.
            </p>
          </div>
          <button
            type='button'
            onClick={close}
            disabled={pending}
            className='rounded-full p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50'
            aria-label='Fechar seletor de compartilhamento'
          >
            <X className='h-5 w-5' />
          </button>
        </header>

        <div className='scrollbar-thin flex-1 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5'>
          <div className='mb-4 flex items-center justify-between gap-3'>
            <p className='text-sm font-medium text-zinc-300'>
              {loading ? 'Buscando fontes disponíveis…' : (
                <>
                  {sources.length} {sources.length === 1 ? 'fonte disponível' : 'fontes disponíveis'}
                </>
              )}
            </p>
            <button
              type='button'
              onClick={() => setRefreshToken((value) => value + 1)}
              disabled={loading || pending}
              className='inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50'
            >
              <RefreshCw className={clsx('h-4 w-4', loading && 'animate-spin')} />
              Atualizar
            </button>
          </div>

          {loading && sources.length === 0 ? (
            <div className='flex min-h-72 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/10 bg-black/20 text-zinc-400'>
              <LoaderCircle className='h-8 w-8 animate-spin text-indigo-300' />
              <span className='text-sm'>Carregando telas e janelas…</span>
            </div>
          ) : (
            <div className='space-y-6'>
              <SourceGroup
                id='share-source-screens'
                title='Telas'
                sources={groupedSources.screen}
                selectedSourceId={selectedSourceId}
                onSelect={setSelectedSourceId}
              />
              <SourceGroup
                id='share-source-windows'
                title='Janelas'
                sources={groupedSources.window}
                selectedSourceId={selectedSourceId}
                onSelect={setSelectedSourceId}
              />
            </div>
          )}

          {visibleError && (
            <div role='alert' className='mt-4 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100'>
              {visibleError}
            </div>
          )}
        </div>

        <footer className='border-t border-white/10 bg-black/20 px-5 py-4 sm:px-6'>
          <button
            type='button'
            role='switch'
            aria-checked={includeAudio}
            onClick={() => setIncludeAudio((value) => !value)}
            disabled={pending}
            className='mb-4 flex w-full items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.035] p-3 text-left transition hover:border-white/20 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-60 sm:p-4'
          >
            <span className='flex min-w-0 items-center gap-3'>
              <span className={clsx('rounded-lg p-2', includeAudio ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/5 text-zinc-400')}>
                {includeAudio ? <Volume2 className='h-5 w-5' /> : <VolumeX className='h-5 w-5' />}
              </span>
              <span>
                <span className='block text-sm font-semibold text-white'>Compartilhar áudio do sistema</span>
                <span className='mt-0.5 block text-xs leading-relaxed text-zinc-400'>
                  Inclui navegador, Spotify, jogos e outros aplicativos no Windows. O áudio não é isolado por aplicativo.
                </span>
              </span>
            </span>
            <span className={clsx('relative h-6 w-11 flex-none rounded-full transition-colors', includeAudio ? 'bg-indigo-500' : 'bg-zinc-700')}>
              <span className={clsx('absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform', includeAudio ? 'translate-x-6' : 'translate-x-1')} />
            </span>
          </button>

          <div className='flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'>
            <Button type='button' variant='ghost' onClick={close} disabled={pending}>
              Cancelar
            </Button>
            <Button
              type='button'
              onClick={() => void submit()}
              disabled={!selectedSourceId || pending || loading}
              className='min-w-36 gap-2'
            >
              {pending ? (
                <>
                  <LoaderCircle className='h-4 w-4 animate-spin' />
                  Iniciando…
                </>
              ) : (
                <>
                  <Monitor className='h-4 w-4' />
                  Compartilhar
                </>
              )}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

interface SourceGroupProps {
  id: string;
  title: string;
  sources: ShareSource[];
  selectedSourceId: string | null;
  onSelect: (sourceId: string) => void;
}

function SourceGroup({ id, title, sources, selectedSourceId, onSelect }: SourceGroupProps) {
  if (sources.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className='mb-2 text-xs font-bold uppercase tracking-[0.16em] text-zinc-500'>
        {title}
      </h3>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {sources.map((source) => {
          const selected = source.id === selectedSourceId;
          return (
            <button
              key={source.id}
              type='button'
              aria-pressed={selected}
              onClick={() => onSelect(source.id)}
              className={clsx(
                'group overflow-hidden rounded-xl border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
                selected
                  ? 'border-indigo-400 bg-indigo-500/10 shadow-lg shadow-indigo-500/10'
                  : 'border-white/10 bg-white/[0.035] hover:border-white/25 hover:bg-white/[0.06]'
              )}
            >
              <span className='relative flex aspect-video items-center justify-center overflow-hidden bg-black/60'>
                {source.thumbnailDataUrl ? (
                  <img src={source.thumbnailDataUrl} alt='' className='h-full w-full object-contain transition duration-200 group-hover:scale-[1.015]' />
                ) : (
                  <Monitor className='h-10 w-10 text-zinc-600' />
                )}
                <span className={clsx(
                  'absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border transition',
                  selected ? 'border-indigo-300 bg-indigo-500 text-white' : 'border-white/20 bg-black/60 text-transparent'
                )}>
                  <Check className='h-4 w-4' />
                </span>
              </span>
              <span className='flex min-w-0 items-center gap-2 px-3 py-2.5'>
                {source.appIconDataUrl ? (
                  <img src={source.appIconDataUrl} alt='' className='h-5 w-5 flex-none rounded object-contain' />
                ) : (
                  <Monitor className='h-4 w-4 flex-none text-zinc-500' />
                )}
                <span className='min-w-0 truncate text-sm font-medium text-zinc-200' title={source.name}>
                  {source.name}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
