import { createSocketConnection } from './common/connection.js';
import { QuizonAudio } from './common/audio.js';
import {
  escapeHtml,
  getQueryParam,
  registerServiceWorker,
  showToast,
  startCountdown,
} from './common/utils.js';

registerServiceWorker();

const socket = createSocketConnection();
const audio = new QuizonAudio();

const TYPE_LABELS = {
  single_choice: 'Opción múltiple',
  multiple_choice: 'Varias respuestas correctas',
  true_false: 'Verdadero o Falso',
  visual: 'Pregunta Visual',
  lightning: '⚡ ¡Relámpago! (×1.5)',
};

const OPT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

let qrData = { hostQr: '', playerQr: '', hostUrl: '', playerUrl: '' };
let stopCountdown = null;
let lastTickSecond = null;
let lastRenderedState = null;

// Elementos
const elHeaderCode = document.getElementById('tv-header-code');
const elMatchTitle = document.getElementById('tv-match-title');
const elRoundBadge = document.getElementById('tv-round-badge');

const viewLobby = document.getElementById('view-lobby');
const viewIntro = document.getElementById('view-intro');
const viewQuestion = document.getElementById('view-question');
const viewLeaderboard = document.getElementById('view-leaderboard');
const viewFinished = document.getElementById('view-finished');
const overlayPaused = document.getElementById('overlay-paused');
const overlayAudio = document.getElementById('overlay-audio');

document.getElementById('btn-unlock-audio').addEventListener('click', async () => {
  await audio.unlock();
  audio.playReveal();
  overlayAudio.classList.add('hidden');
});

document.getElementById('btn-skip-audio').addEventListener('click', () => {
  overlayAudio.classList.add('hidden');
});

function showOnlySection(section) {
  [viewLobby, viewIntro, viewQuestion, viewLeaderboard, viewFinished].forEach((s) =>
    s.classList.add('hidden')
  );
  section.classList.remove('hidden');
}

function renderLobby(state) {
  showOnlySection(viewLobby);
  const isUnclaimed = state.state === 'LOBBY_UNCLAIMED';

  document.getElementById('lobby-qr-badge').textContent = isUnclaimed
    ? 'Paso 1: Anfitrión'
    : 'Paso 2: Equipos';
  document.getElementById('lobby-qr-instruction').innerHTML = isUnclaimed
    ? 'Escanea el QR o abre <strong>/host</strong> e introduce este código para tomar el control:'
    : 'Escanea el QR o entra en <strong>/player</strong> para crear o unirte a un equipo:';

  document.getElementById('lobby-qr-img').src = isUnclaimed ? qrData.hostQr : qrData.playerQr;
  document.getElementById('lobby-url-hint').textContent = isUnclaimed
    ? qrData.hostUrl
    : qrData.playerUrl;
  document.getElementById('lobby-code-big').textContent = state.code;

  const hostBadge = document.getElementById('lobby-host-status');
  if (state.hostConnected) {
    hostBadge.textContent = 'Anfitrión conectado ✓';
    hostBadge.style.borderColor = '#22c55e';
  } else if (state.hasHost) {
    hostBadge.textContent = 'Anfitrión reconectando...';
  } else {
    hostBadge.textContent = 'Esperando anfitrión...';
  }

  document.getElementById('lobby-team-count').textContent = state.teams.length;
  const grid = document.getElementById('lobby-teams-grid');
  grid.innerHTML = state.teams
    .map(
      (t) => `
      <div class="team-chip anim-pop">
        <div class="team-chip-name">${escapeHtml(t.name)} ${t.connected ? '' : ' (desconectado)'}</div>
        <div class="team-chip-members">${
          t.members?.length ? escapeHtml(t.members.join(', ')) : 'Equipo conectado'
        }</div>
      </div>`
    )
    .join('');
}

