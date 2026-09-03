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