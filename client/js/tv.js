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
let revealPhaseTimer = null;
let revealScrollTimer = null;
let revealScrollRaf = null;
let bgLoopTimer = null;
let bgActiveLayer = 'a';
let bgCurrentKey = '';
let clueLoopTimer = null;
let clueCurrentKey = '';

const bgStage = document.getElementById('bg-stage');
const bgLayerA = document.getElementById('bg-layer-a');
const bgLayerB = document.getElementById('bg-layer-b');

function stopBgLoop() {
  if (bgLoopTimer) {
    clearInterval(bgLoopTimer);
    bgLoopTimer = null;
  }
  bgCurrentKey = '';
  if (bgStage) bgStage.classList.add('hidden');
  if (bgLayerA) bgLayerA.style.opacity = '0';
  if (bgLayerB) bgLayerB.style.opacity = '0';
}

function startBgLoop(images = []) {
  if (!bgStage || !bgLayerA || !bgLayerB) return;
  const urls = images.map((img) => img.url).filter(Boolean);
  const key = urls.join('|');
  if (!urls.length) {
    stopBgLoop();
    return;
  }
  if (key === bgCurrentKey) return;

  if (bgLoopTimer) {
    clearInterval(bgLoopTimer);
    bgLoopTimer = null;
  }
  bgCurrentKey = key;
  bgStage.classList.remove('hidden');

  let idx = 0;
  const showAt = (i) => {
    idx = ((i % urls.length) + urls.length) % urls.length;
    const incoming = bgActiveLayer === 'a' ? bgLayerB : bgLayerA;
    const outgoing = bgActiveLayer === 'a' ? bgLayerA : bgLayerB;
    bgActiveLayer = bgActiveLayer === 'a' ? 'b' : 'a';
    incoming.src = urls[idx];
    requestAnimationFrame(() => {
      incoming.style.opacity = '0.65';
      outgoing.style.opacity = '0';
    });
  };

  showAt(0);
  if (urls.length > 1) {
    bgLoopTimer = setInterval(() => showAt(idx + 1), 4000);
  }
}

function stopClueLoop() {
  if (clueLoopTimer) {
    clearInterval(clueLoopTimer);
    clueLoopTimer = null;
  }
  clueCurrentKey = '';
}

function stopRevealAutoScroll() {
  if (revealScrollTimer) {
    clearTimeout(revealScrollTimer);
    revealScrollTimer = null;
  }
  if (revealScrollRaf) {
    cancelAnimationFrame(revealScrollRaf);
    revealScrollRaf = null;
  }
}