function renderQuestionAndReveal(state) {
  showOnlySection(viewQuestion);
  const q = state.game.question;
  if (!q) return;

  const isReveal = state.state === 'REVEAL';
  const typeBadge = document.getElementById('q-type-badge');
  typeBadge.textContent = TYPE_LABELS[q.type] || 'Pregunta';
  typeBadge.className = q.type === 'lightning' ? 'badge lightning anim-lightning' : 'badge';

  document.getElementById('q-prompt').textContent = q.prompt;
  document.getElementById('q-answered-pill').textContent = `${state.game.answeredCount} / ${
    state.teams.filter((t) => t.connected).length
  } equipos`;

  const mediaWrap = document.getElementById('q-media-wrap');
  const mediaImg = document.getElementById('q-media-img');
  if (q.media?.questionImage) {
    mediaImg.src = q.media.questionImage;
    mediaWrap.classList.remove('hidden');
  } else {
    mediaWrap.classList.add('hidden');
  }

  const optionsGrid = document.getElementById('q-options-grid');
  const correctSet = new Set(q.correctOptionIds || []);
  optionsGrid.innerHTML = q.options
    .map((opt, idx) => {
      const letter = OPT_LETTERS[idx] || String(idx + 1);
      const colorClass = `opt-${letter.toLowerCase()}`;
      let extraClass = '';
      if (isReveal) {
        extraClass = correctSet.has(opt.id) ? 'correct-highlight' : 'dimmed';
      }
      return `
        <div class="tv-option ${colorClass} ${extraClass}">
          <div class="tv-option-letter">${letter}</div>
          <div>${escapeHtml(opt.text)}</div>
        </div>
      `;
    })
    .join('');

  const revealBox = document.getElementById('q-reveal-box');
  if (isReveal) {
    revealBox.classList.remove('hidden');
    document.getElementById('q-explanation').textContent = q.explanation || '';
    const extraEl = document.getElementById('q-extra-fact');
    if (q.extraFact) {
      extraEl.textContent = `✨ ${q.extraFact}`;
      extraEl.classList.remove('hidden');
    } else {
      extraEl.classList.add('hidden');
    }
    const revImg = document.getElementById('q-reveal-img');
    if (q.media?.revealImage && q.media.revealImage !== q.media.questionImage) {
      revImg.src = q.media.revealImage;
      revImg.classList.remove('hidden');
    } else {
      revImg.classList.add('hidden');
    }
  } else {
    revealBox.classList.add('hidden');
  }

  if (stopCountdown) {
    stopCountdown();
    stopCountdown = null;
  }

  if (state.state === 'QUESTION_ACTIVE' && state.game.endsAt && !state.game.paused) {
    lastTickSecond = null;
    stopCountdown = startCountdown(state.game.endsAt, q.timeLimit, ({ secondsLeft, percent }) => {
      document.getElementById('q-timer-seconds').textContent = secondsLeft;
      document.getElementById('q-timer-fill').style.width = `${percent}%`;
      if (secondsLeft <= 5 && secondsLeft > 0 && secondsLeft !== lastTickSecond) {
        lastTickSecond = secondsLeft;
        audio.playTick();
      }
    });
  } else if (isReveal) {
    document.getElementById('q-timer-seconds').textContent = '0';
    document.getElementById('q-timer-fill').style.width = '0%';
  }
}

function renderStandingsRows(containerId, standings) {
  const el = document.getElementById(containerId);
  el.innerHTML = standings
    .map(
      (t) => `
      <div class="standing-row anim-fade-up">
        <div style="display: flex; align-items: center; gap: 0.9rem;">
          <span class="standing-rank">#${t.rank}</span>
          <div>
            <div>${escapeHtml(t.name)}</div>
            ${
              t.members?.length
                ? `<div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 500;">${escapeHtml(
                    t.members.join(', ')
                  )}</div>`
                : ''
            }
          </div>
        </div>
        <div style="color: var(--gold); font-weight: 900;">${t.score} pts</div>
      </div>`
    )
    .join('');
}

socket.on('connect', () => {
  const savedRoom = getQueryParam('room') || sessionStorage.getItem('quizon_tv_room');
  socket.emit('tv:register', { roomCode: savedRoom || undefined });
});

