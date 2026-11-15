import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { resolveQuestionMedia } from './media-scanner.js';

const VALID_ROLES = new Set(['bg', 'clue', 'explain']);

function slugifyPackId(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || `pack-${Date.now()}`;
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || 'imagen.png'));
  return base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+/, '') || 'imagen.png';
}

function getNextQuestionId(data) {
  let max = 0;
  for (const pack of data.packs || []) {
    for (const q of pack.questions || []) {
      const n = Number.parseInt(q.id, 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return String(max + 1).padStart(5, '0');
}

function ensureQuestionFolders(imagesDir, catalogId, questionId) {
  const qDir = path.join(imagesDir, path.basename(catalogId), path.basename(questionId));
  for (const role of VALID_ROLES) {
    fs.mkdirSync(path.join(qDir, role), { recursive: true });
  }
}

/**
 * Router REST para administrar packs, preguntas e imágenes.
 */
export function createAdminRouter(questionStore, imagesDir) {
  const router = express.Router();
  router.use(express.json({ limit: '15mb' }));

  const readCatalogRaw = () => JSON.parse(fs.readFileSync(questionStore.filePath, 'utf-8'));

  const saveAndReload = (nextData) => {
    const previousRaw = fs.readFileSync(questionStore.filePath, 'utf-8');
    fs.writeFileSync(questionStore.filePath, `${JSON.stringify(nextData, null, 2)}\n`, 'utf-8');
    try {
      questionStore.reload();
    } catch (err) {
      fs.writeFileSync(questionStore.filePath, previousRaw, 'utf-8');
      questionStore.reload();
      throw err;
    }
  };

  router.get('/catalog', (_req, res) => {
    const catalogId = questionStore.catalogId;
    const packs = questionStore.packs.map((pack) => ({
      id: pack.id,
      title: pack.title,
      description: pack.description || '',
      questions: pack.questions.map((q) => ({
        id: q.id,
        type: q.type,
        category: q.category || 'General',
        difficulty: q.difficulty || 'medium',
        timeLimit: q.timeLimit || 20,
        prompt: q.prompt,
        options: q.options,
        correctOptionIds: q.correctOptionIds,
        explanation: q.explanation || '',
        extraFact: q.extraFact || '',
        media: resolveQuestionMedia(imagesDir, catalogId, q.id),
      })),
    }));
    res.json({ catalogId, packs });
  });

  router.post('/packs', (req, res) => {
    const { id, title, description } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'El título del pack es obligatorio.' });
    }
    const data = readCatalogRaw();
    const packId = id ? String(id).trim() : slugifyPackId(title);
    const existing = data.packs.find((p) => p.id === packId);

    if (existing) {
      existing.title = String(title).trim();
      existing.description = String(description || '').trim();
    } else {
      data.packs.push({
        id: packId,
        title: String(title).trim(),
        description: String(description || '').trim(),
        questions: [],
      });
    }

    try {
      saveAndReload(data);
      res.json({ ok: true, packId });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/packs/:packId', (req, res) => {
    const packId = String(req.params.packId || '');
    const data = readCatalogRaw();
    const idx = data.packs.findIndex((p) => p.id === packId);
    if (idx === -1) {
      return res.status(404).json({ error: 'Pack no encontrado.' });
    }
    data.packs.splice(idx, 1);
    try {
      saveAndReload(data);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/questions', (req, res) => {
    const body = req.body || {};
    const data = readCatalogRaw();
    const pack = data.packs.find((p) => p.id === body.packId);
    if (!pack) {
      return res.status(400).json({ error: 'Pack destino no encontrado.' });
    }

    const newId = getNextQuestionId(data);
    const newQuestion = {
      id: newId,
      type: body.type || 'single_choice',
      category: String(body.category || 'General').trim(),
      difficulty: body.difficulty || 'medium',
      timeLimit: Number(body.timeLimit) || 20,
      prompt: String(body.prompt || '').trim(),
      options: Array.isArray(body.options) ? body.options : [],
      correctOptionIds: Array.isArray(body.correctOptionIds) ? body.correctOptionIds : [],
      explanation: String(body.explanation || '').trim(),
      extraFact: String(body.extraFact || '').trim(),
    };

    pack.questions.push(newQuestion);
    try {
      saveAndReload(data);
      ensureQuestionFolders(imagesDir, data.catalogId || questionStore.catalogId, newId);
      res.status(201).json({
        ok: true,
        question: {
          ...newQuestion,
          media: resolveQuestionMedia(imagesDir, questionStore.catalogId, newId),
        },
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/questions/:questionId', (req, res) => {
    const qId = String(req.params.questionId || '');
    const body = req.body || {};
    const data = readCatalogRaw();

    let sourcePack = null;
    let sourceIdx = -1;
    for (const p of data.packs) {
      const idx = p.questions.findIndex((q) => q.id === qId);
      if (idx !== -1) {
        sourcePack = p;
        sourceIdx = idx;
        break;
      }
    }
    if (!sourcePack) {
      return res.status(404).json({ error: 'Pregunta no encontrada.' });
    }

    const updated = {
      id: qId,
      type: body.type || 'single_choice',
      category: String(body.category || 'General').trim(),
      difficulty: body.difficulty || 'medium',
      timeLimit: Number(body.timeLimit) || 20,
      prompt: String(body.prompt || '').trim(),
      options: Array.isArray(body.options) ? body.options : [],
      correctOptionIds: Array.isArray(body.correctOptionIds) ? body.correctOptionIds : [],
      explanation: String(body.explanation || '').trim(),
      extraFact: String(body.extraFact || '').trim(),
    };

    const targetPackId = body.packId || sourcePack.id;
    if (targetPackId !== sourcePack.id) {
      const targetPack = data.packs.find((p) => p.id === targetPackId);
      if (!targetPack) {
        return res.status(400).json({ error: 'Pack destino no encontrado.' });
      }
      sourcePack.questions.splice(sourceIdx, 1);
      targetPack.questions.push(updated);
    } else {
      sourcePack.questions[sourceIdx] = updated;
    }

    try {
      saveAndReload(data);
      res.json({
        ok: true,
        question: {
          ...updated,
          media: resolveQuestionMedia(imagesDir, questionStore.catalogId, qId),
        },
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/questions/:questionId', (req, res) => {
    const qId = String(req.params.questionId || '');
    const data = readCatalogRaw();
    let removed = false;
    for (const p of data.packs) {
      const idx = p.questions.findIndex((q) => q.id === qId);
      if (idx !== -1) {
        p.questions.splice(idx, 1);
        removed = true;
        break;
      }
    }
    if (!removed) {
      return res.status(404).json({ error: 'Pregunta no encontrada.' });
    }
    try {
      saveAndReload(data);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/media/:catalogId/:questionId/:role', (req, res) => {
    const catalogId = path.basename(String(req.params.catalogId || ''));
    const questionId = path.basename(String(req.params.questionId || ''));
    const role = String(req.params.role || '').toLowerCase();
    if (!VALID_ROLES.has(role)) {
      return res.status(400).json({ error: 'Rol de imagen inválido (usa bg, clue o explain).' });
    }

    const { filename, dataUrl } = req.body || {};
    const match = String(dataUrl || '').match(/^data:(?:image|audio)\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Formato de archivo inválido (se espera imagen o audio en base64).' });
    }

    const roleDir = path.join(imagesDir, catalogId, questionId, role);
    fs.mkdirSync(roleDir, { recursive: true });

    const existingFiles = fs.readdirSync(roleDir).filter((f) => !f.startsWith('.'));
    const nextNum = String(existingFiles.length + 1).padStart(2, '0');
    const cleanName = sanitizeFilename(filename).replace(/^\d+[_-]?/, '');
    const finalName = `${nextNum}_${cleanName}`;

    const buffer = Buffer.from(match[2], 'base64');
    fs.writeFileSync(path.join(roleDir, finalName), buffer);
    questionStore.reload();

    res.status(201).json({
      ok: true,
      filename: finalName,
      media: resolveQuestionMedia(imagesDir, catalogId, questionId),
    });
  });

  router.delete('/media/:catalogId/:questionId/:role/:filename', (req, res) => {
    const catalogId = path.basename(String(req.params.catalogId || ''));
    const questionId = path.basename(String(req.params.questionId || ''));
    const role = String(req.params.role || '').toLowerCase();
    const filename = path.basename(String(req.params.filename || ''));
    if (!VALID_ROLES.has(role)) {
      return res.status(400).json({ error: 'Rol de imagen inválido.' });
    }

    const rolePath = path.join(imagesDir, catalogId, questionId, role, filename);
    const rootPath = path.join(imagesDir, catalogId, questionId, filename);
    if (fs.existsSync(rolePath)) {
      fs.unlinkSync(rolePath);
    } else if (fs.existsSync(rootPath)) {
      fs.unlinkSync(rootPath);
    } else {
      return res.status(404).json({ error: 'Imagen no encontrada.' });
    }

    questionStore.reload();
    res.json({
      ok: true,
      media: resolveQuestionMedia(imagesDir, catalogId, questionId),
    });
  });

  return router;
}
