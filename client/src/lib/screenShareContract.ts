/**
 * Contrato tipado para seleção de tela/janela e compartilhamento.
 * Desacoplado do núcleo WebRTC/Electron — o React apenas recebe fontes
 * e devolve a escolha; o núcleo cria o MediaStream.
 */

export type ScreenSourceKind = 'screen' | 'window';

export interface ScreenSource {
  /** Id opaco retornado pelo desktopCapturer (ex: screen:0:0, window:123:0) */
  id: string;
  /** Nome exibido (ex: "Tela 1", "Visual Studio Code") */
  name: string;
  /** Miniatura em dataURL (data:image/png;base64,...). Opcional no fallback. */
  thumbnailDataUrl?: string;
  /** Ícone do app em dataURL, quando disponível (janelas) */
  appIconDataUrl?: string | null;
  /** Tipo da fonte */
  kind: ScreenSourceKind;
  /** display_id quando for tela (opcional) */
  displayId?: string;
}

export interface ScreenShareSelection {
  sourceId: string;
  /** Áudio do computador solicitado */
  withAudio: boolean;
}

export interface ScreenShareCapabilities {
  isElectron: boolean;
  supportsSystemAudio: boolean;
  /** Motivo textual quando áudio não suportado (para UI) */
  audioUnavailableReason?: string;
}

export interface ScreenSharePickerResult {
  selection: ScreenShareSelection;
  // O stream será criado pelo núcleo; o picker não cria MediaStream
}

export type PickerTab = 'screen' | 'window';

// --- Helpers seguros (não expõem Electron diretamente) ---
function getElectronAPI(): any {
  try {
    return (window as any)?.electronAPI;
  } catch {
    return undefined;
  }
}

export function isElectronEnvironment(): boolean {
  try {
    const api = getElectronAPI();
    if (!api) return false;
    // preload atual não expõe isElectron, mas se expuser, respeita
    if (typeof api.isElectron === 'boolean') return api.isElectron;
    return true; // se api existe, assume Electron
  } catch {
    return false;
  }
}

export function getScreenShareCapabilities(): ScreenShareCapabilities {
  const isElectron = isElectronEnvironment();
  // No Electron/Windows o áudio do sistema está disponível mas é mistura do sistema
  // No navegador, a disponibilidade depende de getDisplayMedia com audio: true
  // Em plataformas sem suporte, desabilitamos e explicamos
  if (isElectron) {
    return {
      isElectron: true,
      supportsSystemAudio: true,
      audioUnavailableReason: undefined,
    };
  }
  // Browser: verifica se getDisplayMedia existe
  const hasGDM = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  if (!hasGDM) {
    return {
      isElectron: false,
      supportsSystemAudio: false,
      audioUnavailableReason: 'Seu navegador não suporta compartilhamento de tela',
    };
  }
  // Em browser, o áudio de sistema depende da escolha do usuário no picker nativo
  // Não garantimos isolamento por app — será áudio do sistema quando disponível
  return {
    isElectron: false,
    supportsSystemAudio: true,
    audioUnavailableReason: undefined,
  };
}

/**
 * Adaptador tipado para obter fontes.
 * Tenta Electron primeiro; se indisponível, retorna lista vazia e deixa o picker
 * cair no fallback nativo (sem inventar fontes falsas em produção).
 */
export async function fetchScreenSources(): Promise<{ sources: ScreenSource[]; isMock: boolean; error?: string }> {
  const isElectron = isElectronEnvironment();
  if (isElectron) {
    try {
      const api = getElectronAPI();
      // O núcleo futuro deve expor getScreenSources tipado
      const fetcher = (api?.getScreenSources ?? api?.getDesktopSources) as any;
      if (typeof fetcher === 'function') {
        // Tenta buscar telas + janelas
        let raw: any;
        try {
          raw = await fetcher({ types: ['screen', 'window'] });
        } catch {
          raw = await fetcher();
        }
        if (Array.isArray(raw) && raw.length > 0) {
          // Normaliza para ScreenSource
          const sources: ScreenSource[] = raw
            .map((s: any) => ({
              id: String(s.id ?? s.sourceId ?? ''),
              name: String(s.name ?? s.label ?? 'Fonte desconhecida'),
              thumbnailDataUrl: s.thumbnailDataUrl ?? s.thumbnail?.toDataURL?.() ?? s.preview ?? undefined,
              appIconDataUrl: s.appIconDataUrl ?? s.appIcon ?? null,
              kind: ((s.kind === 'window' || /window/i.test(s.id ?? '')) ? 'window' : 'screen') as ScreenSourceKind,
              displayId: s.display_id ?? s.displayId,
            }))
            .filter((s) => !!s.id);
          return { sources, isMock: false };
        }
        // Se API existe mas retornou vazio, trata como vazio (não mock)
        return { sources: [], isMock: false };
      }
      // Electron sem API específica: não inventa fontes, deixa o chamador usar fallback nativo via getDisplayMedia
      return { sources: [], isMock: false, error: 'Núcleo de captura ainda não expôs fontes. Usando seletor nativo.' };
    } catch (e) {
      return { sources: [], isMock: false, error: (e as Error)?.message ?? 'Falha ao listar fontes' };
    }
  }
  // Navegador: sem lista prévia — o seletor nativo do browser será usado
  return { sources: [], isMock: false };
}

/**
 * Cria stream a partir da seleção.
 * No Electron, o núcleo deve implementar window.electronAPI.createScreenStream
 * ou usar desktopCapturer + getUserMedia com chromeMediaSourceId.
 * No navegador, usa getDisplayMedia nativo (fallback).
 * Esta função é um adaptador de conveniência; o VoicePanel pode optar
 * por delegar ao núcleo em vez de chamar diretamente.
 */
export async function createScreenStreamFromSelection(selection: ScreenShareSelection): Promise<MediaStream> {
  const isElectron = isElectronEnvironment();
  const api = getElectronAPI();
  if (isElectron && typeof api?.createScreenStream === 'function') {
    return api.createScreenStream(selection);
  }
  // Fallback nativo — ignora sourceId específico (o browser mostra seu próprio picker)
  // Em Electron com desktopCapturer mas sem createScreenStream, tenta getDisplayMedia com sourceId
  if (isElectron && selection.sourceId) {
    try {
      // Tenta via getUserMedia com chromeMediaSourceId (Electron)
      const stream = await (navigator.mediaDevices as any).getUserMedia({
        audio: selection.withAudio ? { mandatory: { chromeMediaSource: 'desktop' } } : false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: selection.sourceId,
          },
        },
      });
      return stream as MediaStream;
    } catch {
      // fallback para getDisplayMedia
    }
  }
  // Navegador: getDisplayMedia nativo (o sourceId será ignorado, mas mantemos contrato)
  const constraints: DisplayMediaStreamOptions = {
    video: { frameRate: { ideal: 30, max: 30 } } as any,
    audio: selection.withAudio,
  };
  return navigator.mediaDevices.getDisplayMedia(constraints);
}
