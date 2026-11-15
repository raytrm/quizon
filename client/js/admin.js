import { escapeHtml, showToast } from './common/utils.js';

const OPT_IDS = ['a', 'b', 'c', 'd', 'e', 'f'];

let catalog = { catalogId: '000001', packs: [] };
let selectedPackId = 'all';
let selectedQuestionId = null;

const elPackSelect = document.getElementById('adm-pack-select');
const elFormPack = document.getElementById('f-pack');
const elQList = document.getElementById('adm-q-list');
const elQCount = document.getElementById('adm-q-count');
const elSearch = document.getElementById('adm-search');

const elPackEditor = document.getElementById('pack-editor-box');
const elPackEditId = document.getElementById('pack-edit-id');
const elPackEditTitle = document.getElementById('pack-edit-title');
const elPackEditDesc = document.getElementById('pack-edit-desc');

const elEditorTitle = document.getElementById('editor-title');
const elEditorBadge = document.getElementById('editor-id-badge');
const elType = document.getElementById('f-type');
const elCategory = document.getElementById('f-category');
const elDifficulty = document.getElementById('f-difficulty');
const elTimeLimit = document.getElementById('f-timelimit');
const elPrompt = document.getElementById('f-prompt');
const elOptionsList = document.getElementById('f-options-list');
const elExplanation = document.getElementById('f-explanation');
const elExtraFact = document.getElementById('f-extra-fact');
const elDeleteQBtn = document.getElementById('btn-delete-question');
const elMediaSection = document.getElementById('adm-media-section');
const elMediaPathLabel = document.getElementById('media-path-label');

