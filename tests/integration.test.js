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

  it('flujo completo: TV -> Host (timeMultiplier) -> 2 móviles -> TIME_UP -> host:reveal_answer -> host:show_results', async () => {
    const { port } = await server.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. Verificar endpoints HTTP
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.status, 'ok');

    const mediaRes = await fetch(`${baseUrl}/api/media/000001/00001`);
    assert.equal(mediaRes.status, 200);
    const media = await mediaRes.json();
    assert.equal(media.catalogId, '000001');
    assert.equal(media.questionId, '00001');
    assert.equal(media.bg.length, 3);
    assert.ok(Array.isArray(media.clue));
    assert.equal(media.explain.length, 2);
    assert.match(media.bg[0].name, /^01_/);
    assert.match(media.bg[2].name, /^03_/);

    const previewRes = await fetch(`${baseUrl}/api/preview-question/00001`);
    assert.equal(previewRes.status, 200);
    const preview = await previewRes.json();
    assert.equal(preview.catalogId, '000001');
    assert.equal(preview.question.id, '00001');
    assert.match(preview.question.prompt, /lemming/i);

    const testBgRes = await fetch(`${baseUrl}/test-bg`);
    assert.equal(testBgRes.status, 200);

    const adminPageRes = await fetch(`${baseUrl}/admin`);
    assert.equal(adminPageRes.status, 200);

    const adminCatalogRes = await fetch(`${baseUrl}/api/admin/catalog`);
    assert.equal(adminCatalogRes.status, 200);
    const adminCatalog = await adminCatalogRes.json();
    assert.equal(adminCatalog.catalogId, '000001');
    assert.ok(adminCatalog.packs.length > 0);

    // 2. Conectar TV
    const tv = ioClient(baseUrl);
    clients.push(tv);
    await waitForEvent(tv, 'connect');
    tv.emit('tv:register');
    const tvReg = await waitForEvent(tv, 'tv:registered');
    assert.match(tvReg.code, /^\d{6}$/);
    assert.ok(tvReg.hostQr.startsWith('data:image/png;base64,'));

    // 3. Conectar Anfitrión y reclamar sala con multiplicador de tiempo 2x
    const host = ioClient(baseUrl);
    clients.push(host);
    await waitForEvent(host, 'connect');
    host.emit('host:claim_room', { roomCode: tvReg.code });
    const claimed = await waitForEvent(host, 'host:claimed');
    assert.ok(claimed.hostToken);

    host.emit('host:update_config', {
      roomCode: tvReg.code,
      hostToken: claimed.hostToken,
      config: {
        title: 'Test Match',
        packId: 'mitos-y-leyendas',
        questionCount: 2,
        timeMultiplier: 2,
      },
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
      color: '#ef4444',
      icon: '🦊',
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
    // Verificamos que el multiplicador 2x se aplicó (mínimo >= 40s para preguntas de 20-30s)
    assert.ok(qStart.question.timeLimit >= 40);

    // 6. El móvil 1 selecciona una opción, se sincroniza con móvil 2, y luego cambia su selección
    const ack1Promise = waitForEvent(p1, 'game:answer_ack');
    const ack2Promise = waitForEvent(p2, 'game:answer_ack');

    const firstChoice = qStart.question.options[0].id;
    const secondChoice = qStart.question.options[1].id;

    p1.emit('player:answer', {
      roomCode: tvReg.code,
      questionId: qStart.question.id,
      selectedOptionIds: [firstChoice],
    });

    const [ack1, ack2] = await Promise.all([ack1Promise, ack2Promise]);
    assert.equal(ack1.accepted, true);
    assert.equal(ack1.lockedByTeam, false);
    assert.deepEqual(ack1.selectedOptionIds, [firstChoice]);
    assert.deepEqual(ack2.selectedOptionIds, [firstChoice]);

    // Cambiar selección antes de que termine el tiempo
    const ackChangePromise = waitForEvent(p1, 'game:answer_ack');
    p1.emit('player:answer', {
      roomCode: tvReg.code,
      questionId: qStart.question.id,
      selectedOptionIds: [secondChoice],
    });
    const ackChange = await ackChangePromise;
    assert.equal(ackChange.accepted, true);
    assert.deepEqual(ackChange.selectedOptionIds, [secondChoice]);

    // Confirmar respuesta definitiva -> bloquea el equipo y al haber confirmado todos, pasa automáticamente a TIME_UP
    const ackConfirmPromise = waitForEvent(p1, 'game:answer_ack');
    const timeUpPromise = waitForEvent(tv, 'game:time_up');
    const tvTimeUpStatePromise = new Promise((resolve) => {
      tv.on('room:state', function onState(s) {
        if (s.state === 'TIME_UP') {
          tv.off('room:state', onState);
          resolve(s);
        }
      });
    });
    p1.emit('player:answer', {
      roomCode: tvReg.code,
      questionId: qStart.question.id,
      selectedOptionIds: [secondChoice],
      confirm: true,
    });
    const [ackConfirm, timeUp, tvTimeUpState] = await Promise.all([
      ackConfirmPromise,
      timeUpPromise,
      tvTimeUpStatePromise,
    ]);
    assert.equal(ackConfirm.accepted, true);
    assert.equal(ackConfirm.lockedByTeam, true);
    assert.equal(timeUp.questionId, qStart.question.id);
    assert.deepEqual(tvTimeUpState.game.optionPicks[secondChoice], [
      { id: j1.teamId, name: 'Equipo Alfa', color: '#ef4444', icon: '🦊' },
    ]);

    // 7. El moderador pulsa "Mostrar solución" -> REVEAL con explicación y curiosidad
    const revealPromise = waitForEvent(tv, 'game:reveal');
    host.emit('host:reveal_answer', { roomCode: tvReg.code, hostToken: claimed.hostToken });
    const reveal = await revealPromise;
    assert.ok(Array.isArray(reveal.correctOptionIds));
    assert.ok(reveal.explanation.length > 20);
    assert.ok(reveal.extraFact && reveal.extraFact.length > 10);

    // 8. El moderador pulsa "Ver resultados" -> LEADERBOARD
    const lbPromise = waitForEvent(tv, 'game:leaderboard');
    host.emit('host:show_results', { roomCode: tvReg.code, hostToken: claimed.hostToken });
    const lb = await lbPromise;
    assert.equal(lb.standings.length, 1);

    // 9. Siguiente pregunta -> el anfitrión corta el tiempo manualmente con host:end_timer
    const q2Promise = waitForEvent(tv, 'game:question_start', 6000);
    host.emit('host:next_step', { roomCode: tvReg.code, hostToken: claimed.hostToken });
    await q2Promise;

    const timeUp2Promise = waitForEvent(tv, 'game:time_up');
    host.emit('host:end_timer', { roomCode: tvReg.code, hostToken: claimed.hostToken });
    await timeUp2Promise;

    const reveal2Promise = waitForEvent(tv, 'game:reveal');
    host.emit('host:reveal_answer', { roomCode: tvReg.code, hostToken: claimed.hostToken });
    await reveal2Promise;

    const finishedPromise = waitForEvent(tv, 'game:finished');
    host.emit('host:show_results', { roomCode: tvReg.code, hostToken: claimed.hostToken });
    const finished = await finishedPromise;
    assert.equal(finished.standings.length, 1);
  });
});
