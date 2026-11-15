import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUESTIONS_PATH = path.resolve(__dirname, '../data/questions.json');
const IMAGES_DIR = path.resolve(__dirname, '../data/images');

const data = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf-8'));
const catalogId = String(data.catalogId || '000001');

const SUBFOLDERS = ['bg', 'clue', 'explain'];

let createdCount = 0;
for (const pack of data.packs || []) {
  for (const q of pack.questions || []) {
    const qDir = path.join(IMAGES_DIR, catalogId, String(q.id));
    for (const sub of SUBFOLDERS) {
      const subDir = path.join(qDir, sub);
      if (!fs.existsSync(subDir)) {
        fs.mkdirSync(subDir, { recursive: true });
        createdCount++;
      }
    }
  }
}

console.log(`Estructura verificada en data/images/${catalogId}/ (${createdCount} subcarpetas nuevas creadas).`);
