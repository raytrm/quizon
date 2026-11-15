import { createSocketConnection } from './common/connection.js';
import { escapeHtml, getQueryParam, registerServiceWorker, showToast } from './common/utils.js';

registerServiceWorker();

const socket = createSocketConnection();
const STORAGE_KEY = 'quizon_host_session';
let hostSession = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
let currentRoomCode = null;
let currentHostToken = null;
let currentRoomState = null;
let tvMuted = false;

const viewClaim = document.getElementById('h-view-claim');
const viewLobby = document.getElementById('h-view-lobby');
const viewLive = document.getElementById('h-view-live');
const audioCard = document.getElementById('h-audio-card');

const inputCode = document.getElementById('host-input-code');
const cfgPack = document.getElementById('cfg-pack');
const cfgTimeMult = document.getElementById('cfg-time-mult');
const cfgTimeMultLabel = document.getElementById('cfg-time-mult-label');

cfgTimeMult.addEventListener('input', () => {
  cfgTimeMultLabel.textContent = `${Number(cfgTimeMult.value).toFixed(2).replace(/\.00$/, '.0')}x`;
});

function populatePacks(packs) {
  cfgPack.innerHTML = packs
    .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)} (${p.questionCount})</option>`)
    .join('');
}

document.getElementById('btn-claim-room').addEventListener('click', () => {
  const code = inputCode.value.trim();
  if (code.length !== 6) {
    showToast('Introduce el código de 6 dígitos que aparece en la TV');
    return;
  }
  socket.emit('host:claim_room', { roomCode: code });
});

function getConfigPayload() {
  return {
    title: document.getElementById('cfg-title').value,
    packId: cfgPack.value,
    questionCount: Number(document.getElementById('cfg-count').value),
    timeMultiplier: Number(cfgTimeMult.value),
    autoAdvance: document.getElementById('cfg-auto').checked,
    lateJoin: document.getElementById('cfg-late').checked,
  };
}

document.getElementById('btn-save-config').addEventListener('click', () => {
  if (!currentRoomCode) return;
  socket.emit('host:update_config', {
    roomCode: currentRoomCode,
    hostToken: currentHostToken,
    config: getConfigPayload(),
  });
  showToast('Configuración guardada', 'info', 1800);
});

document.getElementById('btn-start-game').addEventListener('click', () => {
  socket.emit('host:update_config', {
    roomCode: currentRoomCode,
    hostToken: currentHostToken,
    config: getConfigPayload(),
  });
  socket.emit('host:start_game', {
    roomCode: currentRoomCode,
    hostToken: currentHostToken,
  });
});

document.getElementById('btn-end-timer').addEventListener('click', () => {
  socket.emit('host:end_timer', { roomCode: currentRoomCode, hostToken: currentHostToken });
});

document.getElementById('btn-reveal-answer').addEventListener('click', () => {
  socket.emit('host:reveal_answer', { roomCode: currentRoomCode, hostToken: currentHostToken });
});

document.getElementById('btn-show-results').addEventListener('click', () => {
  socket.emit('host:show_results', { roomCode: currentRoomCode, hostToken: currentHostToken });
});

document.getElementById('btn-next-step').addEventListener('click', () => {
  const eventName = currentRoomState === 'REVEAL' ? 'host:next_question' : 'host:next_step';
  socket.emit(eventName, { roomCode: currentRoomCode, hostToken: currentHostToken });
});

document.getElementById('btn-pause-toggle').addEventListener('click', () => {
  socket.emit('host:pause_toggle', { roomCode: currentRoomCode, hostToken: currentHostToken });
});

document.getElementById('btn-finish-now').addEventListener('click', () => {
  socket.emit('host:finish_game', { roomCode: currentRoomCode, hostToken: currentHostToken });
});

document.getElementById('btn-play-again').addEventListener('click', () => {
  socket.emit('host:play_again', { roomCode: currentRoomCode, hostToken: currentHostToken });
});

document.getElementById('btn-tv-mute').addEventListener('click', () => {
  tvMuted = !tvMuted;
  socket.emit('host:tv_audio', {
    roomCode: currentRoomCode,
    hostToken: currentHostToken,
    muted: tvMuted,
    volume: Number(document.getElementById('range-tv-volume').value),
  });
});

document.getElementById('range-tv-volume').addEventListener('input', (e) => {
  socket.emit('host:tv_audio', {
    roomCode: currentRoomCode,
    hostToken: currentHostToken,
    muted: tvMuted,
    volume: Number(e.target.value),
  });
});

socket.on('connect', () => {
  const urlCode = getQueryParam('code');
  if (urlCode) {
    inputCode.value = urlCode;
    const token = hostSession?.roomCode === urlCode ? hostSession.hostToken : undefined;
    socket.emit('host:claim_room', { roomCode: urlCode, hostToken: token });
  } else if (hostSession?.roomCode && hostSession?.hostToken) {
    socket.emit('host:claim_room', {
      roomCode: hostSession.roomCode,
      hostToken: hostSession.hostToken,
    });
  }
});

socket.on('host:claimed', (data) => {
  currentRoomCode = data.code;
  currentHostToken = data.hostToken;
  hostSession = { roomCode: data.code, hostToken: data.hostToken };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hostSession));

  populatePacks(data.packs || []);
  viewClaim.classList.add('hidden');
  audioCard.classList.remove('hidden');
  document.getElementById('host-room-label').textContent = `Sala activa: ${data.code}`;
});

socket.on('room:state', (state) => {
  if (!currentRoomCode) return;

  document.getElementById('host-state-badge').textContent = state.state;
  tvMuted = Boolean(state.audio?.muted);
  document.getElementById('btn-tv-mute').textContent = tvMuted ? 'Activar sonido' : 'Silenciar';

  const inLobby = state.state === 'LOBBY' || state.state === 'LOBBY_UNCLAIMED';
  viewLobby.classList.toggle('hidden', !inLobby);
  viewLive.classList.toggle('hidden', inLobby);

  if (inLobby) {
    document.getElementById('host-team-count').textContent = state.teams.length;
    const listEl = document.getElementById('host-teams-list');
    listEl.innerHTML = state.teams.length
      ? state.teams
          .map(
            (t) => `
          <div class="host-team-item">
            <div>
              <strong>${escapeHtml(t.name)}</strong>
              <div style="font-size: 0.82rem; color: var(--text-muted);">${
                t.members?.length ? escapeHtml(t.members.join(', ')) : 'Sin lista de integrantes'
              }</div>
            </div>
            <button class="btn btn-danger" data-kick-id="${escapeHtml(t.id)}" type="button" style="padding: 0.45rem 0.75rem; font-size: 0.85rem;">
              Expulsar
            </button>
          </div>`
          )
          .join('')
      : '<p style="color: var(--text-muted);">Aún no hay equipos conectados.</p>';

    listEl.querySelectorAll('[data-kick-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        socket.emit('host:kick_team', {
          roomCode: currentRoomCode,
          hostToken: currentHostToken,
          teamId: btn.dataset.kickId,
        });
      });
    });
  } else if (state.game) {
    document.getElementById('live-progress').textContent = `Pregunta ${state.game.index} / ${state.game.total}`;
    document.getElementById('live-answered').textContent = `${state.game.answeredCount} / ${
      state.teams.filter((t) => t.connected).length
    } respuestas`;
    document.getElementById('live-prompt').textContent =
      state.game.question?.prompt || 'Preparando pregunta...';
    document.getElementById('btn-pause-toggle').textContent = state.game.paused
      ? '▶️ Reanudar'
      : '⏸️ Pausar';

    currentRoomState = state.state;
    const isFinished = state.state === 'FINISHED';
    const hasMoreQuestions = state.game.index < state.game.total;
    document.getElementById('btn-end-timer').classList.toggle('hidden', state.state !== 'QUESTION_ACTIVE');
    document.getElementById('btn-reveal-answer').classList.toggle('hidden', state.state !== 'TIME_UP');
    document.getElementById('btn-show-results').classList.toggle('hidden', state.state !== 'REVEAL');
    document
      .getElementById('btn-next-step')
      .classList.toggle('hidden', state.state !== 'LEADERBOARD' && !(state.state === 'REVEAL' && hasMoreQuestions));
    document.getElementById('btn-play-again').classList.toggle('hidden', !isFinished);
    document.getElementById('btn-pause-toggle').classList.toggle(
      'hidden',
      state.state !== 'QUESTION_ACTIVE' && state.state !== 'LEADERBOARD'
    );
  }
});

socket.on('room:error', (err) => {
  showToast(err.message || 'Error');
});

