const { app, BrowserWindow, ipcMain, dialog, shell, desktopCapturer, session } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');

// Each development instance can receive a separate profile from scripts/dev.cjs.
// Without this, two Electron windows share localStorage (including d2_token),
// and a reconnect can authenticate one window as the other account.
const requestedProfile = process.env.VARANDA_PROFILE?.trim();
if (requestedProfile) {
  const safeProfile = requestedProfile.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  if (safeProfile) {
    app.setPath('userData', path.join(app.getPath('userData'), 'profiles', safeProfile));
  }
}

function generateInviteCode() {
  // 6-char uppercase alphanumeric, easy to read aloud, hard to brute force (36^6 = 2.1B).
  return crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}

let mainWindow;
let serverProcess;
let isServerRunning = false;
let serverReadyPromise;
let rejectServerReady;
let serverRestartTimer;
let serverRestartAttempts = 0;
let shouldKeepServerRunning = false;

// Screen-share source ids are opaque, short-lived capabilities. The renderer
// may list sources after a user gesture, but the main process only accepts an
// id from that exact list and consumes the selection on the next gestured
// getDisplayMedia request. Audio uses Electron's Windows system loopback only
// when the renderer explicitly requested it.
const SHARE_SOURCE_TTL_MS = 30_000;
const SHARE_SELECTION_TTL_MS = 15_000;
const issuedShareSources = new Map();
const pendingShareSelections = new Map();

function getLocalServerJwtSecret() {
  // A packaged host runs the server in production mode, where JWT_SECRET is
  // intentionally mandatory. Create it once in Electron's private userData
  // directory so a normal user can host without manually installing Node or
  // creating an environment file. Keeping the same value preserves sessions
  // while the app is restarted.
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32) {
    return process.env.JWT_SECRET;
  }
  const secretFile = path.join(app.getPath('userData'), 'server-jwt-secret.txt');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // First run: create it below.
  }
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  fs.writeFileSync(secretFile, secret, { encoding: 'utf8', mode: 0o600 });
  return secret;
}

const isDev = !app.isPackaged;
const configuredPort = Number(process.env.VARANDA_SERVER_PORT || 3000);
const SERVER_PORT = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
  ? configuredPort
  : 3000;

function isTrustedAppOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol === 'file:') return !isDev;
    return isDev && url.protocol === 'http:' && url.hostname === 'localhost' && url.port === '5173';
  } catch {
    return false;
  }
}

function assertTrustedIpcSender(event) {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (!mainWindow || event.sender !== mainWindow.webContents || !isTrustedAppOrigin(senderUrl)) {
    throw new Error('Origem nao autorizada.');
  }
  return event.sender.id;
}

function clearShareRequest(webContentsId) {
  issuedShareSources.delete(webContentsId);
  pendingShareSelections.delete(webContentsId);
}

async function getCurrentShareSources() {
  return desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
}

function configureMediaPermissions() {
  const appSession = session.defaultSession;

  // The renderer is sandboxed, so explicitly allow media requests made by our
  // own window. Other origins remain denied.
  appSession.setPermissionCheckHandler((_webContents, permission, origin) =>
    permission === 'media' && isTrustedAppOrigin(origin)
  );
  appSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' && isTrustedAppOrigin(webContents.getURL()));
  });

  // Electron does not show Chromium's normal display picker automatically.
  // A trusted renderer first lists and selects an opaque source through IPC.
  // The choice is consumed once, expires quickly, and is still rejected unless
  // Chromium reports that getDisplayMedia came from a user gesture.
  appSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const requestOrigin = request.frame?.url || request.securityOrigin;
    const webContentsId = mainWindow?.webContents.id;
    const pending = webContentsId ? pendingShareSelections.get(webContentsId) : null;
    if (webContentsId) pendingShareSelections.delete(webContentsId);

    if (
      !request.videoRequested ||
      !request.userGesture ||
      !isTrustedAppOrigin(requestOrigin) ||
      !pending ||
      pending.expiresAt < Date.now()
    ) {
      callback({});
      return;
    }
    try {
      const sources = await getCurrentShareSources();
      const selected = sources.find((source) => source.id === pending.sourceId);
      if (!selected) {
        callback({});
        return;
      }
      const response = { video: selected };
      if (pending.includeAudio && request.audioRequested && process.platform === 'win32') {
        response.audio = 'loopback';
      }
      callback(response);
    } catch (error) {
      console.error('[Screen share] Selected source is no longer available:', error);
      callback({});
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Varanda',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false,
      sandbox: true,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  // CSP: strict in production, relaxed in dev to allow Vite HMR.
  // Vite injects inline scripts and uses eval() for fast refresh, so dev
  // mode needs 'unsafe-inline' and 'unsafe-eval' on script-src.
  // Production CSP stays strict: no inline scripts, no remote origins.
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, cb) => {
    const scriptSrc = isDev
      ? "'self' 'unsafe-inline' 'unsafe-eval'"
      : "'self'";
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          `script-src ${scriptSrc}; ` +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "img-src 'self' data: blob:; " +
          "media-src 'self' blob: mediastream:; " +
          "connect-src 'self' ws: wss: http: https:; " +
          "object-src 'none'; " +
          "frame-ancestors 'none';",
        ],
        'X-Content-Type-Options': ['nosniff'],
      },
    });
  });

  const loadURL = isDev 
    ? 'http://localhost:5173' 
    : `file://${path.join(__dirname, '../client/dist/index.html')}`;

  mainWindow.loadURL(loadURL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Open DevTools detached so it doesn't cover the main window.
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.on('closed', () => {
    issuedShareSources.clear();
    pendingShareSelections.clear();
    mainWindow = null;
  });
}

