import { QuestionStore } from './question-store.js';

const BASE_POINTS = 500;
const MAX_BONUS_POINTS = 500;
const LIGHTNING_MULTIPLIER = 1.5;

/**
 * Calcula los puntos obtenidos en una pregunta según el tipo y el tiempo restante.
 *
 * @param {object} question
 * @param {string[]} selectedOptionIds
 * @param {number} remainingMs
 * @param {number} totalMs
 * @returns {{ points: number, isCorrect: boolean, ratio: number }}
 */
export function calculateQuestionScore(question, selectedOptionIds, remainingMs, totalMs) {
  const selected = Array.from(new Set(selectedOptionIds || []));
  const correctSet = new Set(question.correctOptionIds || []);
  const clampedRemaining = Math.max(0, Math.min(remainingMs, totalMs));
  const speedRatio = totalMs > 0 ? clampedRemaining / totalMs : 0;

  if (question.type === 'multiple_choice') {
    if (selected.length === 0 || correctSet.size === 0) {
      return { points: 0, isCorrect: false, ratio: 0 };
    }
    let hits = 0;
    let misses = 0;
    for (const id of selected) {
      if (correctSet.has(id)) hits++;
      else misses++;
    }
    const ratio = Math.max(0, (hits - misses) / correctSet.size);
    const rawPoints = ratio * (BASE_POINTS + MAX_BONUS_POINTS * speedRatio);
    const points = Math.round(rawPoints);
    const isCorrect = hits === correctSet.size && misses === 0;
    return { points, isCorrect, ratio };
  }

  // single_choice, true_false, visual, lightning
  const isCorrect = selected.length === 1 && correctSet.has(selected[0]);
  if (!isCorrect) {
    return { points: 0, isCorrect: false, ratio: 0 };
  }

  let points = BASE_POINTS + Math.round(MAX_BONUS_POINTS * speedRatio);
  if (question.type === 'lightning') {
    points = Math.round(points * LIGHTNING_MULTIPLIER);
  }
  return { points, isCorrect: true, ratio: 1 };
}

/**
 * Construye el ranking de equipos respetando empates (comparten posición).
 *
 * @param {Iterable<object>} teams
 * @returns {Array<object>}
 */
