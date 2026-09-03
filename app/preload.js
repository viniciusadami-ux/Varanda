const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startServer: () => ipcRenderer.invoke('start-server'),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getLocalIP: () => ipcRenderer.invoke('get-local-ip'),
  getInviteCode: () => ipcRenderer.invoke('get-invite-code'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  listShareSources: () => ipcRenderer.invoke('list-share-sources'),
  selectShareSource: (selection) => ipcRenderer.invoke('select-share-source', selection),
  clearShareSelection: () => ipcRenderer.invoke('clear-share-selection'),
});
