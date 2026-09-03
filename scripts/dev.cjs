const net = require('node:net');
const { spawn } = require('node:child_process');
const electronBinary = require('electron');

const PORT = 5173;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const profileArgument = process.argv.find((argument) => argument.startsWith('--profile='));
const profile = profileArgument?.slice('--profile='.length).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
let clientProcess = null;
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

function stopChildren() {
  if (stopping) return;
  stopping = true;
  if (electronProcess && !electronProcess.killed) electronProcess.kill();
  if (clientProcess && !clientProcess.killed) clientProcess.kill();
}

async function main() {
  const alreadyRunning = await isPortInUse(PORT);
  if (alreadyRunning) {
    console.log(`[Discord 2] Interface existente encontrada em http://localhost:${PORT}; reutilizando-a.`);
  } else {
    clientProcess = spawn(npm, ['run', 'client'], { stdio: 'inherit', shell: false });
    clientProcess.once('exit', (code) => {
      if (!stopping && code !== 0) {
        console.error(`[Discord 2] A interface encerrou com código ${code}.`);
        stopChildren();
        process.exitCode = code || 1;
      }
    });
    await waitForPort(PORT);
  }

  electronProcess = spawn(electronBinary, ['.'], {
    stdio: 'inherit',
    shell: false,
    env: profile ? { ...process.env, DISCORD2_PROFILE: profile } : process.env,
  });
  electronProcess.once('exit', (code) => {
    if (!stopping) stopChildren();
    process.exitCode = code || 0;
  });
}

process.on('SIGINT', stopChildren);
process.on('SIGTERM', stopChildren);
main().catch((error) => {
  console.error(`[Discord 2] ${error.message}`);
  stopChildren();
  process.exitCode = 1;
});