socket.on('tv:registered', (data) => {
  qrData = data;
  sessionStorage.setItem('quizon_tv_room', data.code);
});

socket.on('tv:audio_settings', (settings) => {
  audio.setSettings(settings);
});

socket.on('game:question_intro', (info) => {
  audio.stopLoop();
  showOnlySection(viewIntro);
  document.getElementById('intro-badge').textContent = `Pregunta ${info.index} de ${info.total}`;
  document.getElementById('intro-category').textContent = info.category;
  document.getElementById('intro-type-hint').textContent = TYPE_LABELS[info.type] || '';
  if (info.type === 'lightning') {
    audio.playLightningAlert();
  }
});

socket.on('game:question_start', (data) => {
  if (data?.question?.media?.questionAudio) {
    audio.playMediaUrl(data.question.media.questionAudio);
  } else {
    audio.startQuestionBed();
  }
});

socket.on('game:reveal', (data) => {
  audio.stopLoop();
  if (data?.revealAudio) {
    audio.playMediaUrl(data.revealAudio);
  } else {
    audio.playReveal();
  }
});

socket.on('game:finished', ({ podium, standings, stats }) => {
  audio.stopLoop();
  audio.playFanfare();
  showOnlySection(viewFinished);

  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  document.getElementById('podium-grid').innerHTML = podium
    .map(
      (t) => `
      <div class="podium-card anim-pop">
        <div style="font-size: 2.6rem;">${medals[t.rank] || '🏆'}</div>
        <div style="font-weight: 900; font-size: 1.35rem; margin: 0.3rem 0;">${escapeHtml(t.name)}</div>
        <div style="color: var(--gold); font-size: 1.3rem; font-weight: 800;">${t.score} pts</div>
      </div>`
    )
    .join('');

  renderStandingsRows('final-standings-list', standings);

  const statCards = [];
  if (stats?.fastestTeam) {
    statCards.push({
      label: '⚡ Equipo más rápido',
      value: `${escapeHtml(stats.fastestTeam.name)} (${(stats.fastestTeam.avgResponseMs / 1000).toFixed(1)}s media)`,
    });
  }
  if (stats?.bestStreakTeam) {
    statCards.push({
      label: '🔥 Mayor racha',
      value: `${escapeHtml(stats.bestStreakTeam.name)} (${stats.bestStreakTeam.bestStreak} seguidas)`,
    });
  }
  if (stats?.hardestQuestion) {
    statCards.push({
      label: '🧠 Pregunta más difícil',
      value: `${stats.hardestQuestion.accuracy}% de acierto`,
    });
  }

  document.getElementById('final-stats-grid').innerHTML = statCards
    .map(
      (s) => `
      <div class="card">
        <div style="color: var(--text-muted); font-size: 0.9rem;">${s.label}</div>
        <div style="font-size: 1.15rem; font-weight: 800; margin-top: 0.25rem;">${s.value}</div>
      </div>`
    )
    .join('');
});

socket.on('room:state', (state) => {
  elHeaderCode.textContent = state.code;
  elMatchTitle.textContent = state.config?.title ? `· ${state.config.title}` : '';
  audio.setSettings(state.audio || {});

  if (state.game) {
    elRoundBadge.textContent = `Ronda ${state.game.index} / ${state.game.total}`;
    elRoundBadge.classList.remove('hidden');
  } else {
    elRoundBadge.classList.add('hidden');
  }

  overlayPaused.classList.toggle('hidden', !state.game?.paused);

  if (state.state === 'LOBBY_UNCLAIMED' || state.state === 'LOBBY') {
    audio.stopLoop();
    renderLobby(state);
  } else if (state.state === 'QUESTION_ACTIVE' || state.state === 'REVEAL') {
    renderQuestionAndReveal(state);
  } else if (state.state === 'LEADERBOARD') {
    audio.stopLoop();
    showOnlySection(viewLeaderboard);
    renderStandingsRows('leaderboard-list', state.standings);
  }

  lastRenderedState = state.state;
});

socket.on('room:error', (err) => {
  showToast(err.message || 'Error en sala');
});

