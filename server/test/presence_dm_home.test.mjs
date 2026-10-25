import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const port = 33_500 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;
let databaseDir;
let serverProcess;
let serverOutput = '';

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  let body = {};
  try { body = await response.json(); } catch { body = {}; }
  return { response, body };
}

function waitForEvent(socket, eventName, predicate = () => true, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, listener);
      reject(new Error(`Evento ${eventName} não chegou a tempo.`));
    }, timeoutMs);
    const listener = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timeout);
      socket.off(eventName, listener);
      resolve(payload);
    };
    socket.on(eventName, listener);
  });
}

async function registerUser(label) {
  const unique = `${label}_${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const { response, body } = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: unique,
      email: `${unique}@example.test`,
      password: 'A-strong-password-for-test-123',
    }),
  });
  assert.equal(response.status, 200);
  return body; // { token, user }
}

async function makeFriends(userA, userB) {
  const { response: reqRes } = await request('/api/friends/request', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userA.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: userB.user.username }),
  });
  assert.ok([201, 200].includes(reqRes.status));
  const { body: listB } = await request('/api/friends', {
    headers: { Authorization: `Bearer ${userB.token}` },
  });
  const rel = listB.find((f) => f.sender_id === userA.user.id);
  assert.ok(rel, 'friend request not found');
  const { response: acceptRes } = await request(`/api/friends/${rel.id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${userB.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'accepted' }),
  });
  assert.equal(acceptRes.status, 200);
}

async function connectSocket(token) {
  const socket = io(baseUrl, { auth: { token }, transports: ['websocket'], autoConnect: false });
  const connected = waitForEvent(socket, 'connect');
  socket.connect();
  await connected;
  return socket;
}

