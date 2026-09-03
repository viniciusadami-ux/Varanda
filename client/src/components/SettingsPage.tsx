import { useEffect, useRef, useState } from 'react';
import { Mic, Volume2 } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { useAppStore } from '@/store/appStore';
import { useVoiceStore } from '@/store/voiceStore';
import type { UserStatus } from '@/types';

type Tab = 'account' | 'appearance' | 'audio' | 'connection';

interface SettingsPageProps {
  onClose: () => void;
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const token = useAppStore((s) => s.token);
  const serverUrl = useAppStore((s) => s.serverUrl);
  const serverPort = useAppStore((s) => s.serverPort);
  const setServerUrl = useAppStore((s) => s.setServerUrl);
  const setServerPort = useAppStore((s) => s.setServerPort);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const activeCallStream = useVoiceStore((s) => s.localStream);

  const [tab, setTab] = useState<Tab>('account');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [status, setStatus] = useState(user?.status ?? 'online');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [host, setHost] = useState(serverUrl);
  const [port, setPort] = useState(serverPort);
  const [micLevel, setMicLevel] = useState(0);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName ?? '');
    setStatus(user?.status ?? 'online');
  }, [user]);

  const save = async () => {
    if (!token) return;
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`http://${serverUrl}:${serverPort}/api/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName, status }),
      });
      if (user) {
        const updated = { ...user, displayName, status: status as typeof user.status };
        setUser(updated);
        localStorage.setItem('d2_user', JSON.stringify(updated));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      console.error('Failed to save:', e);
    } finally {
      setSaving(false);
    }
  };

  const saveConnection = () => {
    setServerUrl(host.trim() || 'localhost');
    setServerPort(port.trim() || '3000');
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const stopTest = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    setMicLevel(0);
    setTesting(false);
  };

  useEffect(() => () => stopTest(), []);

  const startMicTest = async () => {
    setTesting(true);
    try {
      const hasLiveCallMicrophone = activeCallStream?.getAudioTracks().some((track) => track.readyState === 'live');
      const stream: MediaStream = hasLiveCallMicrophone && activeCallStream
        ? activeCallStream
        : await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!hasLiveCallMicrophone) streamRef.current = stream;
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      console.error('Mic test error:', e);
      setTesting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background h-full overflow-hidden">
      <div className="h-14 px-4 sm:px-6 flex items-center justify-between border-b border-white/5 flex-shrink-0">
        <h2 id="settings-dialog-title" className="font-bold">Configurações</h2>
        <Button variant="ghost" onClick={onClose} aria-label="Fechar configurações">
          Fechar
        </Button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="w-52 sm:w-60 shrink-0 border-r border-white/5 p-2 space-y-1 bg-black/10">
          {(
            [
              ['account', 'Minha Conta'],
              ['appearance', 'Aparência & Tema'],
              ['audio', 'Voz & Vídeo (WebRTC)'],
              ['connection', 'Conexão do Servidor'],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`w-full text-left px-3 py-2 rounded-md ${
                tab === k ? 'bg-primary/20 text-primary' : 'hover:bg-white/5'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 space-y-6">
          {tab === 'account' && (
            <div className="max-w-xl space-y-4">
              <h3 className="font-bold text-lg">Minha Conta</h3>
              <p className="text-sm text-muted-foreground">
                Gerencie suas informações de perfil e status público.
              </p>
              <div>
                <label className="block text-sm mb-1">Nome de usuário</label>
                <Input value={user?.username ?? ''} disabled />
              </div>
              <div>
                <label className="block text-sm mb-1">Email</label>
                <Input value={user?.email ?? ''} disabled />
              </div>
              <div>
                <label className="block text-sm mb-1">Nome exibido</label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm mb-1">Status Online</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as UserStatus)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="online">Online</option>
                  <option value="idle">Ausente</option>
                  <option value="dnd">Não perturbe</option>
                  <option value="invisible">Invisível</option>
                  <option value="offline">Offline</option>
                </select>
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={save} disabled={saving}>
                  {saving ? 'Salvando...' : 'Salvar Alterações'}
                </Button>
                {saved && <span className="text-sm text-emerald-400">Salvo!</span>}
              </div>
            </div>
          )}

          {tab === 'appearance' && (
            <div className="max-w-xl space-y-4">
              <h3 className="font-bold text-lg">Aparência & Tema</h3>
              <p className="text-sm text-muted-foreground">
                Escolha entre tema claro, escuro ou seguir o sistema.
              </p>
              <div className="flex gap-2">
                {(['light', 'dark', 'system'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTheme(t)}
                    className={`px-4 py-2 rounded-md capitalize ${
                      theme === t ? 'bg-primary text-primary-foreground' : 'bg-white/5'
                    }`}
                  >
                    {t === 'dark' ? 'Tema escuro' : t === 'light' ? 'Tema Claro' : 'Sistema'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'audio' && (
            <div className="max-w-xl space-y-4">
              <h3 className="font-bold text-lg">Voz & Vídeo (WebRTC)</h3>
              <p className="text-sm text-muted-foreground">
                Configure e teste seu microfone e transmissão de voz ponto-a-ponto de baixa latência.
              </p>
              <div className="bg-white/5 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Mic className="w-4 h-4" />
                  <span className="text-sm">Testar Microfone</span>
                  {!testing ? (
                    <Button size="sm" onClick={startMicTest}>
                      Iniciar Teste
                    </Button>
                  ) : (
                    <Button size="sm" variant="destructive" onClick={stopTest}>
                      Parar Teste
                    </Button>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground flex justify-between">
                    <span>Nível do microfone</span>
                    <span>{micLevel}%</span>
                  </div>
                  <div className="h-2 bg-white/10 rounded overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${micLevel}%` }}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Fale no microfone para verificar se o áudio está sendo capturado corretamente.
                  {activeCallStream && ' A chamada em andamento usa este mesmo microfone.'}
                </p>
              </div>
              <div className="bg-white/5 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-3">
                  <Volume2 className="w-4 h-4" />
                  <span className="text-sm">Volume de saída</span>
                </div>
                <input type="range" min={0} max={100} defaultValue={80} className="w-full" />
              </div>
            </div>
          )}

          {tab === 'connection' && (
            <div className="max-w-xl space-y-4">
              <h3 className="font-bold text-lg">Conexão do Servidor</h3>
              <p className="text-sm text-muted-foreground">
                Defina o endereço IP ou host do servidor Discord 2 para jogar na rede local ou internet.
              </p>
              <div>
                <label className="block text-sm mb-1">Host</label>
                <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.10" />
              </div>
              <div>
                <label className="block text-sm mb-1">Porta</label>
                <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="3000" />
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={saveConnection}>Salvar Conexão</Button>
                {saved && <span className="text-sm text-emerald-400">Conexão Atualizada!</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