export function buildStandings(teams) {
  const sorted = Array.from(teams)
    .map((t) => ({
      id: t.id,
      name: t.name,
      members: t.members || [],
      color: t.color || '#6366f1',
      icon: t.icon || '🎯',
      score: t.score || 0,
      streak: t.streak || 0,
      bestStreak: t.bestStreak || 0,
      correctCount: t.correctCount || 0,
      avgResponseMs:
        t.correctCount > 0 ? Math.round((t.totalResponseMs || 0) / t.correctCount) : null,
      connected: Boolean(t.connected),
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'es'));

  let currentRank = 1;
  return sorted.map((team, idx) => {
    if (idx > 0 && team.score < sorted[idx - 1].score) {
      currentRank = idx + 1;
    }
    return { ...team, rank: currentRank };
  });
}

/**
 * Motor de partida para una sala de QUIZÓN.
 */
export class GameEngine {
  /**
   * @param {object} room
   * @param {QuestionStore} questionStore
   * @param {(event: string, payload: any) => void} emitRoom
   * @param {(socketId: string, event: string, payload: any) => void} emitSocket
   */
  constructor(room, questionStore, emitRoom, emitSocket) {
    this.room = room;
    this.questionStore = questionStore;
    this.emitRoom = emitRoom;
    this.emitSocket = emitSocket;
    this.timer = null;
  }

  clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Inicia una nueva partida desde el Lobby.
   */
  startGame() {
    if (this.room.teams.size === 0) {
      return { error: 'NO_TEAMS', message: 'Debe haber al menos un equipo conectado para empezar.' };
    }

    this.clearTimer();
    for (const team of this.room.teams.values()) {
      team.score = 0;
      team.streak = 0;
      team.bestStreak = 0;
      team.correctCount = 0;
      team.totalResponseMs = 0;
    }

    const questions = this.questionStore.pickQuestions(
      this.room.config.packId,
      this.room.config.questionCount
    );

    this.room.game = {
      questions,
      currentIndex: 0,
      paused: false,
      pausedState: null,
      remainingMsOnPause: 0,
      endsAt: null,
      startedAt: null,
      totalMs: 0,
      roundAnswers: new Map(), // teamId -> { selectedOptionIds, responseMs, points, isCorrect, locked }
      draftSelections: new Map(), // teamId -> string[]
      questionStats: [], // { questionId, prompt, correctCount, totalTeams, accuracy }
    };

    this.#startQuestionIntro();
    return { ok: true };
  }

  #currentQuestion() {
    return this.room.game?.questions[this.room.game.currentIndex] || null;
  }

  #startQuestionIntro() {
    this.clearTimer();
    const g = this.room.game;
    const q = this.#currentQuestion();
    if (!q) {
      this.#finishGame();
      return;
    }

    this.room.state = 'QUESTION_INTRO';
    g.roundAnswers.clear();
    g.draftSelections.clear();

    this.emitRoom('game:question_intro', {
      index: g.currentIndex + 1,
      total: g.questions.length,
      category: q.category || 'General',
      type: q.type,
    });
    this.#broadcastState();

    this.timer = setTimeout(() => {
      this.#startQuestionActive();
    }, 3000);
  }

  #startQuestionActive() {
    this.clearTimer();
    const g = this.room.game;
    const q = this.#currentQuestion();
    if (!q) return;

    this.room.state = 'QUESTION_ACTIVE';
    const multiplier = Math.max(0.5, Math.min(3.0, Number(this.room.config.timeMultiplier) || 1));
    const effectiveSeconds = Math.max(3, Math.round((q.timeLimit || 20) * multiplier));
    const totalMs = effectiveSeconds * 1000;
    const now = Date.now();
    g.startedAt = now;
    g.totalMs = totalMs;
    g.effectiveTimeLimit = effectiveSeconds;
    g.endsAt = now + totalMs;

    const sanitized = QuestionStore.sanitizeForClient(q);
    sanitized.timeLimit = effectiveSeconds;

    this.emitRoom('game:question_start', {
      question: sanitized,
      index: g.currentIndex + 1,
      total: g.questions.length,
      endsAt: g.endsAt,
    });
    this.#broadcastState();

    this.timer = setTimeout(() => {
      this.#endQuestionTime();
    }, totalMs);
  }

  /**
   * Guarda la selección temporal en preguntas multiple_choice.
   */
  updateDraftSelection(teamId, questionId, selectedOptionIds) {
    if (this.room.state !== 'QUESTION_ACTIVE') return;
    const g = this.room.game;
    const q = this.#currentQuestion();
    if (!q || q.id !== questionId || q.type !== 'multiple_choice') return;
    if (g.roundAnswers.has(teamId)) return; // Ya confirmó
    g.draftSelections.set(teamId, Array.from(new Set(selectedOptionIds || [])));
  }

  /**
   * Registra o actualiza la respuesta del equipo durante QUESTION_ACTIVE.
   * El tiempo registrado coincide con la última selección realizada.
   * Si `confirm` es true, bloquea la respuesta del equipo; si todos confirman, finaliza el tiempo.
   */
  submitAnswer(teamId, socketId, questionId, selectedOptionIds, { confirm = false } = {}) {
    if (this.room.state !== 'QUESTION_ACTIVE') {
      return { accepted: false, reason: 'QUESTION_NOT_ACTIVE' };
    }
    const g = this.room.game;
    if (g.paused) {
      return { accepted: false, reason: 'GAME_PAUSED' };
    }
    const q = this.#currentQuestion();
    if (!q || q.id !== questionId) {
      return { accepted: false, reason: 'INVALID_QUESTION' };
    }

    const existing = g.roundAnswers.get(teamId);
    if (existing?.locked) {
      this.emitSocket(socketId, 'game:answer_ack', {
        accepted: false,
        lockedByTeam: true,
        selectedOptionIds: existing.selectedOptionIds,
      });
      return { accepted: false, lockedByTeam: true };
    }

    const now = Date.now();
    const remainingMs = Math.max(0, g.endsAt - now);
    const responseMs = Math.max(0, now - g.startedAt);
    const cleanSelected = Array.from(new Set(selectedOptionIds || []));

    if (cleanSelected.length === 0) {
      g.roundAnswers.delete(teamId);
    } else {
      const result = calculateQuestionScore(q, cleanSelected, remainingMs, g.totalMs);
      g.roundAnswers.set(teamId, {
        selectedOptionIds: cleanSelected,
        responseMs,
        points: result.points,
        isCorrect: result.isCorrect,
        ratio: result.ratio,
        locked: Boolean(confirm),
      });
    }

    const isLocked = Boolean(confirm && cleanSelected.length > 0);

    // Sincronizar la selección activa (y bloqueo si confirmó) con todos los dispositivos del equipo
    const team = this.room.teams.get(teamId);
    if (team) {
      for (const sid of team.sockets) {
        this.emitSocket(sid, 'game:answer_ack', {
          accepted: true,
          lockedByTeam: isLocked,
          selectedOptionIds: cleanSelected,
        });
      }
    }

    // Si todos los equipos conectados han confirmado su respuesta definitiva, finaliza el tiempo
    const connectedTeams = Array.from(this.room.teams.values()).filter((t) => t.connected);
    const allConfirmed =
      connectedTeams.length > 0 &&
      connectedTeams.every((t) => g.roundAnswers.get(t.id)?.locked === true);

    if (allConfirmed) {
      this.#endQuestionTime();
    } else {
      this.#broadcastState();
    }

    const saved = g.roundAnswers.get(teamId);
    return {
      accepted: true,
      lockedByTeam: isLocked,
      points: saved?.points || 0,
      selectedOptionIds: cleanSelected,
    };
  }

  /**
   * Finaliza el tiempo de respuesta y pasa a estado TIME_UP (sin revelar aún la solución).
   */
  endTimerNow() {
    if (this.room.state !== 'QUESTION_ACTIVE') return false;
    this.#endQuestionTime();
    return true;
  }

  #endQuestionTime() {
    this.clearTimer();
    const g = this.room.game;
    const q = this.#currentQuestion();
    if (!q) return;

    this.room.state = 'TIME_UP';
    g.endsAt = null;
    g.paused = false;

    // Congelar borradores pendientes en multiple_choice si el tiempo expiró sin confirmar
    if (q.type === 'multiple_choice') {
      for (const [teamId, draft] of g.draftSelections.entries()) {
        if (!g.roundAnswers.has(teamId) && draft.length > 0) {
          const evalResult = calculateQuestionScore(q, draft, 0, g.totalMs);
          g.roundAnswers.set(teamId, {
            selectedOptionIds: draft,
            responseMs: g.totalMs,
            points: evalResult.points,
            isCorrect: evalResult.isCorrect,
            ratio: evalResult.ratio,
            locked: true,
            fromTimeoutDraft: true,
          });
        }
      }
    }

    this.emitRoom('game:time_up', {
      questionId: q.id,
      answeredCount: g.roundAnswers.size,
    });
    this.#broadcastState();

    if (this.room.config.autoAdvance) {
      this.timer = setTimeout(() => {
        this.revealAnswer();
      }, 2500);
    }
  }

  /**
   * El moderador muestra la solución y explicación en pantalla (TIME_UP -> REVEAL).
   */
  revealAnswer() {
    if (this.room.state !== 'TIME_UP' && this.room.state !== 'QUESTION_ACTIVE') return false;
    if (this.room.state === 'QUESTION_ACTIVE') {
      this.#endQuestionTime();
    }
    this.#revealRound();
    return true;
  }

  #revealRound() {
    this.clearTimer();
    const g = this.room.game;
    const q = this.#currentQuestion();
    if (!q) return;

    this.room.state = 'REVEAL';
    g.endsAt = null;

    let roundCorrectCount = 0;
    const roundScores = [];

    for (const team of this.room.teams.values()) {
      const ans = g.roundAnswers.get(team.id);
      if (ans) {
        team.score += ans.points;
        if (ans.isCorrect) {
          team.streak += 1;
          team.bestStreak = Math.max(team.bestStreak, team.streak);
          team.correctCount += 1;
          team.totalResponseMs += ans.responseMs;
          roundCorrectCount += 1;
        } else {
          team.streak = 0;
        }
        roundScores.push({
          teamId: team.id,
          teamName: team.name,
          points: ans.points,
          isCorrect: ans.isCorrect,
          totalScore: team.score,
        });
      } else {
        team.streak = 0;
        roundScores.push({
          teamId: team.id,
          teamName: team.name,
          points: 0,
          isCorrect: false,
          totalScore: team.score,
        });
      }
    }

    const totalTeams = Math.max(1, this.room.teams.size);
    g.questionStats.push({
      questionId: q.id,
      prompt: q.prompt,
      correctCount: roundCorrectCount,
      totalTeams,
      accuracy: Math.round((roundCorrectCount / totalTeams) * 100),
    });

    this.emitRoom('game:reveal', {
      questionId: q.id,
      correctOptionIds: q.correctOptionIds,
      explanation: q.explanation || '',
      extraFact: q.extraFact || null,
      revealImages: q.resolvedMedia?.explain || [],
      roundScores,
    });
    this.#broadcastState();

    if (this.room.config.autoAdvance) {
      this.timer = setTimeout(() => {
        this.showResults();
      }, 8000);
    }
  }

  /**
   * El moderador muestra los resultados/clasificación (REVEAL -> LEADERBOARD o FINISHED).
   */
  showResults() {
    if (this.room.state !== 'REVEAL') return false;
    this.clearTimer();
    const g = this.room.game;
    const isLast = g.currentIndex >= g.questions.length - 1;
    if (isLast) {
      this.#finishGame();
      return true;
    }

    this.room.state = 'LEADERBOARD';
    const standings = buildStandings(this.room.teams.values());
    this.emitRoom('game:leaderboard', { standings, isFinal: false });
    this.#broadcastState();

    if (this.room.config.autoAdvance) {
      this.timer = setTimeout(() => {
        this.nextStep();
      }, 5000);
    }
    return true;
  }

  /**
   * Avanza al siguiente paso lógico según el estado actual.
   */
  nextStep() {
    if (!this.room.game) return;
    this.clearTimer();

    if (this.room.state === 'QUESTION_ACTIVE') {
      this.#endQuestionTime();
      return;
    }

    if (this.room.state === 'TIME_UP') {
      this.#revealRound();
      return;
    }

    if (this.room.state === 'REVEAL') {
      this.showResults();
      return;
    }

    if (this.room.state === 'LEADERBOARD') {
      this.room.game.currentIndex += 1;
      this.#startQuestionIntro();
    }
  }

  /**
   * Salta la clasificación intermedia y avanza directamente a la siguiente pregunta (o finaliza si era la última).
   */
  skipToNextQuestion() {
    if (!this.room.game) return false;
    if (this.room.state !== 'REVEAL' && this.room.state !== 'LEADERBOARD') return false;
    this.clearTimer();
    const g = this.room.game;
    if (g.currentIndex >= g.questions.length - 1) {
      this.#finishGame();
      return true;
    }
    g.currentIndex += 1;
    this.#startQuestionIntro();
    return true;
  }

  /**
   * Pausa o reanuda la partida congelando el temporizador.
   */
  togglePause() {
    const g = this.room.game;
    if (!g) return false;

    if (!g.paused) {
      if (this.room.state !== 'QUESTION_ACTIVE' && this.room.state !== 'LEADERBOARD') {
        return false;
      }
      g.paused = true;
      g.pausedState = this.room.state;
      g.remainingMsOnPause = g.endsAt ? Math.max(0, g.endsAt - Date.now()) : 0;
      this.clearTimer();
      this.#broadcastState();
      return true;
    }

    // Reanudar
    g.paused = false;
    const targetState = g.pausedState;
    g.pausedState = null;

    if (targetState === 'QUESTION_ACTIVE') {
      const rem = Math.max(1000, g.remainingMsOnPause || 1000);
      g.endsAt = Date.now() + rem;
      this.timer = setTimeout(() => this.#endQuestionTime(), rem);
    } else if (targetState === 'LEADERBOARD' && this.room.config.autoAdvance) {
      this.timer = setTimeout(() => this.nextStep(), 4000);
    }

    this.#broadcastState();
    return true;
  }

  /**
   * Finaliza la partida anticipadamente o al completar todas las preguntas.
   */
  finishNow() {
    if (!this.room.game) return;
    this.#finishGame();
  }

  #finishGame() {
    this.clearTimer();
    this.room.state = 'FINISHED';
    const g = this.room.game;
    g.endsAt = null;
    g.paused = false;

    const standings = buildStandings(this.room.teams.values());
    const podium = standings.filter((t) => t.rank <= 3);

    const teamsWithTime = standings.filter((t) => t.avgResponseMs !== null);
    const fastestTeam =
      teamsWithTime.length > 0
        ? [...teamsWithTime].sort((a, b) => a.avgResponseMs - b.avgResponseMs)[0]
        : null;

    const bestStreakTeam =
      standings.length > 0
        ? [...standings].sort((a, b) => b.bestStreak - a.bestStreak)[0]
        : null;

    const hardestQuestion =
      g.questionStats.length > 0
        ? [...g.questionStats].sort((a, b) => a.accuracy - b.accuracy)[0]
        : null;

    const stats = {
      fastestTeam: fastestTeam
        ? { name: fastestTeam.name, avgResponseMs: fastestTeam.avgResponseMs }
        : null,
      bestStreakTeam:
        bestStreakTeam && bestStreakTeam.bestStreak > 0
          ? { name: bestStreakTeam.name, bestStreak: bestStreakTeam.bestStreak }
          : null,
      hardestQuestion: hardestQuestion
        ? { prompt: hardestQuestion.prompt, accuracy: hardestQuestion.accuracy }
        : null,
    };

    this.emitRoom('game:finished', { podium, standings, stats });
    this.#broadcastState();
  }

  /**
   * Vuelve al lobby conservando los equipos conectados.
   */
  resetToLobby() {
    this.clearTimer();
    this.room.game = null;
    this.room.state = this.room.hostToken ? 'LOBBY' : 'LOBBY_UNCLAIMED';
    for (const team of this.room.teams.values()) {
      team.score = 0;
      team.streak = 0;
      team.bestStreak = 0;
      team.correctCount = 0;
      team.totalResponseMs = 0;
    }
    this.#broadcastState();
  }

  #broadcastState() {
    this.emitRoom('room:state_refresh', null);
  }
}
