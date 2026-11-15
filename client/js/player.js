import { createSocketConnection } from './common/connection.js';
import {
  escapeHtml,
  getQueryParam,
  registerServiceWorker,
  showToast,
  startCountdown,
  vibrate,
} from './common/utils.js';

registerServiceWorker();

const socket = createSocketConnection();
const OPT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const STORAGE_KEY = 'quizon_player_session';
let session = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
let createMode = true;
let currentRoomCode = null;
let currentQuestion = null;
let multiSelected = new Set();
let stopCountdown = null;

// Vistas
const viewJoin = document.getElementById('p-view-join');
const viewWait = document.getElementById('p-view-wait');
const viewQuestion = document.getElementById('p-view-question');
const viewResult = document.getElementById('p-view-result');

const inputRoomCode = document.getElementById('input-room-code');
const tabCreate = document.getElementById('tab-create-team');
const tabJoin = document.getElementById('tab-join-team');
const panelCreate = document.getElementById('panel-create-team');
const panelJoin = document.getElementById('panel-join-team');
const selectExistingTeam = document.getElementById('select-existing-team');
const btnConfirmMulti = document.getElementById('btn-confirm-multi');

function showView(view) {
  [viewJoin, viewWait, viewQuestion, viewResult].forEach((v) => v.classList.add('hidden'));
  view.classList.remove('hidden');
}

function setMode(isCreate) {
  createMode = isCreate;
  tabCreate.classList.toggle('active', isCreate);
  tabJoin.classList.toggle('active', !isCreate);
  panelCreate.classList.toggle('hidden', !isCreate);
  panelJoin.classList.toggle('hidden', isCreate);
  if (!isCreate && inputRoomCode.value.trim().length === 6) {
    socket.emit('player:list_teams', { roomCode: inputRoomCode.value.trim() });
  }
}

tabCreate.addEventListener('click', () => setMode(true));
tabJoin.addEventListener('click', () => setMode(false));

document.getElementById('btn-check-room').addEventListener('click', () => {
  const code = inputRoomCode.value.trim();
  if (code.length !== 6) {
    showToast('Introduce un código de 6 dígitos');
    return;
  }
  socket.emit('player:list_teams', { roomCode: code });
});

document.getElementById('btn-join-game').addEventListener('click', () => {
  const code = inputRoomCode.value.trim();
  if (code.length !== 6) {
    showToast('El código debe tener 6 dígitos');
    return;
  }

  if (createMode) {
    const teamName = document.getElementById('input-team-name').value.trim();
    const membersRaw = document.getElementById('input-team-members').value;
    const members = membersRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    socket.emit('player:join', {
      roomCode: code,
      teamName,
      members,
      createTeam: true,
    });
  } else {
    const teamName = selectExistingTeam.value;
    if (!teamName) {
      showToast('Selecciona un equipo de la lista');
      return;
    }
    socket.emit('player:join', {
      roomCode: code,
      teamName,
      createTeam: false,
    });
  }
});

btnConfirmMulti.addEventListener('click', () => {
  if (!currentQuestion || !currentRoomCode) return;
  vibrate(40);
  socket.emit('player:answer', {
    roomCode: currentRoomCode,
    questionId: currentQuestion.id,
    selectedOptionIds: Array.from(multiSelected),
  });
});

socket.on('connect', () => {
  const urlCode = getQueryParam('code');
  if (urlCode) {
    inputRoomCode.value = urlCode;
    socket.emit('player:list_teams', { roomCode: urlCode });
  }

  // Reconexión automática si hay sesión guardada para esa sala (o sin urlCode)
  if (session?.sessionToken && session?.roomCode && (!urlCode || urlCode === session.roomCode)) {
    socket.emit('player:join', {
      roomCode: session.roomCode,
      sessionToken: session.sessionToken,
    });
  }
});