async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Error HTTP ${res.status}`);
  }
  return data;
}

function findQuestionById(qId) {
  for (const pack of catalog.packs) {
    const q = pack.questions.find((item) => item.id === qId);
    if (q) return { pack, question: q };
  }
  return null;
}

function renderPackSelectors() {
  const currentFilter = selectedPackId;
  elPackSelect.innerHTML = [
    '<option value="all">Todos los packs</option>',
    ...catalog.packs.map(
      (p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)} (${p.questions.length})</option>`
    ),
  ].join('');
  elPackSelect.value =
    currentFilter === 'all' || catalog.packs.some((p) => p.id === currentFilter) ? currentFilter : 'all';
  selectedPackId = elPackSelect.value;

  const prevFormPack = elFormPack.value;
  elFormPack.innerHTML = catalog.packs
    .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)}</option>`)
    .join('');
  if (prevFormPack && catalog.packs.some((p) => p.id === prevFormPack)) {
    elFormPack.value = prevFormPack;
  } else if (selectedPackId !== 'all') {
    elFormPack.value = selectedPackId;
  }
}

function renderQuestionsList() {
  const query = elSearch.value.trim().toLowerCase();
  const rows = [];

  for (const pack of catalog.packs) {
    if (selectedPackId !== 'all' && pack.id !== selectedPackId) continue;
    for (const q of pack.questions) {
      const hay = `${q.id} ${q.prompt} ${q.category}`.toLowerCase();
      if (query && !hay.includes(query)) continue;
      rows.push({ pack, q });
    }
  }

  elQCount.textContent = String(rows.length);
  if (!rows.length) {
    elQList.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; padding: 0.6rem 0;">Sin preguntas que coincidan.</div>';
    return;
  }

  elQList.innerHTML = rows
    .map(({ q }) => {
      const activeClass = q.id === selectedQuestionId ? 'active' : '';
      const bgCount = q.media?.bg?.length || 0;
      const clueCount = q.media?.clue?.length || 0;
      const expCount = q.media?.explain?.length || 0;
      const mediaTag = bgCount + clueCount + expCount > 0 ? `🖼️ ${bgCount}/${clueCount}/${expCount}` : '';
      return `
        <button class="q-item ${activeClass}" type="button" data-qid="${escapeHtml(q.id)}">
          <div class="q-item-meta">
            <span>#${escapeHtml(q.id)} · ${escapeHtml(q.category)}</span>
            <span>${mediaTag}</span>
          </div>
          <div style="font-size: 0.9rem; font-weight: 600; line-height: 1.3;">${escapeHtml(q.prompt)}</div>
        </button>
      `;
    })
    .join('');

  elQList.querySelectorAll('[data-qid]').forEach((btn) => {
    btn.addEventListener('click', () => selectQuestion(btn.dataset.qid));
  });
}

function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function resizeAllFormTextareas() {
  [elPrompt, elExplanation, elExtraFact, ...elOptionsList.querySelectorAll('textarea.opt-text-input')].forEach(
    autoResizeTextarea
  );
}

function renderOptionsEditor(options, correctIds) {
  const correctSet = new Set(correctIds || []);
  elOptionsList.innerHTML = '';

  options.forEach((opt, idx) => {
    const row = document.createElement('div');
    row.className = 'opt-editor-row';
    const letter = OPT_IDS[idx] || String(idx + 1);
    row.innerHTML = `
      <span class="badge" style="justify-content: center;">${letter.toUpperCase()}</span>
      <textarea class="opt-text-input" rows="1" placeholder="Texto de la opción..." required></textarea>
      <label style="display: flex; align-items: center; gap: 0.3rem; font-size: 0.84rem; margin: 0; cursor: pointer;">
        <input type="checkbox" class="opt-correct-chk" ${correctSet.has(opt.id) ? 'checked' : ''} style="width: auto;" />
        Correcta
      </label>
      <button type="button" class="btn btn-ghost opt-remove-btn" style="padding: 0.35rem 0.55rem; font-size: 0.8rem;">✕</button>
    `;

    const optTextarea = row.querySelector('.opt-text-input');
    optTextarea.value = opt.text || '';
    optTextarea.addEventListener('input', () => autoResizeTextarea(optTextarea));

    row.querySelector('.opt-remove-btn').addEventListener('click', () => {
      if (elOptionsList.children.length <= 2) {
        showToast('Mínimo 2 opciones por pregunta.');
        return;
      }
      row.remove();
      renumberOptionBadges();
    });

    elOptionsList.appendChild(row);
    autoResizeTextarea(optTextarea);
  });
}

function renumberOptionBadges() {
  Array.from(elOptionsList.children).forEach((row, idx) => {
    row.querySelector('.badge').textContent = (OPT_IDS[idx] || String(idx + 1)).toUpperCase();
  });
}

function renderMediaThumbnails(media) {
  for (const role of ['bg', 'clue', 'explain']) {
    const container = document.getElementById(`thumbs-${role}`);
    const list = media?.[role] || [];
    const audioList = media?.audio?.[role] || [];

    const imgsHtml = list
      .map(
        (item) => `
        <div class="media-thumb" title="${escapeHtml(item.name)}">
          <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.name)}" />
          <button type="button" data-del-role="${role}" data-del-name="${escapeHtml(item.name)}">✕</button>
        </div>
      `
      )
      .join('');

    const audiosHtml = audioList
      .map(
        (item) => `
        <div style="grid-column: 1 / -1; display: flex; align-items: center; gap: 0.4rem; background: rgba(9,13,31,0.75); padding: 0.35rem 0.5rem; border-radius: 8px; border: 1px solid var(--border-subtle);">
          <span style="font-size: 0.75rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px;" title="${escapeHtml(item.name)}">🔊 ${escapeHtml(item.name)}</span>
          <audio controls src="${escapeHtml(item.url)}" style="height: 28px; flex: 1; min-width: 120px;"></audio>
          <button type="button" data-del-role="${role}" data-del-name="${escapeHtml(item.name)}" style="background: rgba(239,68,68,0.9); color: #fff; border: none; border-radius: 6px; padding: 2px 7px; font-size: 0.75rem; cursor: pointer;">✕</button>
        </div>
      `
      )
      .join('');

    container.innerHTML = imgsHtml + audiosHtml;

    container.querySelectorAll('[data-del-name]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!selectedQuestionId) return;
        try {
          const res = await apiJson(
            `/api/admin/media/${encodeURIComponent(catalog.catalogId)}/${encodeURIComponent(selectedQuestionId)}/${encodeURIComponent(btn.dataset.delRole)}/${encodeURIComponent(btn.dataset.delName)}`,
            { method: 'DELETE' }
          );
          const found = findQuestionById(selectedQuestionId);
          if (found) found.question.media = res.media;
          renderMediaThumbnails(res.media);
          renderQuestionsList();
          showToast('Archivo eliminado.');
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }
}

function selectQuestion(qId) {
  const found = findQuestionById(qId);
  if (!found) return;
  const { pack, question } = found;
  selectedQuestionId = question.id;

  elEditorTitle.textContent = `Editar Pregunta #${question.id}`;
  elEditorBadge.textContent = `ID ${question.id}`;
  elFormPack.value = pack.id;
  elType.value = question.type;
  elCategory.value = question.category || 'General';
  elDifficulty.value = question.difficulty || 'medium';
  elTimeLimit.value = question.timeLimit || 20;
  elPrompt.value = question.prompt || '';
  elExplanation.value = question.explanation || '';
  elExtraFact.value = question.extraFact || '';

  renderOptionsEditor(question.options || [], question.correctOptionIds || []);
  elDeleteQBtn.classList.remove('hidden');

  elMediaSection.classList.remove('hidden');
  elMediaPathLabel.textContent = `${catalog.catalogId}/${question.id}`;
  renderMediaThumbnails(question.media || { bg: [], clue: [], explain: [] });
  renderQuestionsList();
  requestAnimationFrame(resizeAllFormTextareas);
}

