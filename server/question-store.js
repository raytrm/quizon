import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_QUESTIONS_PATH = path.resolve(__dirname, '../data/questions.json');

const VALID_TYPES = new Set([
  'single_choice',
  'multiple_choice',
  'true_false',
  'visual',
  'lightning',
]);

/**
 * Carga y gestiona el banco de preguntas desde JSON.
 */
export class QuestionStore {
  constructor(filePath = DEFAULT_QUESTIONS_PATH) {
    this.filePath = filePath;
    this.packs = [];
    this.reload();
  }

  /**
   * Lee y valida el archivo JSON de preguntas.
   */
  reload() {
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    if (!parsed || !Array.isArray(parsed.packs)) {
      throw new Error('Formato inválido en questions.json: falta el array "packs".');
    }

    for (const pack of parsed.packs) {
      if (!pack.id || !pack.title || !Array.isArray(pack.questions)) {
        throw new Error(`Pack inválido en questions.json: ${pack?.id || 'sin id'}`);
      }
      for (const q of pack.questions) {
        this.#validateQuestion(q);
      }
    }

    this.packs = parsed.packs;
  }

  #validateQuestion(q) {
    if (!q.id || !q.prompt) {
      throw new Error(`Pregunta sin id o enunciado: ${JSON.stringify(q)}`);
    }
    if (!VALID_TYPES.has(q.type)) {
      throw new Error(`Tipo de pregunta inválido "${q.type}" en ${q.id}`);
    }
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) {
      throw new Error(`La pregunta ${q.id} debe tener entre 2 y 6 opciones.`);
    }
    if (!Array.isArray(q.correctOptionIds) || q.correctOptionIds.length === 0) {
      throw new Error(`La pregunta ${q.id} debe definir al menos una respuesta correcta.`);
    }
    const optionIds = new Set(q.options.map((o) => o.id));
    for (const cid of q.correctOptionIds) {
      if (!optionIds.has(cid)) {
        throw new Error(`correctOptionIds "${cid}" no existe en opciones de ${q.id}`);
      }
    }
  }

  /**
   * Devuelve metadatos de los packs disponibles (sin respuestas).
   */
  getPacksSummary() {
    const totalQuestions = this.packs.reduce((acc, p) => acc + p.questions.length, 0);
    return [
      {
        id: 'all',
        title: 'Todos los packs mezclados',
        description: 'Mezcla aleatoria de todo el catálogo disponible',
        questionCount: totalQuestions,
      },
      ...this.packs.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description || '',
        questionCount: p.questions.length,
      })),
    ];
  }

  /**
   * Selecciona un subconjunto mezclado de preguntas para una partida.
   */
  pickQuestions(packId = 'all', count = 10) {
    let pool = [];
    if (packId === 'all') {
      pool = this.packs.flatMap((p) => p.questions);
    } else {
      const pack = this.packs.find((p) => p.id === packId);
      pool = pack ? [...pack.questions] : this.packs.flatMap((p) => p.questions);
    }

    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const limit = Math.max(1, Math.min(Number(count) || 10, shuffled.length));
    return shuffled.slice(0, limit).map((q) => structuredClone(q));
  }

  /**
   * Elimina respuestas correctas y explicaciones antes de enviar la pregunta activa al cliente.
   */
  static sanitizeForClient(question) {
    return {
      id: question.id,
      type: question.type,
      category: question.category || 'General',
      difficulty: question.difficulty || 'medium',
      timeLimit: question.timeLimit || 20,
      prompt: question.prompt,
      media: {
        questionImage: question.media?.questionImage || null,
        questionAudio: question.media?.questionAudio || null,
      },
      options: question.options.map((o) => ({ id: o.id, text: o.text })),
    };
  }
}

