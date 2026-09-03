import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { authApi } from '@/lib/api';
import { useAppStore } from '@/store/appStore';

interface Props {
  onBack: () => void;
  onRegister: () => void;
}

export function LoginScreen({ onBack, onRegister }: Props) {
  const setAuth = useAppStore((s) => s.setAuth);
  const setScreen = useAppStore((s) => s.setScreen);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await authApi.login({ email: email.trim(), password });
      setAuth(res.token, res.user);
      setScreen('app');
    } catch (err: any) {
      const message =
        err?.response?.data?.error ?? err?.message ?? 'Não foi possível entrar.';
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
          <h2 className="text-white text-2xl font-semibold">Bem-vindo de volta!</h2>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-white/80 text-sm mb-1">Email</label>
            <Input
              id="login-email"
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
            <label htmlFor="login-password" className="block text-white/80 text-sm mb-1">Sua senha</label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 10 caracteres"
              required
              minLength={10}
              className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
            />
          </div>
          {error && <p role="alert" className="text-red-300 text-sm">{error}</p>}
          <Button
            type="submit"
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </Button>
        </form>

        <p className="text-white/70 text-sm mt-6 text-center">
          Não tem conta?{' '}
          <button
            type="button"
            onClick={onRegister}
            className="font-semibold text-white hover:underline"
          >
            Criar conta
          </button>
        </p>
      </div>
    </div>
  );
}