function scheduleServerRestart() {
  if (!shouldKeepServerRunning || serverRestartTimer || serverRestartAttempts >= 3) return;
  const delay = Math.min(1_000 * (2 ** serverRestartAttempts), 8_000);
  serverRestartAttempts += 1;
  console.warn(`[Server] tentativa de reinício ${serverRestartAttempts}/3 em ${delay}ms.`);
  serverRestartTimer = setTimeout(() => {
    serverRestartTimer = null;
    startServer().catch((error) => {
      console.error('[Server] falha ao reiniciar:', error);
      scheduleServerRestart();
    });
  }, delay);
}

function startServer() {
  shouldKeepServerRunning = true;
  if (isServerRunning) return Promise.resolve();
  if (serverReadyPromise) return serverReadyPromise;
  
  const serverPath = isDev 
    ? path.join(__dirname, '../server/src/index.js')
    : path.join(process.resourcesPath, 'server/src/index.js');
  
  const uploadsDir = isDev 
    ? path.join(__dirname, '../uploads')
    : path.join(process.resourcesPath, '../uploads');
    
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  serverReadyPromise = new Promise((resolve, reject) => {
    rejectServerReady = reject;
    let settled = false;
    let output = '';
    let readinessTimer = null;
    const readyTimeout = setTimeout(() => {
      settle(new Error('O servidor local não iniciou dentro de 15 segundos.'));
    }, 15_000);

    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimeout);
      if (readinessTimer) clearTimeout(readinessTimer);
      serverReadyPromise = null;
      rejectServerReady = null;
      if (error) {
        isServerRunning = false;
        reject(error);
      } else {
        isServerRunning = true;
        serverRestartAttempts = 0;
        resolve();
      }
    };

    const probeServerHealth = () => {
      if (settled) return;
      const request = http.get(
        {
          host: '127.0.0.1',
          port: SERVER_PORT,
          path: '/health',
          timeout: 750,
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => { body += chunk; });
          response.on('end', () => {
            try {
              const health = JSON.parse(body);
              if (response.statusCode === 200 && health?.status === 'ok' && health?.service === 'varanda') {
                settle();
                return;
              }
            } catch {
              // The process may still be starting; retry below.
            }
            if (!settled) readinessTimer = setTimeout(probeServerHealth, 250);
          });
        }
      );
      request.on('timeout', () => request.destroy());
      request.on('error', () => {
        if (!settled) readinessTimer = setTimeout(probeServerHealth, 250);
      });
    };

    try {
      // A distributed Varanda must not depend on a separate Node.js
      // installation. In production, Electron can run its bundled Node
      // runtime when ELECTRON_RUN_AS_NODE is set.
      const serverExecutable = isDev ? 'node' : process.execPath;
      serverProcess = spawn(serverExecutable, [serverPath], {
        env: {
          ...process.env,
          PORT: String(SERVER_PORT),
          UPLOADS_DIR: uploadsDir,
          NODE_ENV: isDev ? 'development' : 'production',
          JWT_SECRET: isDev ? process.env.JWT_SECRET : getLocalServerJwtSecret(),
          ...(isDev ? {} : { ELECTRON_RUN_AS_NODE: '1' })
        },
        stdio: 'pipe'
      });
    } catch (error) {
      settle(error);
      return;
    }

    serverProcess.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.log(`[Server]: ${text}`);
      if (output.includes(`Varanda Server running on port ${SERVER_PORT}`)) settle();
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[Server Error]: ${data}`);
    });

    serverProcess.once('error', (error) => settle(error));
    serverProcess.on('close', (code) => {
      const wasReady = settled && isServerRunning;
      isServerRunning = false;
      serverProcess = null;
      if (!settled) settle(new Error(`O servidor local encerrou antes de iniciar (código ${code ?? 'desconhecido'}).`));
      else if (wasReady) {
        console.warn(`[Server] encerrado inesperadamente (código ${code ?? 'desconhecido'}).`);
        scheduleServerRestart();
      }
    });

    // Packaged Windows executables may not forward stdout reliably. Confirm
    // readiness by querying the server itself instead of depending on a log.
    probeServerHealth();
  });

  return serverReadyPromise;
}

function stopServer() {
  shouldKeepServerRunning = false;
  if (serverRestartTimer) clearTimeout(serverRestartTimer);
  serverRestartTimer = null;
  serverRestartAttempts = 0;
  if (rejectServerReady) rejectServerReady(new Error('A inicialização do servidor foi cancelada.'));
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  serverReadyPromise = null;
  rejectServerReady = null;
  isServerRunning = false;
}

function getLocalIP() {
  const os = require('os');
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

// IPC handlers
ipcMain.handle('start-server', async () => {
  await startServer();
  return {
    ip: getLocalIP(),
    port: SERVER_PORT,
    code: generateInviteCode(),
    status: 'online'
  };
});

ipcMain.handle('stop-server', async () => {
  stopServer();
  return { status: 'offline' };
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-local-ip', async () => {
  return getLocalIP();
});

ipcMain.handle('get-invite-code', () => generateInviteCode());

ipcMain.handle('list-share-sources', async (event) => {
  const webContentsId = assertTrustedIpcSender(event);
  const sources = await getCurrentShareSources();
  issuedShareSources.set(webContentsId, {
    expiresAt: Date.now() + SHARE_SOURCE_TTL_MS,
    ids: new Set(sources.map((source) => source.id)),
  });
  pendingShareSelections.delete(webContentsId);
  return sources.map((source) => ({
    // Contract mirrored by client/src/types/screenShare.ts. The id is opaque
    // and valid only for the most recently returned list.
    id: source.id,
    name: String(source.name || '').slice(0, 200),
    kind: source.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnailDataUrl: source.thumbnail?.isEmpty() ? null : source.thumbnail?.toDataURL() || null,
    appIconDataUrl: source.appIcon?.isEmpty() ? null : source.appIcon?.toDataURL() || null,
  }));
});

ipcMain.handle('select-share-source', (event, selection) => {
  const webContentsId = assertTrustedIpcSender(event);
  const issued = issuedShareSources.get(webContentsId);
  const sourceId = selection?.sourceId;
  const includeAudio = selection?.includeAudio;
  issuedShareSources.delete(webContentsId);

  if (
    !issued ||
    issued.expiresAt < Date.now() ||
    typeof sourceId !== 'string' ||
    !issued.ids.has(sourceId) ||
    typeof includeAudio !== 'boolean'
  ) {
    pendingShareSelections.delete(webContentsId);
    throw new Error('Fonte de compartilhamento invalida ou expirada.');
  }

  pendingShareSelections.set(webContentsId, {
    sourceId,
    includeAudio,
    expiresAt: Date.now() + SHARE_SELECTION_TTL_MS,
  });
  return { selected: true };
});

ipcMain.handle('clear-share-selection', (event) => {
  const webContentsId = assertTrustedIpcSender(event);
  clearShareRequest(webContentsId);
  return { cleared: true };
});

ipcMain.handle('open-external', async (_event, url) => {
  if (typeof url !== 'string') throw new Error('URL inválida.');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('URL inválida.');
  }
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
    throw new Error('Protocolo externo não permitido.');
  }
  await shell.openExternal(parsed.toString());
  return { opened: true };
});

// App events
app.whenReady().then(() => {
  configureMediaPermissions();
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopServer();
});
