import { useState } from 'react';
import { Globe, Plug, TestTube2, ArrowLeft, Wifi } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { useAppStore } from '@/store/appStore';
import { api } from '@/lib/api';
import { resolveServerBaseUrl } from '@/lib/serverUrl';

type Mode = 'select' | 'host' | 'connect';

interface Props {
  onLogin: () => void;
  onRegister: () => void;
}

export function ConnectionScreen({ onLogin, onRegister }: Props) {
  const setServerConnection = useAppStore((s) => s.setServerConnection);
  const [mode, setMode] = useState<Mode>('select');
  const [serverInfo, setServerInfo] = useState<{
    ip: string;
    port: string;
    code: string;
    status: string;
  } | null>(null);
  const [host, setHost] = useState(() => localStorage.getItem('d2_server_url') ?? 'localhost');
  const [port, setPort] = useState(() => localStorage.getItem('d2_server_port') ?? '3000');
  const [code, setCode] = useState(() => localStorage.getItem('d2_code') ?? '');
  const [error, setError] = useState<string | null>(null);

  const startHosting = async () => {
    setError(null);
    try {
      if (window.electronAPI) {
        const info = await window.electronAPI.startServer();
        setServerInfo({ ip: info.ip, port: String(info.port), code: info.code, status: info.status });
        setServerConnection(info.ip, String(info.port), info.code);
      } else {
        const info = { ip: 'localhost', port: '3000', code: 'MG2026', status: 'online' };
        setServerInfo(info);
        setServerConnection(info.ip, info.port, info.code);
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+':\s*/i, '') : '';
      setError(detail ? `Falha ao iniciar o servidor local: ${detail}` : 'Falha ao iniciar o servidor local.');
    }
  };

  const stopHosting = async () => {
    if (window.electronAPI) await window.electronAPI.stopServer();
    setServerInfo(null);
  };

  const proceedLocal = () => {
    setServerConnection('localhost', '3000', '');
    onLogin();
  };

  const proceedConnect = () => {
    const cleanHost = host.trim();
    const cleanPort = port.trim() || '3000';
    if (!cleanHost) {
      setError('Informe o endereço do servidor.');
      return;
    }
    if (!/^\d{1,5}$/.test(cleanPort) || Number(cleanPort) > 65535) {
      setError('Informe uma porta válida.');
      return;
    }
    setError(null);
    setServerConnection(cleanHost, cleanPort, code.trim());
    onLogin();
  };

  const testConnection = async () => {
    const cleanHost = host.trim();
    const cleanPort = port.trim() || '3000';
    if (!cleanHost || !/^\d{1,5}$/.test(cleanPort) || Number(cleanPort) > 65535) {
      setError('Informe um endereço e uma porta válidos.');
      return;
    }
    setError(null);
    try {
      const baseURL = resolveServerBaseUrl(cleanHost, cleanPort);
      const response = await api.get('/health', { baseURL, timeout: 8_000 });
      if (response.data?.status !== 'ok') throw new Error('invalid health response');
      setError('Conexão confirmada. Você já pode entrar ou criar uma conta.');
    } catch {
      setError('Não foi possível alcançar esse servidor. Confira o endereço, a porta e se ele está online.');
    }
  };

  if (mode === 'host') {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-6">
        <div className="w-full max-w-md bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 p-8 animate-scale-in">
          <div className="flex items-center gap-3 mb-6">
            <button
              type="button"
              onClick={() => setMode('select')}
              className="text-white/60 hover:text-white transition-colors"
              aria-label="Voltar"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="text-white text-xl font-semibold">Hospedar Servidor</h2>
          </div>

          {!serverInfo ? (
            <div className="space-y-4">
              <p className="text-white/80 text-sm">
                Inicie seu próprio servidor Discord 2 para seus amigos se conectarem.
              </p>
            <Button
              onClick={startHosting}
              className="w-full"
            >
              <Wifi className="w-4 h-4 mr-2" />
              Iniciar Servidor
            </Button>
              {error && <p role="alert" className="text-red-300 text-sm">{error}</p>}
            </div>
          ) : (
            <div className="space-y-4 animate-fade-in">
              <div className="rounded-lg bg-black/20 border border-white/10 p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-white/60 text-sm">IP do Servidor</span>
                  <span className="text-white font-mono">{serverInfo.ip}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60 text-sm">Porta</span>
                  <span className="text-white font-mono">{serverInfo.port}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60 text-sm">Código</span>
                  <span className="text-white font-mono font-semibold tracking-widest">
                    {serverInfo.code}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60 text-sm">Status</span>
                  <span className="text-emerald-400 text-sm capitalize">
                    {serverInfo.status}
                  </span>
                </div>
              </div>
              <p className="text-white/60 text-xs">
                Envie esse código para seus amigos entrarem no seu servidor!
              </p>
              <div className="flex gap-2">
                <Button onClick={() => { setServerConnection(serverInfo.ip, serverInfo.port, serverInfo.code); onLogin(); }} className="flex-1">
                  Continuar
                </Button>
                <Button variant="ghost" onClick={stopHosting} className="text-white">
                  Encerrar
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'connect') {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-6">
        <div className="w-full max-w-md bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 p-8 animate-scale-in">
          <div className="flex items-center gap-3 mb-6">
            <button
              type="button"
              onClick={() => setMode('select')}
              className="text-white/60 hover:text-white transition-colors"
              aria-label="Voltar"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="text-white text-xl font-semibold">Conectar ao Servidor</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="connection-host" className="block text-white/80 text-sm mb-1">IP do Servidor</label>
              <Input
                id="connection-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.10"
                className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
              />
            </div>
            <div>
              <label htmlFor="connection-port" className="block text-white/80 text-sm mb-1">Porta</label>
              <Input
                id="connection-port"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="3000"
                className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
              />
            </div>
            <div>
              <label htmlFor="connection-code" className="block text-white/80 text-sm mb-1">
                Código de Conexão (opcional)
              </label>
              <Input
                id="connection-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABCD12"
                className="bg-white/10 border-white/20 text-white placeholder:text-white/40 uppercase tracking-widest"
              />
            </div>
            <Button onClick={proceedConnect} className="w-full">
              Conectar
            </Button>
            <Button type="button" variant="ghost" onClick={testConnection} className="w-full text-white">
              Testar conexão
            </Button>
            {error && (
              <p
                role={error.startsWith('Conexão confirmada') ? 'status' : 'alert'}
                className={error.startsWith('Conexão confirmada') ? 'text-emerald-300 text-sm' : 'text-red-200 text-sm'}
              >
                {error}
              </p>
            )}
            <p className="text-white/60 text-xs">
              Use um domínio HTTPS para conexões pela internet. O código de conexão é apenas informativo nesta versão.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-6">
      <div className="text-center mb-12 animate-fade-in">
        <h1 className="text-6xl font-bold text-white mb-4 tracking-tight">Discord 2</h1>
        <p className="text-white/80 text-lg">Seu espaço privado para conversar com amigos</p>
      </div>

      <div className="grid grid-cols-2 gap-6 max-w-xl w-full px-6 animate-slide-up">
        <button
          type="button"
          onClick={() => setMode('host')}
          className="group flex flex-col items-center p-8 bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 hover:bg-white/20 transition-all hover:scale-105"
        >
          <Globe className="w-12 h-12 text-white mb-4 group-hover:scale-110 transition-transform" />
          <h3 className="text-white font-semibold text-xl mb-2">Hospedar</h3>
          <p className="text-white/60 text-sm text-center">
            Inicie seu próprio servidor para seus amigos
          </p>
        </button>

        <button
          type="button"
          onClick={() => setMode('connect')}
          className="group flex flex-col items-center p-8 bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 hover:bg-white/20 transition-all hover:scale-105"
        >
          <Plug className="w-12 h-12 text-white mb-4 group-hover:scale-110 transition-transform" />
          <h3 className="text-white font-semibold text-xl mb-2">Conectar</h3>
          <p className="text-white/60 text-sm text-center">
            Entre no servidor de um amigo
          </p>
        </button>
      </div>

      <button
        type="button"
        onClick={proceedLocal}
        className="mt-8 flex items-center gap-2 text-white/60 hover:text-white transition-colors text-sm"
      >
        <TestTube2 className="w-4 h-4" />
        Testar localmente (localhost)
      </button>

      <div className="mt-8 flex items-center gap-4 text-sm text-white/80">
        <span>Já tem conta?</span>
        <button
          type="button"
          onClick={onLogin}
          className="font-semibold text-white hover:underline"
        >
          Entrar
        </button>
        <span className="text-white/40">•</span>
        <span>Não tem conta?</span>
        <button
          type="button"
          onClick={onRegister}
          className="font-semibold text-white hover:underline"
        >
          Criar conta
        </button>
      </div>
    </div>
  );
}
