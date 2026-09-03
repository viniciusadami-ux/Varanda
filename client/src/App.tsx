import { useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { ConnectionScreen } from '@/screens/ConnectionScreen';
import { LoginScreen } from '@/screens/LoginScreen';
import { RegisterScreen } from '@/screens/RegisterScreen';
import { AppShell } from '@/screens/AppShell';

export default function App() {
  const screen = useAppStore((s) => s.screen);
  const darkMode = useAppStore((s) => s.darkMode);
  const initialize = useAppStore((s) => s.initialize);
  const setScreen = useAppStore((s) => s.setScreen);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    const html = document.documentElement;
    if (darkMode) html.classList.add('dark');
    else html.classList.remove('dark');
  }, [darkMode]);

  if (screen === 'loading') {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Validando sessão…</p>
        </div>
      </div>
    );
  }
  if (screen === 'connection') {
    return (
      <ConnectionScreen
        onLogin={() => setScreen('login')}
        onRegister={() => setScreen('register')}
      />
    );
  }
  if (screen === 'login') {
    return (
      <LoginScreen
        onBack={() => setScreen('connection')}
        onRegister={() => setScreen('register')}
      />
    );
  }
  if (screen === 'register') {
    return (
      <RegisterScreen
        onBack={() => setScreen('connection')}
        onLogin={() => setScreen('login')}
      />
    );
  }
  return <AppShell />;
}