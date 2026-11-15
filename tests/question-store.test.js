import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QuestionStore } from '../server/question-store.js';

describe('QuestionStore', () => {
  const store = new QuestionStore();

  it('carga todos los packs y preguntas de data/questions.json sin errores', () => {
    const summary = store.getPacksSummary();
    assert.ok(summary.length >= 5);
    const allPack = summary.find((p) => p.id === 'all');
    assert.equal(allPack.questionCount, 41);
  });

  it('pickQuestions respeta el pack seleccionado y el número de preguntas', () => {
    const picked = store.pickQuestions('modos-especiales', 3);
    assert.equal(picked.length, 3);
    const ids = new Set(picked.map((q) => q.id));
    assert.equal(ids.size, 3);
  });

  it('sanitizeForClient elimina respuestas correctas y explicaciones', () => {
    const [q] = store.pickQuestions('mitos-y-leyendas', 1);
    const sanitized = QuestionStore.sanitizeForClient(q);
    assert.equal(sanitized.id, q.id);
    assert.equal(sanitized.correctOptionIds, undefined);
    assert.equal(sanitized.explanation, undefined);
    assert.equal(sanitized.extraFact, undefined);
    assert.ok(Array.isArray(sanitized.options));
  });
});

