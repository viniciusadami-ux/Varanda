import { useEffect, useRef, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { useServerStore } from '@/store/serverStore';
import { useSocketBridge } from '@/hooks/useSocketBridge';
import {
  ChannelSidebar,
  FriendsSidebar,
  ServerRail,
} from '@/components/Sidebar';
import { ChatPanel } from '@/components/ChatPanel';
import { VoicePanel } from '@/components/VoicePanel';
import { VoiceRuntime } from '@/components/VoiceRuntime';
import { VoiceMiniPanel } from '@/components/VoiceMiniPanel';
import { SettingsPage } from '@/components/SettingsPage';
import { ProfileModal, CreateServerModal } from '@/components/Modals';
import { serversApi } from '@/lib/api';

export function AppShell() {
  useSocketBridge();
  const token = useAppStore((s) => s.token);
  const serverUrl = useAppStore((s) => s.serverUrl);
  const serverPort = useAppStore((s) => s.serverPort);
  const activePanel = useAppStore((s) => s.activePanel);
  const showProfile = useAppStore((s) => s.showProfile);
  const showCreateServer = useAppStore((s) => s.showCreateServer);
  const currentServer = useServerStore((s) => s.currentServer);
  const currentChannelId = useServerStore((s) => s.currentChannelId);
  const channels = useServerStore((s) => s.channels);
  const dmUser = useAppStore((s) => s.currentDmUser);
  const inVoiceChannel = useAppStore((s) => s.inVoiceChannel);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsDialogRef = useRef<HTMLDivElement>(null);
  const wasSettingsOpenRef = useRef(false);

  const setServers = useServerStore((s) => s.setServers);

  useEffect(() => {
    if (!token) return;
    serversApi
      .list()
      .then(setServers)
      .catch(console.error);
  }, [token, serverUrl, serverPort, setServers]);

  useEffect(() => {
    if (!token || !currentServer) return;
    void serversApi.detail(currentServer.id).catch(console.error);
  }, [token, currentServer?.id, serverUrl, serverPort]);

  const currentChannel = channels.find((c) => c.id === currentChannelId);
  const showFriends = activePanel === 'friends' && !dmUser;
  const inVoice = currentChannel?.type === 'voice' && inVoiceChannel?.id === currentChannel.id;
  const openSettings = () => setSettingsOpen(true);
  const closeSettings = () => setSettingsOpen(false);

  useEffect(() => {
    if (!settingsOpen) {
      if (wasSettingsOpenRef.current) settingsTriggerRef.current?.focus();
      wasSettingsOpenRef.current = false;
      return;
    }
    wasSettingsOpenRef.current = true;
    const frame = requestAnimationFrame(() => settingsDialogRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [settingsOpen]);

  const trapSettingsFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = settingsDialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable?.length) return;
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

  return (
    <div className="relative h-full w-full flex bg-background text-foreground overflow-hidden">
      <div className="flex">
        <ServerRail />
        <div className="relative">
          {activePanel === 'friends' || !currentServer ? (
            <FriendsSidebar />
          ) : (
            <ChannelSidebar />
          )}
          <button
            ref={settingsTriggerRef}
            type="button"
            onClick={openSettings}
            className="absolute bottom-16 right-2 z-10 p-1.5 rounded-full bg-card border border-border text-muted-foreground hover:text-foreground shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            title="Configurações"
            aria-label="Abrir configurações"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {showFriends ? (
          <FriendsFullView />
        ) : inVoice ? (
          <VoicePanel onOpenSettings={openSettings} />
        ) : (
          <ChatPanel />
        )}
      </div>

      {settingsOpen && (
        <div
          className="absolute inset-0 z-40 flex justify-end bg-black/55 p-2 backdrop-blur-sm sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSettings();
          }}
        >
          <div
            ref={settingsDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-dialog-title"
            onKeyDown={trapSettingsFocus}
            className="h-full w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-background shadow-2xl shadow-black/50"
          >
            <SettingsPage onClose={closeSettings} />
          </div>
        </div>
      )}

      <VoiceRuntime playVoiceAudio={!inVoice} />
      {!inVoice && <VoiceMiniPanel />}
      {showProfile && <ProfileModal />}
      {showCreateServer && <CreateServerModal />}
    </div>
  );
}

function FriendsFullView() {
  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground p-8 text-center">
      <div>
        <h2 className="text-xl font-semibold mb-2">Amigos</h2>
        <p>Selecione um amigo na barra lateral para iniciar uma conversa.</p>
      </div>
    </div>
  );
}