function startNewQuestion() {
  selectedQuestionId = null;
  elEditorTitle.textContent = 'Nueva Pregunta';
  elEditorBadge.textContent = 'ID automático';
  if (selectedPackId !== 'all') {
    elFormPack.value = selectedPackId;
  }
  elType.value = 'single_choice';
  elCategory.value = 'General';
  elDifficulty.value = 'medium';
  elTimeLimit.value = 20;
  elPrompt.value = '';
  elExplanation.value = '';
  elExtraFact.value = '';
  renderOptionsEditor(
    [
      { id: 'a', text: '' },
      { id: 'b', text: '' },
      { id: 'c', text: '' },
      { id: 'd', text: '' },
    ],
    ['a']
  );
  elDeleteQBtn.classList.add('hidden');
  elMediaSection.classList.add('hidden');
  renderQuestionsList();
  requestAnimationFrame(resizeAllFormTextareas);
}

[elPrompt, elExplanation, elExtraFact].forEach((el) => {
  el.addEventListener('input', () => autoResizeTextarea(el));
});
window.addEventListener('resize', resizeAllFormTextareas);

async function loadCatalog(keepQuestionId = selectedQuestionId) {
  catalog = await apiJson('/api/admin/catalog');
  renderPackSelectors();
  renderQuestionsList();
  if (keepQuestionId && findQuestionById(keepQuestionId)) {
    selectQuestion(keepQuestionId);
  } else if (catalog.packs[0]?.questions[0] && keepQuestionId === undefined) {
    selectQuestion(catalog.packs[0].questions[0].id);
  } else if (!keepQuestionId) {
    startNewQuestion();
  }
}

// Eventos de Packs
elPackSelect.addEventListener('change', () => {
  selectedPackId = elPackSelect.value;
  renderQuestionsList();
});

elSearch.addEventListener('input', renderQuestionsList);

document.getElementById('btn-new-pack').addEventListener('click', () => {
  elPackEditId.value = '';
  elPackEditTitle.value = '';
  elPackEditDesc.value = '';
  elPackEditor.classList.remove('hidden');
});

document.getElementById('btn-edit-pack').addEventListener('click', () => {
  if (selectedPackId === 'all') {
    showToast('Selecciona primero un pack concreto.');
    return;
  }
  const pack = catalog.packs.find((p) => p.id === selectedPackId);
  if (!pack) return;
  elPackEditId.value = pack.id;
  elPackEditTitle.value = pack.title;
  elPackEditDesc.value = pack.description || '';
  elPackEditor.classList.remove('hidden');
});

document.getElementById('btn-cancel-pack').addEventListener('click', () => {
  elPackEditor.classList.add('hidden');
});

document.getElementById('btn-save-pack').addEventListener('click', async () => {
  try {
    const res = await apiJson('/api/admin/packs', {
      method: 'POST',
      body: JSON.stringify({
        id: elPackEditId.value || undefined,
        title: elPackEditTitle.value,
        description: elPackEditDesc.value,
      }),
    });
    selectedPackId = res.packId;
    elPackEditor.classList.add('hidden');
    await loadCatalog(selectedQuestionId);
    showToast('Pack guardado.');
  } catch (err) {
    showToast(err.message);
  }
});

document.getElementById('btn-delete-pack').addEventListener('click', async () => {
  if (selectedPackId === 'all') {
    showToast('Selecciona un pack concreto para eliminar.');
    return;
  }
  const pack = catalog.packs.find((p) => p.id === selectedPackId);
  if (!pack || !confirm(`¿Eliminar el pack "${pack.title}" y todas sus ${pack.questions.length} preguntas?`)) {
    return;
  }
  try {
    await apiJson(`/api/admin/packs/${encodeURIComponent(selectedPackId)}`, { method: 'DELETE' });
    selectedPackId = 'all';
    selectedQuestionId = null;
    await loadCatalog(null);
    showToast('Pack eliminado.');
  } catch (err) {
    showToast(err.message);
  }
});