socket.on('player:teams_list', ({ teams }) => {
  if (!teams.length) {
    selectExistingTeam.innerHTML = '<option value="">Aún no hay equipos en esta sala</option>';
    return;
  }
  selectExistingTeam.innerHTML = teams
    .map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`)
    .join('');
});

socket.on('player:joined', (data) => {
  currentRoomCode = data.code;
  session = { roomCode: data.code, sessionToken: data.sessionToken, teamId: data.teamId };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  document.getElementById('player-team-header').textContent = `Equipo: ${data.teamName}`;
  showToast(data.reconnected ? 'Reconectado al equipo' : '¡Dentro del concurso!', 'info', 2000);
});

socket.on('game:answer_ack', (data) => {
  if (data.lockedByTeam) {
    showView(viewWait);
    document.getElementById('wait-title').textContent = data.accepted
      ? '¡Respuesta enviada!'
      : '¡Tu equipo ya respondió!';
    document.getElementById('wait-subtitle').textContent = 'Esperando al resto de equipos...';
  }
});

socket.on('room:kicked', (data) => {
  localStorage.removeItem(STORAGE_KEY);
  session = null;
  currentRoomCode = null;
  showView(viewJoin);
  showToast(data.message || 'Has sido expulsado de la sala');
});

socket.on('room:state', (state) => {
  if (!state.myTeam) return;

  currentRoomCode = state.code;
  document.getElementById('player-team-header').textContent = `Equipo: ${state.myTeam.name}`;
  document.getElementById('player-score-badge').textContent = `${state.myTeam.score} pts`;

  if (stopCountdown) {
    stopCountdown();
    stopCountdown = null;
  }

  if (state.state === 'LOBBY' || state.state === 'LOBBY_UNCLAIMED') {
    showView(viewWait);
    document.getElementById('wait-title').textContent = `Equipo "${state.myTeam.name}" listo`;
    document.getElementById('wait-subtitle').textContent = 'Esperando a que el anfitrión inicie...';
    return;
  }

  if (state.state === 'QUESTION_INTRO') {
    showView(viewWait);
    document.getElementById('wait-title').textContent = `Pregunta ${state.game.index} de ${state.game.total}`;
    document.getElementById('wait-subtitle').textContent = state.game.questionCategory || '¡Prepárate!';
    return;
  }

  if (state.state === 'QUESTION_ACTIVE') {
    if (state.myTeam.answeredThisRound) {
      showView(viewWait);
      document.getElementById('wait-title').textContent = '¡Respuesta registrada!';
      document.getElementById('wait-subtitle').textContent = 'Esperando a que termine el tiempo...';
      return;
    }

    const q = state.game.question;
    currentQuestion = q;
    multiSelected = new Set();
    showView(viewQuestion);

    const isMulti = q.type === 'multiple_choice';
    document.getElementById('p-question-hint').textContent = isMulti
      ? 'Selecciona todas las correctas y pulsa Confirmar'
      : q.type === 'lightning'
      ? '⚡ ¡Responde lo más rápido posible!'
      : 'Toca tu respuesta en la pantalla';

    btnConfirmMulti.classList.toggle('hidden', !isMulti);

    const listEl = document.getElementById('p-options-list');
    listEl.innerHTML = q.options
      .map((opt, idx) => {
        const letter = OPT_LETTERS[idx] || String(idx + 1);
        return `
          <button class="player-opt-btn opt-${letter.toLowerCase()}" data-opt-id="${escapeHtml(opt.id)}" type="button">
            <span class="player-opt-letter">${letter}</span>
            <span>${escapeHtml(opt.text)}</span>
          </button>`;
      })
      .join('');

    listEl.querySelectorAll('.player-opt-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const optId = btn.dataset.optId;
        if (isMulti) {
          if (multiSelected.has(optId)) {
            multiSelected.delete(optId);
            btn.classList.remove('selected');
          } else {
            multiSelected.add(optId);
            btn.classList.add('selected');
          }
          socket.emit('player:selection_changed', {
            roomCode: state.code,
            questionId: q.id,
            selectedOptionIds: Array.from(multiSelected),
          });
        } else {
          vibrate(35);
          socket.emit('player:answer', {
            roomCode: state.code,
            questionId: q.id,
            selectedOptionIds: [optId],
          });
        }
      });
    });

    if (state.game.endsAt && !state.game.paused) {
      stopCountdown = startCountdown(state.game.endsAt, q.timeLimit, ({ secondsLeft }) => {
        document.getElementById('p-timer-seconds').textContent = secondsLeft;
      });
    }
    return;
  }

  if (state.state === 'REVEAL') {
    showView(viewResult);
    const pts = state.myTeam.lastRoundPoints ?? 0;
    const ok = state.myTeam.lastRoundCorrect;
    if (ok) {
      vibrate([40, 40, 60]);
      document.getElementById('result-emoji').textContent = '🎉';
      document.getElementById('result-title').textContent = '¡Respuesta Correcta!';
    } else if (pts > 0) {
      document.getElementById('result-emoji').textContent = '👍';
      document.getElementById('result-title').textContent = '¡Acierto parcial!';
    } else {
      document.getElementById('result-emoji').textContent = '😅';
      document.getElementById('result-title').textContent = 'Sin puntos esta ronda';
    }
    document.getElementById('result-points').textContent = `+${pts} pts`;
    document.getElementById('result-rank').textContent = `Posición actual: #${state.myTeam.rank || '-'} (${state.myTeam.score} pts totales)`;
    return;
  }

  if (state.state === 'LEADERBOARD' || state.state === 'FINISHED') {
    showView(viewResult);
    document.getElementById('result-emoji').textContent = state.myTeam.rank === 1 ? '🏆' : '📊';
    document.getElementById('result-title').textContent =
      state.state === 'FINISHED' ? '¡Fin del Concurso!' : 'Clasificación';
    document.getElementById('result-points').textContent = `${state.myTeam.score} pts`;
    document.getElementById('result-rank').textContent = `Posición: #${state.myTeam.rank || '-'}`;
  }
});

socket.on('room:error', (err) => {
  showToast(err.message || 'Error en la sala');
});