function startRevealAutoScroll(box) {
  stopRevealAutoScroll();
  if (!box) return;
  box.scrollTop = 0;

  const startCycle = () => {
    const maxScroll = box.scrollHeight - box.clientHeight;
    if (maxScroll <= 4) return;

    let virtualTop = 0;
    let lastTs = null;
    const pxPerSec = 32;

    revealScrollTimer = setTimeout(() => {
      const step = (ts) => {
        if (lastTs === null) lastTs = ts;
        const dt = (ts - lastTs) / 1000;
        lastTs = ts;

        virtualTop += pxPerSec * dt;
        const currentMax = box.scrollHeight - box.clientHeight;
        if (virtualTop >= currentMax) {
          box.scrollTop = currentMax;
          revealScrollTimer = setTimeout(() => {
            box.scrollTop = 0;
            startCycle();
          }, 2200);
          return;
        }
        box.scrollTop = virtualTop;
        revealScrollRaf = requestAnimationFrame(step);
      };
      revealScrollRaf = requestAnimationFrame(step);
    }, 2200);
  };

  requestAnimationFrame(startCycle);
}

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
  if (section !== viewQuestion) {
    stopRevealAutoScroll();
    stopBgLoop();
    stopClueLoop();
  }
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
      <div class="team-chip anim-pop" style="background: ${escapeHtml(t.color || '#6366f1')};">
        <div class="team-chip-name">${escapeHtml(t.icon || '🎯')} ${escapeHtml(t.name)} ${
        t.connected ? '' : ' (desconectado)'
      }</div>
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

  const isActive = state.state === 'QUESTION_ACTIVE';
  const isTimeUp = state.state === 'TIME_UP';
  const isReveal = state.state === 'REVEAL';

  const timerWrap = document.getElementById('q-timer-wrap');
  timerWrap.classList.toggle('hidden', !isActive);

  const typeBadge = document.getElementById('q-type-badge');
  typeBadge.textContent = TYPE_LABELS[q.type] || 'Pregunta';
  typeBadge.className = q.type === 'lightning' ? 'badge lightning anim-lightning' : 'badge';

  const promptEl = document.getElementById('q-prompt');
  promptEl.textContent = q.prompt;
  document.getElementById('q-answered-pill').textContent = `${state.game.answeredCount} / ${
    state.teams.filter((t) => t.connected).length
  } equipos`;

  const mediaWrap = document.getElementById('q-media-wrap');
  const mediaImg = document.getElementById('q-media-img');
  const clueImages = q.media?.clue || [];
  if (clueImages.length > 0) {
    const clueKey = clueImages.map((img) => img.url).join('|');
    if (clueKey !== clueCurrentKey) {
      stopClueLoop();
      clueCurrentKey = clueKey;
      let clueIdx = 0;
      mediaImg.src = clueImages[0].url;
      if (clueImages.length > 1) {
        clueLoopTimer = setInterval(() => {
          clueIdx = (clueIdx + 1) % clueImages.length;
          mediaImg.src = clueImages[clueIdx].url;
        }, 4000);
      }
    }
    mediaWrap.classList.remove('hidden');
  } else {
    stopClueLoop();
    mediaWrap.classList.add('hidden');
  }

  if (isReveal && Array.isArray(q.media?.explain) && q.media.explain.length > 0) {
    startBgLoop(q.media.explain);
  } else {
    startBgLoop(q.media?.bg || []);
  }

  const optionsGrid = document.getElementById('q-options-grid');
  const correctSet = new Set(q.correctOptionIds || []);
  const optionPicks = state.game.optionPicks || {};

  if (revealPhaseTimer) {
    clearTimeout(revealPhaseTimer);
    revealPhaseTimer = null;
  }
  stopRevealAutoScroll();

  const isEnteringReveal = isReveal && lastRenderedState !== 'REVEAL';
  promptEl.classList.toggle('prompt-collapsed', isReveal && !isEnteringReveal);
  if (isReveal && !isEnteringReveal) {
    mediaWrap.classList.add('hidden');
  }
  optionsGrid.classList.toggle('reveal-focused', isReveal && !isEnteringReveal);

  optionsGrid.innerHTML = q.options
    .map((opt, idx) => {
      const letter = OPT_LETTERS[idx] || String(idx + 1);
      const colorClass = `opt-${letter.toLowerCase()}`;
      let extraClass = '';
      if (isReveal && !isEnteringReveal) {
        extraClass = correctSet.has(opt.id) ? 'correct-highlight' : 'dimmed collapsed';
      }

      const picks = (isTimeUp || isReveal) && Array.isArray(optionPicks[opt.id])
        ? optionPicks[opt.id]
        : [];
      const picksHtml = picks.length
        ? `<div class="tv-picks-pills">${picks
            .map(
              (team) =>
                `<span class="tv-pick-pill anim-pop" style="background: ${escapeHtml(
                  team.color || '#6366f1'
                )};"><span>${escapeHtml(team.icon || '🎯')}</span><span>${escapeHtml(
                  team.name
                )}</span></span>`
            )
            .join('')}</div>`
        : '';

      return `
        <div class="tv-option ${colorClass} ${extraClass}" data-correct="${correctSet.has(opt.id)}">
          <div class="tv-option-main">
            <div class="tv-option-letter">${letter}</div>
            <div>${escapeHtml(opt.text)}</div>
          </div>
          ${picksHtml}
        </div>
      `;
    })
    .join('');

  const timeUpBanner = document.getElementById('q-timeup-banner');
  timeUpBanner.classList.toggle('hidden', !isTimeUp);

  const revealBox = document.getElementById('q-reveal-box');
  function showExplanationBox() {
    revealBox.classList.remove('hidden');
    revealBox.classList.add('anim-fade-up');
    document.getElementById('q-explanation').textContent = q.explanation || '';
    const extraEl = document.getElementById('q-extra-fact');
    if (q.extraFact) {
      extraEl.textContent = `✨ Curiosidad: ${q.extraFact}`;
      extraEl.classList.remove('hidden');
    } else {
      extraEl.classList.add('hidden');
    }
    const revImg = document.getElementById('q-reveal-img');
    revImg.classList.add('hidden');
    startRevealAutoScroll(revealBox);
  }

  if (isReveal) {
    if (isEnteringReveal) {
      revealBox.classList.add('hidden');
      // Disparamos la transición lenta (1.2s) en el siguiente frame para que sea visible
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          optionsGrid.querySelectorAll('.tv-option').forEach((el) => {
            if (el.dataset.correct === 'true') {
              el.classList.add('correct-highlight');
            } else {
              el.classList.add('dimmed');
            }
          });
        });
      });
      // 1.2s de transición + 3s manteniéndose visible antes de mover/dimensionar la respuesta correcta arriba
      revealPhaseTimer = setTimeout(() => {
        const correctEls = Array.from(optionsGrid.querySelectorAll('.tv-option[data-correct="true"]'));
        const firstRects = correctEls.map((el) => el.getBoundingClientRect());

        promptEl.classList.add('prompt-collapsed');
        mediaWrap.classList.add('hidden');
        optionsGrid.classList.add('reveal-focused');
        optionsGrid.querySelectorAll('.tv-option[data-correct="false"]').forEach((el) => {
          el.classList.add('collapsed');
        });
        showExplanationBox();

        correctEls.forEach((el, idx) => {
          const first = firstRects[idx];
          const last = el.getBoundingClientRect();
          if (!first || !last.width || !last.height) return;
          const dx = first.left - last.left;
          const dy = first.top - last.top;
          const sx = first.width / last.width;
          const sy = first.height / last.height;

          el.style.transition = 'none';
          el.style.transformOrigin = 'top left';
          el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
          // Forzamos reflow para que arranque la animación FLIP hacia su nueva posición y tamaño
          void el.offsetWidth;
          el.style.transition = 'transform 0.85s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.85s ease';
          el.style.transform = 'none';
        });
      }, 4200);
    } else {
      showExplanationBox();
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
  } else if (isTimeUp || isReveal) {
    document.getElementById('q-timer-seconds').textContent = '0';
    document.getElementById('q-timer-fill').style.width = '0%';
  }
}

