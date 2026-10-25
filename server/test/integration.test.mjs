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
const port = 33_000 + Math.floor(Math.random() * 1_000);
const baseUrl = `http://127.0.0.1:${port}`;
let databaseDir;
let serverProcess;
let serverOutput = '';

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

function waitForEvent(socket, eventName, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, listener);
      reject(new Error(`Evento ${eventName} não chegou a tempo.`));
    }, 3_000);
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
  return body;
}

async function connectSocket(token) {
  const socket = io(baseUrl, { auth: { token }, transports: ['websocket'], autoConnect: false });
  const connected = waitForEvent(socket, 'connect');
  socket.connect();
  await connected;
  return socket;
}

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const { response } = await request('/api/auth/me');
      if (response.status === 401) return;
    } catch {
      // The process has not opened the listening socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Servidor de teste não iniciou em 10 segundos.\n${serverOutput}`);
}

before(async () => {
  databaseDir = await mkdtemp(join(tmpdir(), 'varanda-test-'));
  serverProcess = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: join(databaseDir, 'varanda.db'),
      UPLOADS_DIR: join(databaseDir, 'uploads'),
      JWT_SECRET: 'test-only-jwt-secret-with-at-least-thirty-two-characters',
      AUTH_REGISTER_RATE_LIMIT: '20',
      HEALTH_RATE_LIMIT: '2',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  serverProcess.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
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

test('registro, autenticação e criação de servidor retornam os seis canais padrão', async () => {
  const register = await registerUser('tester');
  assert.equal(typeof register.token, 'string');

  const authorization = { Authorization: `Bearer ${register.token}`, 'Content-Type': 'application/json' };
  const { response: createResponse, body: created } = await request('/api/servers', {
    method: 'POST',
    headers: authorization,
    body: JSON.stringify({ name: 'Servidor de teste' }),
  });
  assert.equal(createResponse.status, 201);
  assert.equal(typeof created.id, 'number');

  const { response: detailResponse, body: detail } = await request(`/api/servers/${created.id}`, {
    headers: { Authorization: authorization.Authorization },
  });
  assert.equal(detailResponse.status, 200);
  assert.equal(detail.channels.length, 6);
  assert.deepEqual(
    detail.channels.map((channel) => channel.type).sort(),
    ['text', 'text', 'text', 'voice', 'voice', 'voice']
  );
});

test('voz entrega fallback STUN e limita rajadas de offers por socket', async () => {
  const owner = await registerUser('owner');
  const ownerHeaders = { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' };
  const { body: created } = await request('/api/servers', {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ name: 'Servidor de voz' }),
  });
  const { body: detail } = await request(`/api/servers/${created.id}`, {
    headers: { Authorization: ownerHeaders.Authorization },
  });
  const voiceChannel = detail.channels.find((channel) => channel.type === 'voice');
  assert.ok(voiceChannel);

  const guest = await registerUser('guest');
  const { body: invite } = await request(`/api/servers/${created.id}/invite`, {
    method: 'POST',
    headers: ownerHeaders,
  });
  const { response: joinResponse } = await request('/api/servers/join', {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: invite.code }),
  });
  assert.equal(joinResponse.status, 200);

  const ownerSocket = await connectSocket(owner.token);
  const guestSocket = await connectSocket(guest.token);
  try {
    const ownerIce = waitForEvent(ownerSocket, 'voice_ice_servers');
    ownerSocket.emit('join_voice', { channelId: voiceChannel.id });
    const ownerIceConfig = await ownerIce;
    assert.deepEqual(ownerIceConfig.iceServers, [{ urls: 'stun:stun.l.google.com:19302' }]);

    const guestIce = waitForEvent(guestSocket, 'voice_ice_servers');
    guestSocket.emit('join_voice', { channelId: voiceChannel.id });
    await guestIce;

    const speakingStarted = waitForEvent(
      guestSocket,
      'user_speaking',
      (payload) => payload.channelId === voiceChannel.id && payload.userId === owner.user.id && payload.speaking === true
    );
    ownerSocket.emit('speaking_state', { channelId: voiceChannel.id, speaking: true });
    await speakingStarted;

    const speakingStopped = waitForEvent(
      guestSocket,
      'user_speaking',
      (payload) => payload.channelId === voiceChannel.id && payload.userId === owner.user.id && payload.speaking === false
    );
    ownerSocket.emit('toggle_mute', { channelId: voiceChannel.id, muted: true });
    await speakingStopped;

    let receivedOffers = 0;
    guestSocket.on('webrtc_offer', () => { receivedOffers += 1; });
    for (let index = 0; index < 25; index += 1) {
      ownerSocket.emit('webrtc_offer', {
        to: guestSocket.id,
        offer: { type: 'offer', sdp: `test-${index}` },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(receivedOffers > 0);
    assert.ok(receivedOffers <= 20);
  } finally {
    ownerSocket.disconnect();
    guestSocket.disconnect();
  }
});

test('isola respostas por canal e restringe ações administrativas ao dono', async () => {
  const owner = await registerUser('isolation_owner');
  const guest = await registerUser('isolation_guest');
  const ownerHeaders = { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' };
  const guestHeaders = { Authorization: `Bearer ${guest.token}`, 'Content-Type': 'application/json' };

  const { body: firstServer } = await request('/api/servers', {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ name: 'Servidor A' }),
  });
  const { body: secondServer } = await request('/api/servers', {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ name: 'Servidor B' }),
  });
  const { body: firstDetail } = await request(`/api/servers/${firstServer.id}`, { headers: { Authorization: owner.token ? `Bearer ${owner.token}` : '' } });
  const { body: secondDetail } = await request(`/api/servers/${secondServer.id}`, { headers: { Authorization: `Bearer ${owner.token}` } });
  const firstChannel = firstDetail.channels.find((channel) => channel.type === 'text');
  const secondChannel = secondDetail.channels.find((channel) => channel.type === 'text');
  assert.ok(firstChannel && secondChannel);

  const { body: sourceMessage } = await request('/api/messages', {
    method: 'POST', headers: ownerHeaders,
    body: JSON.stringify({ channelId: secondChannel.id, content: 'Mensagem privada do servidor B' }),
  });
  const { response: crossReply } = await request('/api/messages', {
    method: 'POST', headers: ownerHeaders,
    body: JSON.stringify({ channelId: firstChannel.id, content: 'Tentativa de resposta cruzada', replyTo: sourceMessage.id }),
  });
  assert.equal(crossReply.status, 400);

  const { body: invite } = await request(`/api/servers/${firstServer.id}/invite`, { method: 'POST', headers: ownerHeaders });
  const { response: joined } = await request('/api/servers/join', {
    method: 'POST', headers: guestHeaders, body: JSON.stringify({ code: invite.code }),
  });
  assert.equal(joined.status, 200);

  const { response: guestCreate } = await request('/api/channels', {
    method: 'POST', headers: guestHeaders,
    body: JSON.stringify({ serverId: firstServer.id, name: 'canal-invasor', type: 'text' }),
  });
  assert.equal(guestCreate.status, 403);
  const { response: guestRename } = await request(`/api/channels/${firstChannel.id}`, {
    method: 'PUT', headers: guestHeaders, body: JSON.stringify({ name: 'renomeado-sem-permissao' }),
  });
  assert.equal(guestRename.status, 403);

  const form = new FormData();
  form.append('file', new Blob([Buffer.from('not a png')], { type: 'image/png' }), 'imagem.png');
  const { response: invalidUpload } = await request('/api/uploads', {
    method: 'POST', headers: { Authorization: `Bearer ${owner.token}` }, body: form,
  });
  assert.equal(invalidUpload.status, 400);
});

