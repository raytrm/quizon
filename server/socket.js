import { GameEngine, buildStandings } from './game-engine.js';
import { QuestionStore } from './question-store.js';
import { generateQrDataUrl } from './qr.js';

/**
 * Registra todos los manejadores de eventos Socket.IO.
 */
export function registerSocketHandlers(io, roomManager, questionStore, getBaseUrl) {
  /** @type {Map<string, GameEngine>} roomCode -> GameEngine */
  const engines = new Map();

  function getOrCreateEngine(room) {
    let engine = engines.get(room.code);
    if (!engine) {
      engine = new GameEngine(
        room,
        questionStore,
        (event, payload) => {
          if (event === 'room:state_refresh') {
            broadcastRoomState(room);
          } else {
            io.to(room.code).emit(event, payload);
          }
        },
        (socketId, event, payload) => {
          io.to(socketId).emit(event, payload);
        }
      );
      engines.set(room.code, engine);
    }
    return engine;
  }

  async function buildQrPayloads(room) {
    const base = getBaseUrl();
    const hostUrl = `${base}/host?code=${room.code}`;
    const playerUrl = `${base}/player?code=${room.code}`;
    const [hostQr, playerQr] = await Promise.all([
      generateQrDataUrl(hostUrl),
      generateQrDataUrl(playerUrl),
    ]);
    return { hostUrl, playerUrl, hostQr, playerQr };
  }

  function buildStateSnapshot(room, role, teamId = null) {
    const g = room.game;
    const currentQ = g ? g.questions[g.currentIndex] : null;
    const teams = roomManager.serializeTeams(room);
    const standings = buildStandings(room.teams.values());

    let questionPayload = null;
    if (
      currentQ &&
      (room.state === 'QUESTION_ACTIVE' || room.state === 'TIME_UP' || room.state === 'REVEAL')
    ) {
      questionPayload = QuestionStore.sanitizeForClient(currentQ, questionStore.catalogId);
      if (g.effectiveTimeLimit) {
        questionPayload.timeLimit = g.effectiveTimeLimit;
      }
      if (room.state === 'REVEAL') {
        questionPayload.correctOptionIds = currentQ.correctOptionIds;
        questionPayload.explanation = currentQ.explanation || '';
        questionPayload.extraFact = currentQ.extraFact || null;
        questionPayload.media.explain = currentQ.resolvedMedia?.explain || [];
        questionPayload.media.audio.explain = currentQ.resolvedMedia?.audio?.explain || [];
      }
    }

    let optionPicks = null;
    if (
      currentQ &&
      (room.state === 'TIME_UP' || room.state === 'REVEAL') &&
      (role === 'tv' || role === 'host')
    ) {
      optionPicks = {};
      for (const opt of currentQ.options) {
        optionPicks[opt.id] = [];
      }
      for (const [tId, ans] of g.roundAnswers.entries()) {
        const team = room.teams.get(tId);
        if (!team) continue;
        for (const optId of ans.selectedOptionIds || []) {
          if (optionPicks[optId]) {
            optionPicks[optId].push({
              id: team.id,
              name: team.name,
              color: team.color || '#6366f1',
              icon: team.icon || '🎯',
            });
          }
        }
      }
    }

    let teamState = null;
    if (role === 'player' && teamId) {
      const team = room.teams.get(teamId);
      const ans = g?.roundAnswers.get(teamId);
      const standing = standings.find((s) => s.id === teamId);
      if (team) {
        teamState = {
          id: team.id,
          name: team.name,
          members: team.members,
          color: team.color || '#6366f1',
          icon: team.icon || '🎯',
          score: team.score,
          rank: standing?.rank || null,
          answeredThisRound: Boolean(ans),
          lockedThisRound: Boolean(ans?.locked),
          selectedOptionIds: ans?.selectedOptionIds || [],
          lastRoundPoints: ans?.points ?? null,
          lastRoundCorrect: ans?.isCorrect ?? null,
        };
      }
    }

    return {
      code: room.code,
      state: room.state,
      hasHost: Boolean(room.hostToken),
      hostConnected: Boolean(room.hostSocketId),
      config: room.config,
      audio: room.audio,
      teams,
      standings,
      game: g
        ? {
            index: g.currentIndex + 1,
            total: g.questions.length,
            paused: g.paused,
            endsAt: g.endsAt,
            answeredCount: g.roundAnswers.size,
            question: questionPayload,
            optionPicks,
            questionType: currentQ?.type || null,
            questionCategory: currentQ?.category || null,
          }
        : null,
      myTeam: teamState,
    };
  }

  function broadcastRoomState(room) {
    if (room.tvSocketId) {
      io.to(room.tvSocketId).emit('room:state', buildStateSnapshot(room, 'tv'));
    }
    if (room.hostSocketId) {
      io.to(room.hostSocketId).emit('room:state', buildStateSnapshot(room, 'host'));
    }
    for (const team of room.teams.values()) {
      const snap = buildStateSnapshot(room, 'player', team.id);
      for (const sid of team.sockets) {
        io.to(sid).emit('room:state', snap);
      }
    }
  }

  io.on('connection', (socket) => {
    // 1. TV se registra (crea sala nueva o reconecta a una existente)
    socket.on('tv:register', async ({ roomCode } = {}) => {
      try {
        let room = roomCode ? roomManager.attachTv(roomCode, socket.id) : null;
        if (!room) {
          room = roomManager.createRoomForTv(socket.id);
        }
        socket.join(room.code);
        getOrCreateEngine(room);

        const qr = await buildQrPayloads(room);
        socket.emit('tv:registered', {
          code: room.code,
          ...qr,
          packs: questionStore.getPacksSummary(),
        });
        socket.emit('room:state', buildStateSnapshot(room, 'tv'));
      } catch (err) {
        socket.emit('room:error', { code: 'TV_REGISTER_ERROR', message: err.message });
      }
    });

    // 2. Anfitrión reclama o reconecta a la sala
    socket.on('host:claim_room', ({ roomCode, hostToken } = {}) => {
      const res = roomManager.claimHost(roomCode, socket.id, hostToken);
      if (res.error) {
        socket.emit('room:error', { code: res.error, message: res.message });
        return;
      }

      const { room } = res;
      socket.join(room.code);
      getOrCreateEngine(room);

      socket.emit('host:claimed', {
        code: room.code,
        hostToken: res.hostToken,
        packs: questionStore.getPacksSummary(),
      });
      broadcastRoomState(room);
    });

    // 3. Anfitrión actualiza configuración
    socket.on('host:update_config', ({ roomCode, hostToken, config } = {}) => {
      const room = roomManager.getRoom(roomCode);
      if (!roomManager.validateHost(room, hostToken)) {
        socket.emit('room:error', { code: 'UNAUTHORIZED', message: 'No autorizado como anfitrión.' });
        return;
      }
      if (room.state !== 'LOBBY' && room.state !== 'LOBBY_UNCLAIMED') return;

      room.config = {
        ...room.config,
        title: String(config?.title || room.config.title).trim().slice(0, 50) || 'Noche de QUIZÓN',
        packId: config?.packId || room.config.packId,
        questionCount: Math.max(1, Math.min(50, Number(config?.questionCount) || room.config.questionCount)),
        timeMultiplier: Math.max(
          0.5,
          Math.min(3.0, Number(config?.timeMultiplier ?? room.config.timeMultiplier) || 1.0)
        ),
        autoAdvance: Boolean(config?.autoAdvance),
        lateJoin: config?.lateJoin !== undefined ? Boolean(config.lateJoin) : room.config.lateJoin,
      };
      broadcastRoomState(room);
    });

    // 4. Anfitrión inicia partida
    socket.on('host:start_game', ({ roomCode, hostToken } = {}) => {
      const room = roomManager.getRoom(roomCode);
      if (!roomManager.validateHost(room, hostToken)) {
        socket.emit('room:error', { code: 'UNAUTHORIZED', message: 'No autorizado.' });
        return;
      }
      const engine = getOrCreateEngine(room);
      const res = engine.startGame();
      if (res?.error) {
        socket.emit('room:error', { code: res.error, message: res.message });
      }
    });

    // 5. Anfitrión avanza paso / controles explícitos de tiempo, solución y resultados
    socket.on('host:next_step', ({ roomCode, hostToken } = {}) => {
      const room = roomManager.getRoom(roomCode);
      if (!roomManager.validateHost(room, hostToken)) return;
      getOrCreateEngine(room).nextStep();
    });

    socket.on('host:end_timer', ({ roomCode, hostToken } = {}) => {
      const room = roomManager.getRoom(roomCode);
      if (!roomManager.validateHost(room, hostToken)) return;
      getOrCreateEngine(room).endTimerNow();
    });

    socket.on('host:reveal_answer', ({ roomCode, hostToken } = {}) => {
      const room = roomManager.getRoom(roomCode);
      if (!roomManager.validateHost(room, hostToken)) return;
      getOrCreateEngine(room).revealAnswer();
    });

    socket.on('host:show_results', ({ roomCode, hostToken } = {}) => {
      const room = roomManager.getRoom(roomCode);
      if (!roomManager.validateHost(room, hostToken)) return;
      getOrCreateEngine(room).showResults();
    });

    socket.on('host:next_question', ({ roomCode, hostToken } = {}) => {
      const room = roomManager.getRoom(roomCode);
      if (!roomManager.validateHost(room, hostToken)) return;
      getOrCreateEngine(room).skipToNextQuestion();
    });

    // 6. Anfitrión pausa/reanuda
    socket.on('host:pause_toggle', ({ roomCode, hostToken } = {}) => {
      const room = roomManager.getRoom(roomCode);
      if (!roomManager.validateHost(room, hostToken)) return;
      getOrCreateEngine(room).togglePause();
    });

    // 7. Anfitrión finaliza o vuelve al lobby
    socket.on('host:finish_game', ({ roomCode, hostToken } = {}) => {
      const room = roomManager.getRoom(roomCode);
      if (!roomManager.validateHost(room, hostToken)) return;
      getOrCreateEngine(room).finishNow();
    });

    socket.on('host:play_again', ({ roomCode, hostToken } = {}) => {
      const room = roomManager.getRoom(roomCode);
      if (!roomManager.validateHost(room, hostToken)) return;
      getOrCreateEngine(room).resetToLobby();
    });

    // 8. Anfitrión expulsa a un equipo
    socket.on('host:kick_team', ({ roomCode, hostToken, teamId } = {}) => {
      const room = roomManager.getRoom(roomCode);
      if (!roomManager.validateHost(room, hostToken)) return;
      const kicked = roomManager.kickTeam(roomCode, teamId);
      if (!kicked) return;

      for (const sid of kicked.kickedSockets) {
        io.to(sid).emit('room:kicked', { message: 'Tu equipo ha sido retirado de la sala por el anfitrión.' });
        const s = io.sockets.sockets.get(sid);
        if (s) s.leave(room.code);
      }
      io.to(room.code).emit('room:teams_updated', { teams: roomManager.serializeTeams(room) });
      broadcastRoomState(room);
    });

    // 9. Control remoto de audio de la TV
    socket.on('host:tv_audio', ({ roomCode, hostToken, muted, volume } = {}) => {
      const room = roomManager.getRoom(roomCode);
      if (!roomManager.validateHost(room, hostToken)) return;
      room.audio = {
        muted: Boolean(muted),
        volume: Math.max(0, Math.min(1, Number(volume ?? room.audio.volume))),
      };
      if (room.tvSocketId) {
        io.to(room.tvSocketId).emit('tv:audio_settings', room.audio);
      }
      broadcastRoomState(room);
    });

    // 10. Consultar equipos existentes de una sala (para el desplegable en /player)
    socket.on('player:list_teams', ({ roomCode } = {}) => {
      const room = roomManager.getRoom(roomCode);
      if (!room) {
        socket.emit('room:error', { code: 'ROOM_NOT_FOUND', message: 'No existe ninguna sala con ese código.' });
        return;
      }
      socket.emit('player:teams_list', {
        code: room.code,
        title: room.config.title,
        teams: roomManager.serializeTeams(room),
      });
    });

    // 11. Equipo se une o reconecta
    socket.on('player:join', (payload = {}) => {
      const res = roomManager.joinTeam(payload.roomCode, socket.id, payload);
      if (res.error) {
        socket.emit('room:error', { code: res.error, message: res.message });
        return;
      }

      const { room, team, sessionToken, reconnected } = res;
      socket.join(room.code);

      socket.emit('player:joined', {
        code: room.code,
        teamId: team.id,
        teamName: team.name,
        members: team.members,
        color: team.color,
        icon: team.icon,
        sessionToken,
        reconnected,
      });

      io.to(room.code).emit('room:teams_updated', { teams: roomManager.serializeTeams(room) });
      broadcastRoomState(room);
    });

    // 12. Selección temporal en multiple_choice
    socket.on('player:selection_changed', ({ roomCode, questionId, selectedOptionIds } = {}) => {
      const info = roomManager.socketIndex.get(socket.id);
      if (!info || info.role !== 'player' || info.roomCode !== roomCode) return;
      const room = roomManager.getRoom(roomCode);
      if (!room) return;
      getOrCreateEngine(room).updateDraftSelection(info.teamId, questionId, selectedOptionIds);
    });

    // 13. Envío de respuesta oficial del equipo (con confirmación opcional)
    socket.on('player:answer', ({ roomCode, questionId, selectedOptionIds, confirm } = {}) => {
      const info = roomManager.socketIndex.get(socket.id);
      if (!info || info.role !== 'player' || info.roomCode !== roomCode) return;
      const room = roomManager.getRoom(roomCode);
      if (!room) return;
      getOrCreateEngine(room).submitAnswer(info.teamId, socket.id, questionId, selectedOptionIds, {
        confirm: Boolean(confirm),
      });
    });

    // 14. Desconexión
    socket.on('disconnect', () => {
      const res = roomManager.handleDisconnect(socket.id);
      if (!res) return;
      io.to(res.room.code).emit('room:teams_updated', {
        teams: roomManager.serializeTeams(res.room),
      });
      broadcastRoomState(res.room);
    });
  });

  return { engines };
}

