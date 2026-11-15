import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuestionScore, buildStandings } from '../server/game-engine.js';

describe('Cálculo de puntuación y empates', () => {
  it('single_choice: 1000 pts con tiempo máximo, 500 pts al límite, 0 si falla', () => {
    const q = { type: 'single_choice', correctOptionIds: ['b'] };
    assert.equal(calculateQuestionScore(q, ['b'], 20000, 20000).points, 1000);
    assert.equal(calculateQuestionScore(q, ['b'], 0, 20000).points, 500);
    assert.equal(calculateQuestionScore(q, ['a'], 20000, 20000).points, 0);
  });

  it('lightning: aplica multiplicador x1.5 (hasta 1500 pts)', () => {
    const q = { type: 'lightning', correctOptionIds: ['c'] };
    const res = calculateQuestionScore(q, ['c'], 7000, 7000);
    assert.equal(res.points, 1500);
    assert.equal(res.isCorrect, true);
  });

  it('multiple_choice: puntuación proporcional y mínimo 0 (nunca negativo)', () => {
    const q = { type: 'multiple_choice', correctOptionIds: ['a', 'c'] };
    // 2 de 2 correctas sin fallos al instante -> 1000
    assert.equal(calculateQuestionScore(q, ['a', 'c'], 25000, 25000).points, 1000);
    // 1 de 2 correctas sin fallos a mitad de tiempo (750 * 0.5 = 375)
    assert.equal(calculateQuestionScore(q, ['a'], 12500, 25000).points, 375);
    // 1 acierto y 1 fallo -> (1 - 1) / 2 = 0
    assert.equal(calculateQuestionScore(q, ['a', 'b'], 25000, 25000).points, 0);
    // 0 aciertos y 2 fallos -> mínimo 0
    assert.equal(calculateQuestionScore(q, ['b', 'd'], 25000, 25000).points, 0);
  });

  it('buildStandings: los empates comparten la misma posición (rank)', () => {
    const teams = [
      { id: '1', name: 'Alfa', score: 1500 },
      { id: '2', name: 'Beta', score: 1500 },
      { id: '3', name: 'Gamma', score: 900 },
    ];
    const standings = buildStandings(teams);
    assert.equal(standings[0].rank, 1);
    assert.equal(standings[1].rank, 1);
    assert.equal(standings[2].rank, 3);
  });
});