// Eventos de Pregunta
document.getElementById('btn-new-question').addEventListener('click', startNewQuestion);

document.getElementById('btn-add-option').addEventListener('click', () => {
  const count = elOptionsList.children.length;
  if (count >= 6) {
    showToast('Máximo 6 opciones por pregunta.');
    return;
  }
  const current = collectOptionsFromForm();
  current.options.push({ id: OPT_IDS[count], text: '' });
  renderOptionsEditor(current.options, current.correctOptionIds);
});

elType.addEventListener('change', () => {
  if (elType.value === 'true_false') {
    renderOptionsEditor(
      [
        { id: 'a', text: 'Verdadero' },
        { id: 'b', text: 'Falso' },
      ],
      ['a']
    );
  }
});

function collectOptionsFromForm() {
  const options = [];
  const correctOptionIds = [];
  Array.from(elOptionsList.children).forEach((row, idx) => {
    const id = OPT_IDS[idx] || String(idx + 1);
    const text = row.querySelector('.opt-text-input').value.trim();
    const isCorrect = row.querySelector('.opt-correct-chk').checked;
    options.push({ id, text });
    if (isCorrect) correctOptionIds.push(id);
  });
  return { options, correctOptionIds };
}

document.getElementById('q-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { options, correctOptionIds } = collectOptionsFromForm();
  if (options.some((o) => !o.text)) {
    showToast('Todas las opciones deben tener texto.');
    return;
  }
  if (!correctOptionIds.length) {
    showToast('Marca al menos una opción correcta.');
    return;
  }

  const payload = {
    packId: elFormPack.value,
    type: elType.value,
    category: elCategory.value,
    difficulty: elDifficulty.value,
    timeLimit: Number(elTimeLimit.value) || 20,
    prompt: elPrompt.value,
    options,
    correctOptionIds,
    explanation: elExplanation.value,
    extraFact: elExtraFact.value,
  };

  try {
    let savedId = selectedQuestionId;
    if (selectedQuestionId) {
      await apiJson(`/api/admin/questions/${encodeURIComponent(selectedQuestionId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      showToast('Pregunta actualizada.');
    } else {
      const res = await apiJson('/api/admin/questions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      savedId = res.question.id;
      showToast(`Pregunta #${savedId} creada. Ya puedes subirle imágenes.`);
    }
    await loadCatalog(savedId);
  } catch (err) {
    showToast(err.message);
  }
});

elDeleteQBtn.addEventListener('click', async () => {
  if (!selectedQuestionId || !confirm(`¿Eliminar la pregunta #${selectedQuestionId}?`)) return;
  try {
    await apiJson(`/api/admin/questions/${encodeURIComponent(selectedQuestionId)}`, { method: 'DELETE' });
    selectedQuestionId = null;
    await loadCatalog(null);
    showToast('Pregunta eliminada.');
  } catch (err) {
    showToast(err.message);
  }
});

// Subida de imágenes
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  });
}

document.querySelectorAll('[data-upload-role]').forEach((input) => {
  input.addEventListener('change', async () => {
    if (!selectedQuestionId || !input.files?.length) return;
    const role = input.dataset.uploadRole;
    try {
      let latestMedia = null;
      for (const file of Array.from(input.files)) {
        const dataUrl = await readFileAsDataUrl(file);
        const res = await apiJson(
          `/api/admin/media/${encodeURIComponent(catalog.catalogId)}/${encodeURIComponent(selectedQuestionId)}/${encodeURIComponent(role)}`,
          {
            method: 'POST',
            body: JSON.stringify({ filename: file.name, dataUrl }),
          }
        );
        latestMedia = res.media;
      }
      if (latestMedia) {
        const found = findQuestionById(selectedQuestionId);
        if (found) found.question.media = latestMedia;
        renderMediaThumbnails(latestMedia);
        renderQuestionsList();
      }
      showToast(`Imagen(es) subida(s) a ${role}/`);
    } catch (err) {
      showToast(err.message);
    } finally {
      input.value = '';
    }
  });
});

loadCatalog(undefined).catch((err) => showToast(err.message));