async function waitForServer() {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const { response } = await request('/api/auth/me');
      if (response.status === 401) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Servidor de teste não iniciou em 12s. Logs:\n${serverOutput}`);
}

before(async () => {
  databaseDir = await mkdtemp(join(tmpdir(), 'varanda-presence-'));
  serverProcess = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: join(databaseDir, 'varanda.db'),
      UPLOADS_DIR: join(databaseDir, 'uploads'),
      JWT_SECRET: 'test-only-jwt-secret-with-at-least-thirty-two-characters-presence',
      NODE_ENV: 'test',
      HEALTH_RATE_LIMIT: '1000',
      API_RATE_LIMIT: '1000',
      AUTH_REGISTER_RATE_LIMIT: '1000',
      AUTH_LOGIN_RATE_LIMIT: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (c) => { serverOutput += c.toString(); });
  serverProcess.stderr.on('data', (c) => { serverOutput += c.toString(); });
  await waitForServer();
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null && !serverProcess.killed) {
    const exited = once(serverProcess, 'exit');
    serverProcess.kill();
    await exited;
  }
  await rm(databaseDir, { recursive: true, force: true });
});

// ---------- Fase 5: presença multi-socket ----------
test('presença: duas sessões mesma conta mantém online até último disconnect', async () => {
  const alice = await registerUser('alice_multi');
  const bob = await registerUser('bob_multi');
  await makeFriends(alice, bob);

  const bobSocket = await connectSocket(bob.token);
  // Bob vai observar Alice
  // Alice conecta primeira sessão
  const aliceSock1 = await connectSocket(alice.token);
  const online1 = await waitForEvent(bobSocket, 'user_status', (p) => p.userId === alice.user.id && p.status === 'online');
  assert.ok(online1, 'Bob should see Alice online after first socket');

  // Alice conecta segunda sessão (mesma conta)
  const aliceSock2 = await connectSocket(alice.token);
  // Bob não deve receber offline entre as duas conexões
  // Aguarda 400ms e garante que não houve offline
  let gotOffline = false;
  const offlineListener = (p) => { if (p.userId === alice.user.id && p.status === 'offline') gotOffline = true; };
  bobSocket.on('user_status', offlineListener);
  await new Promise((r) => setTimeout(r, 500));
  bobSocket.off('user_status', offlineListener);
  assert.equal(gotOffline, false, 'Não deve ficar offline ao abrir segunda sessão');

  // Snapshot para segunda sessão deve conter Bob online? Check aliceSock2 recebeu snapshot com bob
  // Bob já está online, alice snapshot should have bob online
  // We check by waiting for presence_snapshot on aliceSock2 (already emitted at connect, may have missed)
  // Instead create new socket for snapshot test later, here we just ensure still online.

  // Desconecta primeira sessão, ainda deve permanecer online
  aliceSock1.disconnect();
  await new Promise((r) => setTimeout(r, 800)); // dentro do grace period, ainda não offline
  gotOffline = false;
  bobSocket.on('user_status', offlineListener);
  await new Promise((r) => setTimeout(r, 600));
  bobSocket.off('user_status', offlineListener);
  assert.equal(gotOffline, false, 'Desconectar 1 de 2 não deve deixar offline');

  // Desconecta segunda (última) -> após grace period deve ficar offline
  const offlinePromise = waitForEvent(bobSocket, 'user_status', (p) => p.userId === alice.user.id && p.status === 'offline', 6000);
  aliceSock2.disconnect();
  const offline = await offlinePromise;
  assert.equal(offline.status, 'offline');
  bobSocket.disconnect();
});

test('presença: invisible aparece offline para amigo e snapshot reflete', async () => {
  const alice = await registerUser('alice_invis');
  const bob = await registerUser('bob_invis');
  await makeFriends(alice, bob);

  const bobSocket = await connectSocket(bob.token);
  const aliceSocket = await connectSocket(alice.token);
  await waitForEvent(bobSocket, 'user_status', (p) => p.userId === alice.user.id && p.status === 'online');

  // Alice fica invisível
  const offlinePromise = waitForEvent(bobSocket, 'user_status', (p) => p.userId === alice.user.id && p.status === 'offline');
  aliceSocket.emit('update_status', { status: 'invisible' });
  const invis = await offlinePromise;
  assert.equal(invis.status, 'offline', 'invisible deve aparecer offline');

  // Snapshot para novo socket de Bob deve mostrar Alice offline (invisible -> offline)
  const bobSocket2 = await connectSocket(bob.token);
  const snap = await waitForEvent(bobSocket2, 'presence_snapshot', () => true, 3000);
  // snapshot is object mapping friendId -> status
  assert.ok(snap, 'snapshot should be received');
  // alice is in snapshot
  const aliceStatusInSnap = snap[alice.user.id] ?? snap[String(alice.user.id)];
  assert.equal(aliceStatusInSnap, 'offline', 'snapshot deve refletir invisible como offline');

  aliceSocket.disconnect();
  bobSocket.disconnect();
  bobSocket2.disconnect();
  await new Promise((r) => setTimeout(r, 3000)); // wait grace for alice offline cleanup
});

test('presença: reconexão rápida não deixa offline por engano', async () => {
  const alice = await registerUser('alice_reconn');
  const bob = await registerUser('bob_reconn');
  await makeFriends(alice, bob);
  const bobSocket = await connectSocket(bob.token);
  let aliceSocket = await connectSocket(alice.token);
  await waitForEvent(bobSocket, 'user_status', (p) => p.userId === alice.user.id && p.status === 'online');

  // Simulate reconnection: disconnect and immediately reconnect
  aliceSocket.disconnect();
  // Reconnect within grace period (2.5s)
  await new Promise((r) => setTimeout(r, 500));
  aliceSocket = await connectSocket(alice.token);
  // Bob deve continuar vendo online, não offline, e ao final ainda online
  // Wait a bit and check no offline was emitted
  let sawOffline = false;
  const listener = (p) => { if (p.userId === alice.user.id && p.status === 'offline') sawOffline = true; };
  bobSocket.on('user_status', listener);
  await new Promise((r) => setTimeout(r, 3000));
  bobSocket.off('user_status', listener);
  assert.equal(sawOffline, false, 'Reconexão rápida não deve gerar offline');

  // Cleanup: disconnect alice, expect offline after grace
  const off = waitForEvent(bobSocket, 'user_status', (p) => p.userId === alice.user.id && p.status === 'offline', 6000);
  aliceSocket.disconnect();
  await off;
  bobSocket.disconnect();
});

test('presença: não emite global para não-amigos', async () => {
  const alice = await registerUser('alice_private');
  const bob = await registerUser('bob_private');
  const charlie = await registerUser('charlie_stranger');
  await makeFriends(alice, bob);
  // charlie não é amigo de alice
  const bobSocket = await connectSocket(bob.token);
  const charlieSocket = await connectSocket(charlie.token);

  let charlieSawAlice = false;
  const charlieListener = (p) => { if (p.userId === alice.user.id) charlieSawAlice = true; };
  charlieSocket.on('user_status', charlieListener);
  bobSocket.on('user_status', () => {}); // ensure bob is listening

  const aliceSocket = await connectSocket(alice.token);
  await waitForEvent(bobSocket, 'user_status', (p) => p.userId === alice.user.id && p.status === 'online');
  await new Promise((r) => setTimeout(r, 600));
  charlieSocket.off('user_status', charlieListener);
  assert.equal(charlieSawAlice, false, 'Não-amigo não deve receber user_status de Alice');

  aliceSocket.disconnect();
  bobSocket.disconnect();
  charlieSocket.disconnect();
  await new Promise((r) => setTimeout(r, 3000));
});

test('presença: snapshot após login contém amigos online', async () => {
  const alice = await registerUser('alice_snap');
  const bob = await registerUser('bob_snap');
  await makeFriends(alice, bob);
  const bobSocket = await connectSocket(bob.token);
  await new Promise((r) => setTimeout(r, 300));
  const aliceSocket = await connectSocket(alice.token);
  // Bob deve ter recebido snapshot no connect dele, mas alice acabou de conectar, então bob's snapshot anterior não tinha alice online
  // Agora reconecta bob para pegar snapshot atualizado
  bobSocket.disconnect();
  await new Promise((r) => setTimeout(r, 400));
  const bobSocket2 = await connectSocket(bob.token);
  const snap = await waitForEvent(bobSocket2, 'presence_snapshot', () => true, 3000);
  assert.ok(snap[alice.user.id] === 'online' || snap[String(alice.user.id)] === 'online', 'Snapshot deve conter alice online');
  aliceSocket.disconnect();
  bobSocket2.disconnect();
  await new Promise((r) => setTimeout(r, 3000));
});

// ---------- Fase 7: DM sem crash ----------
test('DM: envio e recebimento sem crash, histórico vazio e com mensagens, troca entre DMs', async () => {
  const alice = await registerUser('alice_dm2');
  const bob = await registerUser('bob_dm2');
  const carol = await registerUser('carol_dm2');
  await makeFriends(alice, bob);
  await makeFriends(alice, carol);

  const aliceSocket = await connectSocket(alice.token);
  const bobSocket = await connectSocket(bob.token);
  const carolSocket = await connectSocket(carol.token);

  // Histórico vazio para Carol inicialmente
  const { body: emptyHist } = await request(`/api/friends/dm/${carol.user.id}`, {
    headers: { Authorization: `Bearer ${alice.token}` },
  });
  assert.deepEqual(emptyHist, [], 'Histórico vazio deve ser array vazio');

  // Alice envia DM para Bob com ack (listeners antes do emit para capturar eco)
  const bobReceived = waitForEvent(bobSocket, 'new_dm', (dm) => dm.content === 'oi bob');
  const aliceEchoPromise = waitForEvent(aliceSocket, 'new_dm', (dm) => dm.content === 'oi bob');
  const ack = await new Promise((resolve) => {
    aliceSocket.emit('send_dm', { receiverId: bob.user.id, content: 'oi bob' }, (res) => resolve(res));
  });
  assert.equal(ack.success, true, 'DM deve retornar success');
  assert.ok(ack.message?.id, 'ack deve conter mensagem');
  const [bobDm, aliceEcho] = await Promise.all([bobReceived, aliceEchoPromise]);
  assert.equal(bobDm.content, 'oi bob');
  assert.equal(bobDm.sender_id, alice.user.id);
  assert.equal(aliceEcho.content, 'oi bob');

  // Histórico agora tem 1
  const { body: hist1 } = await request(`/api/friends/dm/${bob.user.id}`, {
    headers: { Authorization: `Bearer ${alice.token}` },
  });
  assert.equal(hist1.length, 1);
  assert.equal(hist1[0].content, 'oi bob');

  // Bob responde
  const aliceReceived = waitForEvent(aliceSocket, 'new_dm', (dm) => dm.content === 'e ai alice');
  bobSocket.emit('send_dm', { receiverId: alice.user.id, content: 'e ai alice' });
  const aliceDm = await aliceReceived;
  assert.equal(aliceDm.content, 'e ai alice');

  // Histórico agora 2
  const { body: hist2 } = await request(`/api/friends/dm/${bob.user.id}`, {
    headers: { Authorization: `Bearer ${alice.token}` },
  });
  assert.equal(hist2.length, 2);

  // Troca para Carol: histórico ainda vazio, enviar para Carol
  const carolReceived = waitForEvent(carolSocket, 'new_dm', (dm) => dm.content === 'oi carol');
  aliceSocket.emit('send_dm', { receiverId: carol.user.id, content: 'oi carol' }, () => {});
  await carolReceived;
  const { body: histCarol } = await request(`/api/friends/dm/${carol.user.id}`, {
    headers: { Authorization: `Bearer ${alice.token}` },
  });
  assert.equal(histCarol.length, 1);
  assert.equal(histCarol[0].content, 'oi carol');

  // Voltar para Bob, histórico ainda 2 (não deve misturar)
  const { body: histBobAgain } = await request(`/api/friends/dm/${bob.user.id}`, {
    headers: { Authorization: `Bearer ${alice.token}` },
  });
  assert.equal(histBobAgain.length, 2);

  // DM não contém reactions, reply_to, file_url - garantir que não crasha ao serializar
  for (const dm of histBobAgain) {
    assert.equal(typeof dm.content, 'string');
    assert.equal(dm.reactions, undefined, 'DM não deve ter reactions');
  }

  // Erro quando não amigo? Tenta enviar para estranho
  const stranger = await registerUser('stranger_dm');
  const errAck = await new Promise((resolve) => {
    aliceSocket.emit('send_dm', { receiverId: stranger.user.id, content: 'deve falhar' }, (res) => resolve(res));
  });
  assert.ok(errAck.error, 'Deve retornar erro quando não são amigos');

  aliceSocket.disconnect();
  bobSocket.disconnect();
  carolSocket.disconnect();
});

test('DM: confirma que mensagem não derruba ao acessar reactions.length (tipo seguro)', async () => {
  // Este teste valida indiretamente que o servidor retorna DM sem campo reactions e cliente trata com optional chaining
  const alice = await registerUser('alice_safe');
  const bob = await registerUser('bob_safe');
  await makeFriends(alice, bob);
  const aliceSocket = await connectSocket(alice.token);
  // Envia DM
  const ack = await new Promise((resolve) => {
    aliceSocket.emit('send_dm', { receiverId: bob.user.id, content: 'teste safe' }, (res) => resolve(res));
  });
  assert.equal(ack.success, true);
  // Verifica que DM retornado não tem reactions
  assert.equal(ack.message.reactions, undefined);
  // Verifica histórico via REST também sem reactions
  const { body } = await request(`/api/friends/dm/${bob.user.id}`, {
    headers: { Authorization: `Bearer ${alice.token}` },
  });
  assert.ok(Array.isArray(body));
  assert.equal(body[0].reactions, undefined);
  aliceSocket.disconnect();
});

// ---------- Fase 6: sessão válida ----------
test('sessão válida: /api/auth/me retorna usuário, token inválido 401', async () => {
  const user = await registerUser('sess_user');
  const { response: okRes, body: okBody } = await request('/api/auth/me', {
    headers: { Authorization: `Bearer ${user.token}` },
  });
  assert.equal(okRes.status, 200);
  assert.equal(okBody.username, user.user.username);

  const { response: badRes } = await request('/api/auth/me', {
    headers: { Authorization: `Bearer invalid-token-xyz` },
  });
  assert.equal(badRes.status, 401);

  const { response: noTokenRes } = await request('/api/auth/me');
  assert.equal(noTokenRes.status, 401);
});