function renderStandingsRows(containerId, standings) {
  const el = document.getElementById(containerId);
  el.innerHTML = standings
    .map(
      (t) => `
      <div class="standing-row anim-fade-up" style="background: ${escapeHtml(t.color || '#6366f1')};">
        <div style="display: flex; align-items: center; gap: 0.9rem;">
          <span class="standing-rank">#${t.rank}</span>
          <div>
            <div>${escapeHtml(t.icon || '🎯')} ${escapeHtml(t.name)}</div>
            ${
              t.members?.length
                ? `<div style="font-size: 0.85rem; color: rgba(255, 255, 255, 0.88); font-weight: 500;">${escapeHtml(
                    t.members.join(', ')
                  )}</div>`
                : ''
            }
          </div>
        </div>
        <div class="standing-score-box">${t.score} pts</div>
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

socket.on('game:question_start', () => {
  audio.startQuestionBed();
});

socket.on('game:time_up', () => {
  audio.stopLoop();
  audio.playTick();
});

socket.on('game:reveal', () => {
  audio.stopLoop();
  audio.playReveal();
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
        <div style="font-weight: 900; font-size: 1.35rem; margin: 0.3rem 0;">${escapeHtml(
          t.icon || '🎯'
        )} ${escapeHtml(t.name)}</div>
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
  } else if (
    state.state === 'QUESTION_ACTIVE' ||
    state.state === 'TIME_UP' ||
    state.state === 'REVEAL'
  ) {
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

