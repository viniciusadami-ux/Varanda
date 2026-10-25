const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const electronBinary = require('electron');

const PORT = 5173;
const SERVER_PORT = 3000;
// A .cmd file cannot be spawned directly by Node on Windows with shell:false
// (Node 24 returns spawn EINVAL). Run the fixed command through cmd.exe.
const clientCommand = process.platform === 'win32'
  ? (process.env.ComSpec || process.env.COMSPEC || 'cmd.exe')
  : 'npm';
const clientArgs = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm run client']
  : ['run', 'client'];
const profileArgument = process.argv.find((argument) => argument.startsWith('--profile='));
const profile = profileArgument?.slice('--profile='.length).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
let clientProcess = null;
let serverProcess = null;
let electronProcess = null;
let stopping = false;

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    const finish = (inUse) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

async function waitForPort(port, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortInUse(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`A interface não iniciou na porta ${port}.`);
}

function hasVarandaServer() {
  return new Promise((resolve) => {
    const request = http.get(
      { host: '127.0.0.1', port: SERVER_PORT, path: '/health', timeout: 750 },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          try {
            const health = JSON.parse(body);
            resolve(response.statusCode === 200 && health?.status === 'ok' && health?.service === 'varanda');
          } catch {
            resolve(false);
          }
        });
      }
    );
    request.once('error', () => resolve(false));
    request.once('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForVarandaServer(timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await hasVarandaServer()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`O servidor não iniciou na porta ${SERVER_PORT}.`);
}

async function ensureServer() {
  if (await hasVarandaServer()) {
    console.log(`[Varanda] Servidor existente encontrado em http://localhost:${SERVER_PORT}; reutilizando-o.`);
    return;
  }

  if (await isPortInUse(SERVER_PORT)) {
    throw new Error(`A porta ${SERVER_PORT} está em uso por outro programa. Feche-o ou escolha outra porta.`);
  }

  const serverDirectory = path.join(__dirname, '..', 'server');
  console.log(`[Varanda] Iniciando servidor local em http://localhost:${SERVER_PORT}...`);
  serverProcess = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDirectory,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, PORT: String(SERVER_PORT), NODE_ENV: 'development' },
  });
  serverProcess.once('exit', (code) => {
    if (!stopping && code !== 0) {
      console.error(`[Varanda] O servidor encerrou com código ${code}.`);
      stopChildren();
      process.exitCode = code || 1;
    }
  });
  await waitForVarandaServer();
}

function stopChildren() {
  if (stopping) return;
  stopping = true;
  if (electronProcess && !electronProcess.killed) electronProcess.kill();
  if (clientProcess && !clientProcess.killed) clientProcess.kill();
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
}

async function main() {
  await ensureServer();

  const alreadyRunning = await isPortInUse(PORT);
  if (alreadyRunning) {
    console.log(`[Varanda] Interface existente encontrada em http://localhost:${PORT}; reutilizando-a.`);
  } else {
    clientProcess = spawn(clientCommand, clientArgs, { stdio: 'inherit', shell: false });
    clientProcess.once('exit', (code) => {
      if (!stopping && code !== 0) {
        console.error(`[Varanda] A interface encerrou com código ${code}.`);
        stopChildren();
        process.exitCode = code || 1;
      }
    });
    await waitForPort(PORT);
  }

  electronProcess = spawn(electronBinary, ['.'], {
    stdio: 'inherit',
    shell: false,
    env: profile ? { ...process.env, VARANDA_PROFILE: profile } : process.env,
  });
  electronProcess.once('exit', (code) => {
    if (!stopping) stopChildren();
    process.exitCode = code || 0;
  });
}

process.on('SIGINT', stopChildren);
process.on('SIGTERM', stopChildren);
main().catch((error) => {
  console.error(`[Varanda] ${error.message}`);
  stopChildren();
  process.exitCode = 1;
});