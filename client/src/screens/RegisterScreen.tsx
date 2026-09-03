import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { authApi } from '@/lib/api';
import { useAppStore } from '@/store/appStore';

interface Props {
  onBack: () => void;
  onLogin: () => void;
}

export function RegisterScreen({ onBack, onLogin }: Props) {
  const setAuth = useAppStore((s) => s.setAuth);
  const setScreen = useAppStore((s) => s.setScreen);
  const setActivePanel = useAppStore((s) => s.setActivePanel);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.register({
        username: username.trim(),
        displayName: displayName.trim() || username.trim(),
        email: email.trim(),
        password,
      });
      setAuth(res.token, res.user);
      setActivePanel('home');
      setScreen('app');
    } catch (err: any) {
      const message =
        err?.response?.data?.error ?? err?.message ?? 'Não foi possível criar a conta.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-6">
      <div className="w-full max-w-md bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 p-8 animate-scale-in">
        <div className="flex items-center gap-3 mb-6">
          <button
            type="button"
            onClick={onBack}
            className="text-white/60 hover:text-white transition-colors"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-white text-2xl font-semibold">Bem-vindo ao Discord 2!</h2>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="register-username" className="block text-white/80 text-sm mb-1">Nome de usuário</label>
            <Input
              id="register-username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Digite o nome de usuário (ex: zequinha)"
              required
              minLength={3}
              className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
            />
          </div>
          <div>
            <label htmlFor="register-display-name" className="block text-white/80 text-sm mb-1">Nome exibido</label>
            <Input
              id="register-display-name"
              autoComplete="nickname"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="(opcional)"
              className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
            />
          </div>
          <div>
            <label htmlFor="register-email" className="block text-white/80 text-sm mb-1">Email</label>
            <Input
              id="register-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
              className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
            />
          </div>
          <div>
            <label htmlFor="register-password" className="block text-white/80 text-sm mb-1">Senha</label>
            <Input
              id="register-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 10 caracteres"
              required
              minLength={10}
              className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
            />
          </div>
          <div>
            <label htmlFor="register-password-confirm" className="block text-white/80 text-sm mb-1">Repita a senha</label>
            <Input
              id="register-password-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirme sua senha"
              required
              minLength={10}
              className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
            />
          </div>
          {error && <p role="alert" className="text-red-300 text-sm">{error}</p>}
          <Button
            type="submit"
            disabled={loading}
            className="w-full mt-2"
          >
            {loading ? 'Criando conta...' : 'Criar conta'}
          </Button>
        </form>

        <p className="text-white/70 text-sm mt-6 text-center">
          Já tem conta?{' '}
          <button
            type="button"
            onClick={onLogin}
            className="font-semibold text-white hover:underline"
          >
            Entrar
          </button>
        </p>
      </div>
    </div>
  );
}
