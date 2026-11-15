import fs from 'node:fs';
import path from 'node:path';

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg)$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|aac|flac|opus|weba)$/i;
const PREFIX_RE = /^(bg|clue|explain)_(\d+)(?:_|\.)/i;
const MEDIA_ROLES = ['bg', 'clue', 'explain'];

/**
 * Escanea una carpeta de medios (imágenes y audios) de pregunta.
 * Soporta subcarpetas `bg/`, `clue/`, `explain/` y archivos en raíz con prefijo `bg_N_`, `clue_N_`, `explain_N_`.
 *
 * @param {string} targetDir
 * @param {string} urlPrefix
 * @returns {{ bg: Array<object>, clue: Array<object>, explain: Array<object>, audio: { bg: Array<object>, clue: Array<object>, explain: Array<object> } } | null}
 */
export function scanMediaDirectory(targetDir, urlPrefix) {
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    return null;
  }

  const buckets = {
    bg: [],
    clue: [],
    explain: [],
    audio: { bg: [], clue: [], explain: [] },
  };

  for (const role of MEDIA_ROLES) {
    const subDir = path.join(targetDir, role);
    if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
      const subFiles = fs
        .readdirSync(subDir, { withFileTypes: true })
        .filter((d) => d.isFile() && (IMAGE_EXT_RE.test(d.name) || AUDIO_EXT_RE.test(d.name)))
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      let imgIdx = 0;
      let audIdx = 0;
      for (const name of subFiles) {
        const url = `${urlPrefix}/${role}/${encodeURIComponent(name)}`;
        if (AUDIO_EXT_RE.test(name)) {
          audIdx++;
          buckets.audio[role].push({ name, order: audIdx, url });
        } else {
          imgIdx++;
          buckets[role].push({ name, order: imgIdx, url });
        }
      }
    }
  }

  const rootFiles = fs
    .readdirSync(targetDir, { withFileTypes: true })
    .filter((d) => d.isFile() && (IMAGE_EXT_RE.test(d.name) || AUDIO_EXT_RE.test(d.name)));

  for (const entry of rootFiles) {
    const match = entry.name.match(PREFIX_RE);
    if (!match) continue;
    const role = match[1].toLowerCase();
    const order = Number(match[2]);
    const item = {
      name: entry.name,
      order,
      url: `${urlPrefix}/${encodeURIComponent(entry.name)}`,
    };
    if (AUDIO_EXT_RE.test(entry.name)) {
      buckets.audio[role].push(item);
    } else {
      buckets[role].push(item);
    }
  }

  for (const role of MEDIA_ROLES) {
    buckets[role].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, undefined, { numeric: true }));
    buckets.audio[role].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  return buckets;
}

/**
 * Resuelve las rutas de medios para una pregunta concreta dentro de `data/images/<catalogId>/<questionId>/`.
 *
 * @param {string} imagesRootDir
 * @param {string} catalogId
 * @param {string} questionId
 * @returns {{ bg: Array<object>, clue: Array<object>, explain: Array<object>, audio: { bg: Array<object>, clue: Array<object>, explain: Array<object> } }}
 */
export function resolveQuestionMedia(imagesRootDir, catalogId, questionId) {
  const safeCatalog = path.basename(String(catalogId || '000001'));
  const safeQuestion = path.basename(String(questionId || ''));
  const targetDir = path.join(imagesRootDir, safeCatalog, safeQuestion);
  const urlPrefix = `/media/${encodeURIComponent(safeCatalog)}/${encodeURIComponent(safeQuestion)}`;
  return (
    scanMediaDirectory(targetDir, urlPrefix) || {
      bg: [],
      clue: [],
      explain: [],
      audio: { bg: [], clue: [], explain: [] },
    }
  );
}
