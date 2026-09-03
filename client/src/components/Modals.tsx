import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { serversApi } from '@/lib/api';
import { useAppStore } from '@/store/appStore';
import { useServerStore } from '@/store/serverStore';

export function ProfileModal() {
  const show = useAppStore((s) => s.showProfile);
  const setShow = useAppStore((s) => s.setShowProfile);
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const token = useAppStore((s) => s.token);
  const serverUrl = useAppStore((s) => s.serverUrl);
  const serverPort = useAppStore((s) => s.serverPort);

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [status, setStatus] = useState<string>(user?.status ?? 'online');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setStatus(user.status);
    }
  }, [user, show]);

  if (!show) return null;

  const save = async () => {
    if (!token) return;
    setSaving(true);
    setFeedback(null);
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
      setFeedback('Salvo!');
      setTimeout(() => setShow(false), 600);
    } catch (e) {
      console.error(e);
      setFeedback('Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const statusOptions = [
    { value: 'online', label: 'Online', color: 'bg-green-500' },
    { value: 'idle', label: 'Ausente', color: 'bg-yellow-500' },
    { value: 'dnd', label: 'Não perturbe', color: 'bg-red-500' },
    { value: 'invisible', label: 'Invisível', color: 'bg-gray-500' },
    { value: 'offline', label: 'Offline', color: 'bg-gray-500' },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Perfil</h2>
          <button
            type="button"
            onClick={() => setShow(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
            {user?.avatar ? (
              <img src={user.avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl font-bold">
                {(user?.displayName || user?.username)?.[0]?.toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <p className="font-semibold">{user?.displayName || user?.username}</p>
            <p className="text-xs text-muted-foreground">@{user?.username}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Nome exibido</label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm mb-1">Status</label>
            <div className="space-y-1">
              {statusOptions.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStatus(s.value)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
                    status === s.value ? 'bg-primary/20 text-primary' : 'hover:bg-white/5'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${s.color}`} />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </div>
          {feedback && <p className="text-sm text-emerald-400">{feedback}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => setShow(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CreateServerModal() {
  const show = useAppStore((s) => s.showCreateServer);
  const setShow = useAppStore((s) => s.setShowCreateServer);
  const token = useAppStore((s) => s.token);
  const addServer = useServerStore((s) => s.addServer);
  const setCurrentServer = useServerStore((s) => s.setCurrentServer);
  const setChannels = useServerStore((s) => s.setChannels);
  const setActivePanel = useAppStore((s) => s.setActivePanel);

  const [mode, setMode] = useState<'select' | 'create' | 'join'>('select');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!show) return null;

  const create = async () => {
    if (!name.trim() || !token) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await serversApi.create({ name: name.trim() });
      const server = await serversApi.detail(res.id);
      addServer({
        id: server.id,
        name: server.name,
        icon: server.icon,
        owner_id: server.owner_id,
        invite_code: server.invite_code,
      });
      setCurrentServer(server);
      setChannels(server.channels || []);
      setActivePanel('chat');
      setShow(false);
    } catch (err: any) {
      setFeedback(err?.response?.data?.error ?? err?.message ?? 'Erro ao criar servidor.');
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (!code.trim() || !token) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await serversApi.join({ code: code.trim().toUpperCase() });
      const server = res.server;
      addServer(server);
      const detail = await serversApi.detail(server.id);
      setCurrentServer(detail);
      setChannels(detail.channels || []);
      setActivePanel('chat');
      setShow(false);
    } catch (err: any) {
      setFeedback(err?.response?.data?.error ?? err?.message ?? 'Código de convite inválido.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">
            {mode === 'create'
              ? 'Criar um servidor'
              : mode === 'join'
              ? 'Entrar em um servidor'
              : 'Adicionar Servidor'}
          </h2>
          <button
            type="button"
            onClick={() => setShow(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {mode === 'select' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Crie seu próprio servidor ou entre em um existente com um código de convite.
            </p>
            <button
              type="button"
              onClick={() => setMode('create')}
              className="w-full p-4 bg-white/5 hover:bg-white/10 rounded-lg text-left"
            >
              <h3 className="font-semibold">Criar um servidor</h3>
              <p className="text-xs text-muted-foreground">Comece do zero e personalize</p>
            </button>
            <button
              type="button"
              onClick={() => setMode('join')}
              className="w-full p-4 bg-white/5 hover:bg-white/10 rounded-lg text-left"
            >
              <h3 className="font-semibold">Entrar em um servidor</h3>
              <p className="text-xs text-muted-foreground">Use um código de convite</p>
            </button>
          </div>
        )}

        {mode === 'create' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Os novos servidores começam com canais de texto e voz padrão.
            </p>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do servidor"
            />
            {feedback && <p className="text-sm text-red-400">{feedback}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setMode('select')}>
                Voltar
              </Button>
              <Button onClick={create} disabled={busy || !name.trim()}>
                {busy ? 'Criando...' : 'Criar'}
              </Button>
            </div>
          </div>
        )}

        {mode === 'join' && (
          <div className="space-y-3">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Código de Convite"
              className="uppercase tracking-widest"
            />
            {feedback && <p className="text-sm text-red-400">{feedback}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setMode('select')}>
                Voltar
              </Button>
              <Button onClick={join} disabled={busy || !code.trim()}>
                {busy ? 'Entrando...' : 'Entrar'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
