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
const TEAM_COLORS = [
  '#ef4444',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
];
const TEAM_ICONS = ['🎯', '🦊', '🦁', '🚀', '⚡', '🧠', '🐉', '👑', '🔥', '🛸'];

let selectedColor = TEAM_COLORS[0];
let selectedIcon = TEAM_ICONS[0];

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
const btnConfirmAnswer = document.getElementById('btn-confirm-answer');
const colorPickerEl = document.getElementById('team-color-picker');
const iconPickerEl = document.getElementById('team-icon-picker');

function initTeamPickers() {
  colorPickerEl.innerHTML = TEAM_COLORS.map(
    (c) =>
      `<button type="button" class="color-swatch ${c === selectedColor ? 'active' : ''}" data-color="${c}" style="background:${c};" aria-label="Color ${c}"></button>`
  ).join('');
  colorPickerEl.querySelectorAll('.color-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedColor = btn.dataset.color;
      colorPickerEl.querySelectorAll('.color-swatch').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  iconPickerEl.innerHTML = TEAM_ICONS.map(
    (ic) =>
      `<button type="button" class="icon-swatch ${ic === selectedIcon ? 'active' : ''}" data-icon="${ic}">${ic}</button>`
  ).join('');
  iconPickerEl.querySelectorAll('.icon-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedIcon = btn.dataset.icon;
      iconPickerEl.querySelectorAll('.icon-swatch').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}
initTeamPickers();
let pendingConfirm = false;
let pendingConfirmTimer = null;

function resetConfirmButton() {
  pendingConfirm = false;
  if (pendingConfirmTimer) {
    clearTimeout(pendingConfirmTimer);
    pendingConfirmTimer = null;
  }
  btnConfirmAnswer.textContent = '🔒 Enviar respuesta definitiva';
  btnConfirmAnswer.classList.remove('btn-warning');
  btnConfirmAnswer.classList.add('btn-success');
}

function updateConfirmButtonVisibility() {
  btnConfirmAnswer.classList.toggle('hidden', multiSelected.size === 0);
}

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
      color: selectedColor,
      icon: selectedIcon,
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

btnConfirmAnswer.addEventListener('click', () => {
  if (!currentQuestion || !currentRoomCode || multiSelected.size === 0) return;
  if (!pendingConfirm) {
    pendingConfirm = true;
    vibrate(25);
    btnConfirmAnswer.textContent = '✅ ¿Seguro? Toca otra vez para confirmar';
    btnConfirmAnswer.classList.remove('btn-success');
    btnConfirmAnswer.classList.add('btn-warning');
    pendingConfirmTimer = setTimeout(resetConfirmButton, 4000);
    return;
  }

  resetConfirmButton();
  vibrate(50);
  socket.emit('player:answer', {
    roomCode: currentRoomCode,
    questionId: currentQuestion.id,
    selectedOptionIds: Array.from(multiSelected),
    confirm: true,
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
  document.getElementById('player-team-header').textContent = `${data.icon || '🎯'} ${data.teamName}`;
  showToast(data.reconnected ? 'Reconectado al equipo' : '¡Dentro del concurso!', 'info', 2000);
});

socket.on('game:answer_ack', (data) => {
  if (data.lockedByTeam) {
    resetConfirmButton();
    showView(viewWait);
    document.getElementById('wait-title').textContent = '🔒 ¡Respuesta confirmada!';
    document.getElementById('wait-subtitle').textContent =
      'Tu equipo ha bloqueado su respuesta. Esperando al resto...';
    return;
  }

  const selectedSet = new Set(data.selectedOptionIds || []);
  multiSelected = selectedSet;
  document.querySelectorAll('#p-options-list .player-opt-btn').forEach((btn) => {
    btn.classList.toggle('selected', selectedSet.has(btn.dataset.optId));
  });
  updateConfirmButtonVisibility();
  const hintEl = document.getElementById('p-question-hint');
  if (hintEl) {
    hintEl.textContent =
      selectedSet.size > 0
        ? '✅ Respuesta registrada (puedes cambiarla o enviarla definitiva)'
        : 'Toca tu respuesta en la pantalla';
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
  document.getElementById('player-team-header').textContent = `${state.myTeam.icon || '🎯'} ${state.myTeam.name}`;
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
    if (state.myTeam.lockedThisRound) {
      resetConfirmButton();
      showView(viewWait);
      document.getElementById('wait-title').textContent = '🔒 ¡Respuesta confirmada!';
      document.getElementById('wait-subtitle').textContent =
        'Tu equipo ha bloqueado su respuesta. Esperando al resto...';
      return;
    }

    const q = state.game.question;
    const isSameQuestion = currentQuestion?.id === q.id && !viewQuestion.classList.contains('hidden');
    currentQuestion = q;
    const serverSelected = new Set(state.myTeam.selectedOptionIds || []);
    multiSelected = serverSelected;
    showView(viewQuestion);

    const isMulti = q.type === 'multiple_choice';
    document.getElementById('p-question-hint').textContent =
      serverSelected.size > 0
        ? '✅ Respuesta registrada (puedes cambiarla o enviarla definitiva)'
        : isMulti
        ? 'Marca todas las correctas (puedes cambiar hasta el final)'
        : q.type === 'lightning'
        ? '⚡ ¡Responde lo más rápido posible!'
        : 'Toca tu respuesta en la pantalla';

    updateConfirmButtonVisibility();

    const listEl = document.getElementById('p-options-list');
    if (!isSameQuestion) {
      resetConfirmButton();
      listEl.innerHTML = q.options
        .map((opt, idx) => {
          const letter = OPT_LETTERS[idx] || String(idx + 1);
          const isSel = serverSelected.has(opt.id) ? 'selected' : '';
          return `
            <button class="player-opt-btn opt-${letter.toLowerCase()} ${isSel}" data-opt-id="${escapeHtml(opt.id)}" type="button">
              <span class="player-opt-letter">${letter}</span>
              <span>${escapeHtml(opt.text)}</span>
            </button>`;
        })
        .join('');

      listEl.querySelectorAll('.player-opt-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const optId = btn.dataset.optId;
          resetConfirmButton();
          vibrate(35);
          if (isMulti) {
            if (multiSelected.has(optId)) {
              multiSelected.delete(optId);
            } else {
              multiSelected.add(optId);
            }
          } else {
            multiSelected = new Set([optId]);
          }

          listEl.querySelectorAll('.player-opt-btn').forEach((b) => {
            b.classList.toggle('selected', multiSelected.has(b.dataset.optId));
          });
          updateConfirmButtonVisibility();

          socket.emit('player:answer', {
            roomCode: state.code,
            questionId: q.id,
            selectedOptionIds: Array.from(multiSelected),
            confirm: false,
          });
        });
      });
    } else {
      listEl.querySelectorAll('.player-opt-btn').forEach((b) => {
        b.classList.toggle('selected', serverSelected.has(b.dataset.optId));
      });
    }

    if (state.game.endsAt && !state.game.paused) {
      stopCountdown = startCountdown(state.game.endsAt, q.timeLimit, ({ secondsLeft }) => {
        document.getElementById('p-timer-seconds').textContent = secondsLeft;
      });
    }
    return;
  }

  if (state.state === 'TIME_UP') {
    showView(viewWait);
    document.getElementById('wait-title').textContent = '⏱️ ¡Se acabó el tiempo!';
    document.getElementById('wait-subtitle').textContent =
      'Mira la TV: el moderador mostrará la solución en unos instantes.';
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