test('reentrada de voz apos reconnect nao duplica participante nem sinal de tela', async () => {
  const owner = await registerUser('reconnect_owner');
  const guest = await registerUser('reconnect_guest');
  const headers = { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' };
  const { body: created } = await request('/api/servers', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Servidor reconnect' }),
  });
  const { body: detail } = await request(`/api/servers/${created.id}`, {
    headers: { Authorization: headers.Authorization },
  });
  const channel = detail.channels.find((item) => item.type === 'voice');
  assert.ok(channel);
  const { body: invite } = await request(`/api/servers/${created.id}/invite`, {
    method: 'POST',
    headers,
  });
  await request('/api/servers/join', {
    method: 'POST',
    headers: { Authorization: `Bearer ${guest.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: invite.code }),
  });

  let ownerSocket = await connectSocket(owner.token);
  const guestSocket = await connectSocket(guest.token);
  try {
    const ownerJoined = waitForEvent(ownerSocket, 'voice_participants');
    ownerSocket.emit('join_voice', { channelId: channel.id });
    await ownerJoined;
    const guestJoined = waitForEvent(guestSocket, 'voice_participants');
    guestSocket.emit('join_voice', { channelId: channel.id });
    await guestJoined;

    const ownerLeft = waitForEvent(
      guestSocket,
      'user_left_voice',
      (payload) => payload.userId === owner.user.id
    );
    ownerSocket.disconnect();
    await ownerLeft;

    ownerSocket = await connectSocket(owner.token);
    const rejoined = waitForEvent(ownerSocket, 'voice_participants');
    ownerSocket.emit('join_voice', { channelId: channel.id });
    const snapshot = await rejoined;
    assert.equal(snapshot.participants.filter((item) => item.userId === owner.user.id).length, 1);
    assert.deepEqual(snapshot.connectTo, [guestSocket.id]);

    let startedEvents = 0;
    let stoppedEvents = 0;
    guestSocket.on('user_screen_share_started', () => { startedEvents += 1; });
    guestSocket.on('user_screen_share_stopped', () => { stoppedEvents += 1; });
    ownerSocket.emit('start_screen_share', { channelId: channel.id, streamId: 'reconnect_stream' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    ownerSocket.emit('stop_screen_share', { channelId: channel.id });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(startedEvents, 1);
    assert.equal(stoppedEvents, 1);

    const repeatedJoin = waitForEvent(ownerSocket, 'voice_participants');
    ownerSocket.emit('join_voice', { channelId: channel.id });
    const repeatedSnapshot = await repeatedJoin;
    assert.equal(repeatedSnapshot.participants.filter((item) => item.userId === owner.user.id).length, 1);
    assert.equal(new Set(repeatedSnapshot.connectTo).size, repeatedSnapshot.connectTo.length);
  } finally {
    ownerSocket.disconnect();
    guestSocket.disconnect();
  }
});

test('mensagens diretas exigem amizade aceita', async () => {
  const sender = await registerUser('dm_sender');
  const receiver = await registerUser('dm_receiver');
  const senderSocket = await connectSocket(sender.token);
  const receiverSocket = await connectSocket(receiver.token);
  try {
    senderSocket.emit('send_dm', { receiverId: receiver.user.id, content: 'não deve chegar' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const { body: beforeFriendship } = await request(`/api/friends/dm/${receiver.user.id}`, {
      headers: { Authorization: `Bearer ${sender.token}` },
    });
    assert.deepEqual(beforeFriendship, []);

    const { response: requestResponse } = await request('/api/friends/request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sender.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: receiver.user.username }),
    });
    assert.equal(requestResponse.status, 201);
    const { body: receiverFriends } = await request('/api/friends', {
      headers: { Authorization: `Bearer ${receiver.token}` },
    });
    const requestToAccept = receiverFriends.find((friendship) => friendship.sender_id === sender.user.id);
    assert.ok(requestToAccept);
    const { response: accepted } = await request(`/api/friends/${requestToAccept.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${receiver.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted' }),
    });
    assert.equal(accepted.status, 200);

    const received = waitForEvent(receiverSocket, 'new_dm', (dm) => dm.content === 'agora chega');
    senderSocket.emit('send_dm', { receiverId: receiver.user.id, content: 'agora chega' });
    await received;
  } finally {
    senderSocket.disconnect();
    receiverSocket.disconnect();
  }
});

test('limita requisições REST por IP e informa quando tentar novamente', async () => {
  const first = await request('/health');
  const second = await request('/health');
  const blocked = await request('/health');
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(blocked.response.status, 429);
  assert.equal(typeof blocked.body.retryAfterSeconds, 'number');
  assert.ok(Number(blocked.response.headers.get('retry-after')) >= 1);
});
