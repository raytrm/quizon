import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { createQuizonServer } from '../server/server.js';

function waitForEvent(socket, event, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout esperando ${event}`)), timeoutMs);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe('Integración End-to-End (HTTP + Socket.IO)', () => {
  const server = createQuizonServer({ port: 0 });
  const clients = [];

  after(async () => {
    for (const c of clients) c.disconnect();
    await server.stop();
  });

  it('flujo completo: TV -> Host -> 2 móviles en un equipo -> primera respuesta bloquea -> revelación', async () => {
    const { port } = await server.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. Verificar endpoints HTTP
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.status, 'ok');

    // 2. Conectar TV
    const tv = ioClient(baseUrl);
    clients.push(tv);
    await waitForEvent(tv, 'connect');
    tv.emit('tv:register');
    const tvReg = await waitForEvent(tv, 'tv:registered');
    assert.match(tvReg.code, /^\d{6}$/);
    assert.ok(tvReg.hostQr.startsWith('data:image/png;base64,'));

    // 3. Conectar Anfitrión y reclamar sala
    const host = ioClient(baseUrl);
    clients.push(host);
    await waitForEvent(host, 'connect');
    host.emit('host:claim_room', { roomCode: tvReg.code });
    const claimed = await waitForEvent(host, 'host:claimed');
    assert.ok(claimed.hostToken);

    host.emit('host:update_config', {
      roomCode: tvReg.code,
      hostToken: claimed.hostToken,
      config: { title: 'Test Match', packId: 'modos-especiales', questionCount: 1 },
    });

    // 4. Conectar 2 móviles al mismo equipo
    const p1 = ioClient(baseUrl);
    const p2 = ioClient(baseUrl);
    clients.push(p1, p2);
    await Promise.all([waitForEvent(p1, 'connect'), waitForEvent(p2, 'connect')]);

    p1.emit('player:join', {
      roomCode: tvReg.code,
      teamName: 'Equipo Alfa',
      members: ['Ana', 'Pepe'],
      createTeam: true,
    });
    const j1 = await waitForEvent(p1, 'player:joined');
    assert.equal(j1.teamName, 'Equipo Alfa');

    p2.emit('player:join', {
      roomCode: tvReg.code,
      teamName: 'Equipo Alfa',
      createTeam: false,
    });
    const j2 = await waitForEvent(p2, 'player:joined');
    assert.equal(j2.teamId, j1.teamId);

    // 5. Iniciar partida y esperar pregunta activa (intro dura 3s)
    const startPromise = waitForEvent(tv, 'game:question_start', 6000);
    host.emit('host:start_game', { roomCode: tvReg.code, hostToken: claimed.hostToken });
    const qStart = await startPromise;
    assert.ok(qStart.question.id);
    assert.equal(qStart.question.correctOptionIds, undefined);

    // 6. El móvil 1 responde; el móvil 2 debe recibir bloqueo por equipo y pasar a REVEAL
    const ack1Promise = waitForEvent(p1, 'game:answer_ack');
    const ack2Promise = waitForEvent(p2, 'game:answer_ack');
    const revealPromise = waitForEvent(tv, 'game:reveal');

    p1.emit('player:answer', {
      roomCode: tvReg.code,
      questionId: qStart.question.id,
      selectedOptionIds: [qStart.question.options[0].id],
    });

    const [ack1, ack2, reveal] = await Promise.all([ack1Promise, ack2Promise, revealPromise]);
    assert.equal(ack1.accepted, true);
    assert.equal(ack2.accepted, false);
    assert.equal(ack2.lockedByTeam, true);
    assert.ok(Array.isArray(reveal.correctOptionIds));

    // 7. Avanzar a FINISHED (porque solo había 1 pregunta)
    const finishedPromise = waitForEvent(tv, 'game:finished');
    host.emit('host:next_step', { roomCode: tvReg.code, hostToken: claimed.hostToken });
    const finished = await finishedPromise;
    assert.equal(finished.standings.length, 1);
  });
});

