// editor.js — full-page step editor
applyI18n();

// ── DOM ───────────────────────────────────────────────────────────────
const dropZone        = document.getElementById('dropZone');
const fileInput       = document.getElementById('fileInput');
const btnPickFolder   = document.getElementById('btnPickFolder');
const folderInput     = document.getElementById('folderInput');
const loadArea        = document.getElementById('loadArea');
const stepsArea       = document.getElementById('stepsArea');
const stepsList       = document.getElementById('stepsList');
const toolbarFilename = document.getElementById('toolbarFilename');
const btnCloseFile    = document.getElementById('btnCloseFile');
const docTitleText    = document.getElementById('docTitleText');
const enabledCount    = document.getElementById('enabledCount');
const chkAllLabel     = document.getElementById('chkAllLabel');
const chkAll          = document.getElementById('chkAll');
const chkUrlLabel     = document.getElementById('chkUrlLabel');
const chkShowUrl      = document.getElementById('chkShowUrl');
const btnExport          = document.getElementById('btnExport');
const btnPreviewViewer   = document.getElementById('btnPreviewViewer');
const toast           = document.getElementById('toast');

// ── Action options ────────────────────────────────────────────────────
const ACTION_OPTS = [
  { key: 'click',  color: '#e94560' },
  { key: 'input',  color: '#4a9eff' },
  { key: 'select', color: '#50c878' },
];
const ACTION_LABEL_TO_KEY = {
  'クリック':'click','Click':'click',
  '入力':'input','Input':'input',
  '選択':'select','Select':'select',
};
function actionToKey(label) { return ACTION_LABEL_TO_KEY[label] || 'click'; }

// ── State ─────────────────────────────────────────────────────────────
let importedSteps = [];
let importedTitle = '操作手順書';
let importedFilename = '';
let sourceNavZip = null;       // original JSZip when a nav ZIP is loaded
let sourceNavDocPrefix = '';   // e.g. 'doc_001'
let showUrl = localStorage.getItem('showUrl') !== 'false';
let pendingSingleCaptureIdx = null;
let dragSrcArrayIdx = null;
let navDocs = [];        // [{ prefix, path, title, steps }]  steps=null = not yet loaded
let activeNavDocIdx = -1;

chkShowUrl.checked = showUrl;
chkShowUrl.addEventListener('change', () => {
  showUrl = chkShowUrl.checked;
  localStorage.setItem('showUrl', showUrl);
});

// ── Theme toggle ───────────────────────────────────────────────────────
const btnToggleTheme = document.getElementById('btnToggleTheme');
let theme = localStorage.getItem('theme') || 'dark';
function applyTheme() {
  document.body.classList.toggle('light-mode', theme === 'light');
  btnToggleTheme.textContent = theme === 'light' ? '🌙' : '☀';
}
applyTheme();
btnToggleTheme.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', theme);
  applyTheme();
});

document.getElementById('btnOpenFinalizer').addEventListener('click', () => {
  window.open(chrome.runtime.getURL ? chrome.runtime.getURL('finalizer.html') : 'finalizer.html', '_blank');
});

// ── File loading ──────────────────────────────────────────────────────
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });

function loadFile(file) {
  if (file.name.split('.').pop().toLowerCase() === 'zip') loadZipFile(file);
  else showToast(t('toast.zip.only'));
}

btnPickFolder.addEventListener('click', () => folderInput.click());
folderInput.addEventListener('change', async () => {
  await loadFolderFiles(folderInput.files);
  folderInput.value = '';
});

async function loadFolderFiles(fileList) {
  const files = [...fileList];
  const top = files[0]?.webkitRelativePath.split('/')[0] || '';
  const htmlFile = files.find(f => f.webkitRelativePath === `${top}/index.html`);
  if (!htmlFile) { showToast(t('toast.folder.no.index')); return; }

  parseImportedHTML(await readAsText(htmlFile));

  const shots = files.filter(f => {
    const p = f.webkitRelativePath.split('/');
    return p.length === 3 && p[1] === 'screenshots';
  });
  await Promise.all(shots.map(f => readAsDataURL(f).then(url => {
    const rel = f.webkitRelativePath.split('/').slice(1).join('/');
    importedSteps.forEach(s => { if (s.screenshot === rel) s.screenshot = url; });
  })));

  showLoadedUI(top);
}

async function loadZipFile(file) {
  if (typeof JSZip === 'undefined') { showToast(t('toast.jszip.wait')); return; }
  importedFilename = file.name.replace(/\.zip$/i, '');
  try {
    const zip = await JSZip.loadAsync(file);

    // Detect nav ZIP (multiple docs)
    const subDocPaths = [];
    zip.forEach((relPath, entry) => {
      if (!entry.dir && /^doc_\d+\/index\.html$/.test(relPath)) subDocPaths.push(relPath);
    });
    if (subDocPaths.length > 0) {
      await loadNavZip(zip, subDocPaths.sort(), file.name);
      return;
    }

    const htmlEntry = zip.file('index.html');
    if (!htmlEntry) { showToast(t('toast.no.index')); return; }
    parseImportedHTML(await htmlEntry.async('string'));

    const MIME = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif' };
    const dataUrls = {};
    const tasks = [];
    zip.forEach((rel, entry) => {
      if (!entry.dir && rel.startsWith('screenshots/')) {
        const mime = MIME[rel.split('.').pop().toLowerCase()] || 'image/png';
        tasks.push(entry.async('base64').then(b64 => { dataUrls[rel] = `data:${mime};base64,${b64}`; }));
      }
    });
    await Promise.all(tasks);
    importedSteps.forEach(s => {
      if (s.screenshot && !s.screenshot.startsWith('data:')) s.screenshot = dataUrls[s.screenshot] || null;
    });
    showLoadedUI(file.name);
  } catch (err) { showToast(t('toast.zip.fail')); console.error(err); }
}

async function loadNavZip(zip, subDocPaths, zipName) {
  sourceNavZip = zip;
  sourceNavDocPrefix = '';
  navDocs = await Promise.all(subDocPaths.map(async path => {
    const html = await zip.file(path).async('string');
    const title = new DOMParser().parseFromString(html, 'text/html').querySelector('h1')?.textContent?.replace(/^📋\s*/, '').trim() || path;
    return { path, prefix: path.replace('/index.html', ''), title, steps: null };
  }));
  activeNavDocIdx = -1;
  showLoadedUI(zipName, true);
  await activateNavDoc(0);
  showToast(t('toast.loaded', { name: zipName, n: importedSteps.length }));
}

async function activateNavDoc(idx) {
  // Save current doc state before switching
  if (activeNavDocIdx >= 0) {
    navDocs[activeNavDocIdx].steps = importedSteps.map(s => ({...s}));
    navDocs[activeNavDocIdx].title = importedTitle;
  }
  activeNavDocIdx = idx;
  const doc = navDocs[idx];

  if (doc.steps !== null) {
    importedSteps = doc.steps.map(s => ({...s}));
    importedTitle = doc.title;
  } else {
    const prefix = doc.prefix;
    parseImportedHTML(await sourceNavZip.file(doc.path).async('string'));
    const MIME = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif' };
    const dataUrls = {};
    const tasks = [];
    sourceNavZip.forEach((rel, entry) => {
      if (!entry.dir && rel.startsWith(prefix + '/screenshots/')) {
        const fname = rel.slice(prefix.length + 1);
        const mime = MIME[rel.split('.').pop().toLowerCase()] || 'image/png';
        tasks.push(entry.async('base64').then(b64 => { dataUrls[fname] = `data:${mime};base64,${b64}`; }));
      }
    });
    await Promise.all(tasks);
    importedSteps.forEach(s => {
      if (s.screenshot && !s.screenshot.startsWith('data:')) s.screenshot = dataUrls[s.screenshot] || null;
    });
    doc.steps = importedSteps.map(s => ({...s}));
    doc.title = importedTitle;
  }

  renderNavSidebar();
  docTitleText.textContent = importedTitle;
  renderSteps();
}

function renderNavSidebar() {
  const list = document.getElementById('navDocList');
  if (!list) return;
  list.innerHTML = '';
  navDocs.forEach((doc, i) => {
    const btn = document.createElement('button');
    btn.className = `nav-doc-btn${i === activeNavDocIdx ? ' active' : ''}`;
    btn.innerHTML = `<span class="nav-doc-num">${String(i + 1).padStart(2, '0')}</span><span class="nav-doc-title">${esc(doc.title)}</span>`;
    btn.addEventListener('click', async () => {
      if (i === activeNavDocIdx) return;
      await activateNavDoc(i);
    });
    list.appendChild(btn);
  });
}

function showLoadedUI(name, isNav = false) {
  toolbarFilename.textContent = name; toolbarFilename.style.display = '';
  btnCloseFile.style.display = ''; enabledCount.style.display = '';
  chkAllLabel.style.display = ''; chkUrlLabel.style.display = '';
  btnExport.style.display = ''; btnPreviewViewer.style.display = '';
  loadArea.style.display = 'none'; stepsArea.style.display = '';
  document.getElementById('navSidebar').style.display = isNav ? 'flex' : 'none';
  if (!isNav) {
    docTitleText.textContent = importedTitle;
    showToast(t('toast.loaded', { name, n: importedSteps.length }));
    renderSteps();
  }
}

docTitleText.addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'doc-title-input'; inp.value = importedTitle;
  docTitleText.replaceWith(inp); inp.focus(); inp.select();
  function commit() {
    importedTitle = inp.value.trim() || importedTitle;
    if (activeNavDocIdx >= 0) {
      navDocs[activeNavDocIdx].title = importedTitle;
      renderNavSidebar();
    }
    docTitleText.textContent = importedTitle;
    inp.replaceWith(docTitleText);
  }
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { inp.value = importedTitle; commit(); }
  });
});

function showConfirm(message, sub) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmSub').textContent = sub;
    overlay.style.display = 'flex';
    const ok     = document.getElementById('confirmOk');
    const cancel = document.getElementById('confirmCancel');
    const cleanup = result => { overlay.style.display = 'none'; resolve(result); };
    ok.onclick     = () => cleanup(true);
    cancel.onclick = () => cleanup(false);
    overlay.onclick = e => { if (e.target === overlay) cleanup(false); };
  });
}

// showSaveDialog: resolves to 'save' | 'skip' | null(cancel)
function showSaveDialog(message, skipLabel) {
  return new Promise(resolve => {
    const overlay = document.getElementById('saveDialogOverlay');
    const skipBtn = document.getElementById('saveDialogSkip');
    document.getElementById('saveDialogMessage').textContent = message;
    skipBtn.style.display = skipLabel ? '' : 'none';
    overlay.style.display = 'flex';
    const cleanup = result => { overlay.style.display = 'none'; resolve(result); };
    document.getElementById('saveDialogNew').onclick    = () => cleanup('save');
    skipBtn.onclick                                      = () => cleanup('skip');
    document.getElementById('saveDialogCancel').onclick = () => cleanup(null);
    overlay.onclick = e => { if (e.target === overlay) cleanup(null); };
  });
}

btnCloseFile.addEventListener('click', async () => {
  const ok = await showConfirm(t('confirm.close.file.title'), t('confirm.close.file.sub'));
  if (!ok) return;
  importedSteps = [];
  sourceNavZip = null; sourceNavDocPrefix = '';
  navDocs = []; activeNavDocIdx = -1;
  document.getElementById('navSidebar').style.display = 'none';
  toolbarFilename.style.display = 'none'; btnCloseFile.style.display = 'none';
  enabledCount.style.display = 'none'; chkAllLabel.style.display = 'none';
  chkUrlLabel.style.display = 'none'; btnExport.style.display = 'none'; btnPreviewViewer.style.display = 'none';
  loadArea.style.display = ''; stepsArea.style.display = 'none';
  stepsList.innerHTML = ''; fileInput.value = '';
});

// ── Parse ─────────────────────────────────────────────────────────────
function parseImportedHTML(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  importedTitle = doc.querySelector('h1')?.textContent?.replace(/^📋\s*/, '').trim() || '操作手順書';
  importedSteps = [];
  doc.querySelectorAll('.step-card').forEach((card, i) => {
    const badge    = card.querySelector('.action-badge');
    const titleEl  = card.querySelector('.step-title');
    const detailEl = card.querySelector('.step-detail');
    const imgEl    = card.querySelector('.step-screenshot img');
    let element = titleEl?.textContent?.trim() || '';
    if (badge) element = element.replace(badge.textContent.trim(), '').trim();
    const spans = detailEl ? [...detailEl.querySelectorAll('span')] : [];
    let url = '', value = '', memo = '';
    spans.forEach(sp => {
      const t = sp.textContent.trim();
      if (t.startsWith('🌐')) url = sp.querySelector('a')?.getAttribute('href') || '';
      else if (t.startsWith('⌨')) value = t.replace(/^⌨\s*入力値:\s*/, '');
      else if (t.startsWith('💬')) memo = t.replace(/^💬\s*/, '');
    });
    importedSteps.push({
      idx: i + 1,
      actionKey:   actionToKey(badge?.textContent?.trim() || ''),
      actionColor: ACTION_OPTS.find(a => a.key === actionToKey(badge?.textContent?.trim() || ''))?.color || badge?.style.color || '#888',
      element, url, value, memo,
      screenshot: imgEl?.getAttribute('src') || null,
      enabled: true
    });
  });
}

// ── Render ────────────────────────────────────────────────────────────
function renderSteps() {
  stepsList.innerHTML = '';
  importedSteps.forEach((s, idx) => {
    let host = ''; try { const u = new URL(s.url); host = u.hostname + u.pathname; } catch(_) { host = s.url || ''; }
    const thumbHtml = s.screenshot
      ? `<div class="step-img-wrap">
           <img class="step-img" src="${s.screenshot}" alt="step ${s.idx}">
           <div class="thumb-actions">
             <button class="thumb-btn thumb-btn-rep"    data-idx="${s.idx}">🔄 差し替え</button>
             <button class="thumb-btn thumb-btn-paste"  data-idx="${s.idx}">📋 貼り付け</button>
             <button class="thumb-btn thumb-btn-single" data-idx="${s.idx}">📸 1枚撮る</button>
             <button class="thumb-btn thumb-btn-del"    data-idx="${s.idx}">🗑 削除</button>
           </div>
         </div>`
      : `<div class="thumb-actions" style="margin-top:8px">
           <button class="thumb-btn thumb-btn-add"    data-idx="${s.idx}">📷 追加</button>
           <button class="thumb-btn thumb-btn-paste"  data-idx="${s.idx}">📋 貼り付け</button>
           <button class="thumb-btn thumb-btn-single" data-idx="${s.idx}">📸 1枚撮る</button>
         </div>`;

    const card = document.createElement('div');
    card.className = `step-card${s.enabled ? '' : ' disabled'}`;
    card.dataset.idx = s.idx;
    card.innerHTML = `
      <div class="drag-handle" draggable="true" title="ドラッグして並び替え">⠿</div>
      <div class="step-left">
        <label class="toggle"><input type="checkbox" class="step-chk" data-idx="${s.idx}" ${s.enabled ? 'checked' : ''}><span class="toggle-track"></span></label>
        <div class="step-num">${s.idx}</div>
        <div class="step-order">
          <button class="order-btn" data-idx="${s.idx}" data-dir="up" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button class="order-btn" data-idx="${s.idx}" data-dir="down" ${idx === importedSteps.length - 1 ? 'disabled' : ''}>↓</button>
        </div>
      </div>
      <div class="step-body">
        <div class="step-row1">
          <span class="action-badge" style="background:${s.actionColor}22;color:${s.actionColor};border:1px solid ${s.actionColor}33;cursor:pointer" data-idx="${s.idx}">${esc(t('action.' + s.actionKey))}</span>
          <span class="step-element editable${s.element ? '' : ' empty'}" data-idx="${s.idx}">${s.element ? esc(s.element) : '＋ 要素名を入力...'}</span>
        </div>
        <div class="step-url">${esc(host)}</div>
        <div><span class="memo-text ${s.memo ? '' : 'empty'}" data-idx="${s.idx}">${s.memo ? esc(s.memo) : '＋ メモを追加...'}</span></div>
        ${thumbHtml}
        <input type="file" class="screenshot-input" accept="image/*" data-idx="${s.idx}">
      </div>`;
    stepsList.appendChild(card);
  });

  // ── Drag-and-drop reorder ─────────────────────────────────────────
  stepsList.querySelectorAll('.step-card').forEach((card, arrayIdx) => {
    const handle = card.querySelector('.drag-handle');
    handle.addEventListener('dragstart', e => {
      dragSrcArrayIdx = arrayIdx;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => { card.style.opacity = '0.4'; }, 0);
    });
    handle.addEventListener('dragend', () => { card.style.opacity = ''; });
    card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drag-over'); });
    card.addEventListener('dragleave', e => { if (!card.contains(e.relatedTarget)) card.classList.remove('drag-over'); });
    card.addEventListener('drop', e => {
      e.preventDefault(); card.classList.remove('drag-over');
      if (dragSrcArrayIdx === null || dragSrcArrayIdx === arrayIdx) { dragSrcArrayIdx = null; return; }
      const [moved] = importedSteps.splice(dragSrcArrayIdx, 1);
      importedSteps.splice(arrayIdx, 0, moved);
      dragSrcArrayIdx = null;
      renderSteps();
    });
  });

  stepsList.querySelectorAll('.order-btn').forEach(btn => {
    btn.addEventListener('click', () => moveStep(+btn.dataset.idx, btn.dataset.dir === 'up' ? -1 : 1));
  });
  stepsList.querySelectorAll('.step-chk').forEach(chk => {
    chk.addEventListener('change', () => {
      const s = importedSteps.find(x => x.idx === +chk.dataset.idx);
      if (s) { s.enabled = chk.checked; chk.closest('.step-card').classList.toggle('disabled', !chk.checked); }
      updateCount(); updateChkAll();
    });
  });
  stepsList.querySelectorAll('.action-badge').forEach(badge => badge.addEventListener('click', () => startActionEdit(badge)));
  stepsList.querySelectorAll('.step-element.editable').forEach(el => el.addEventListener('click', () => startElementEdit(el)));
  stepsList.querySelectorAll('.memo-text').forEach(el => el.addEventListener('click', () => startMemoEdit(el)));
  stepsList.querySelectorAll('.thumb-btn-rep, .thumb-btn-add').forEach(btn => {
    btn.addEventListener('click', () => stepsList.querySelector(`.screenshot-input[data-idx="${btn.dataset.idx}"]`).click());
  });
  stepsList.querySelectorAll('.thumb-btn-paste').forEach(btn => {
    btn.addEventListener('click', () => pasteScreenshot(+btn.dataset.idx));
  });
  stepsList.querySelectorAll('.thumb-btn-single').forEach(btn => {
    btn.addEventListener('click', () => startSingleCapture(+btn.dataset.idx));
  });
  stepsList.querySelectorAll('.thumb-btn-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = importedSteps.find(x => x.idx === +btn.dataset.idx);
      if (s) { s.screenshot = null; renderSteps(); showToast(t('toast.screenshot.deleted')); }
    });
  });
  stepsList.querySelectorAll('.screenshot-input').forEach(input => {
    input.addEventListener('change', () => {
      if (!input.files[0]) return;
      readAsDataURL(input.files[0]).then(url => {
        const s = importedSteps.find(x => x.idx === +input.dataset.idx);
        if (s) { s.screenshot = url; renderSteps(); showToast(t('toast.screenshot.replaced')); }
      });
    });
  });
  stepsList.querySelectorAll('.step-img').forEach(img => {
    img.addEventListener('click', () => showLightbox(img.src));
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add-step';
  addBtn.textContent = t('editor.btn.add.step');
  addBtn.addEventListener('click', addNewStep);
  stepsList.appendChild(addBtn);

  updateCount(); updateChkAll();
}

function addNewStep() {
  const newIdx = importedSteps.length > 0 ? Math.max(...importedSteps.map(s => s.idx)) + 1 : 1;
  importedSteps.push({
    idx: newIdx,
    actionKey:   'click',
    actionColor: '#e94560',
    element: '',
    url: '', value: '', memo: '',
    screenshot: null,
    enabled: true,
  });
  renderSteps();
  showToast(t('toast.step.new.added'));
  stepsList.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function moveStep(idx, dir) {
  const pos = importedSteps.findIndex(s => s.idx === idx);
  if (pos < 0) return;
  const swap = pos + dir;
  if (swap < 0 || swap >= importedSteps.length) return;
  [importedSteps[pos], importedSteps[swap]] = [importedSteps[swap], importedSteps[pos]];
  renderSteps();
}

function startActionEdit(badge) {
  const s = importedSteps.find(x => x.idx === +badge.dataset.idx);
  if (!s) return;
  const sel = document.createElement('select');
  sel.className = 'action-select';
  ACTION_OPTS.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.key; opt.textContent = t('action.' + a.key);
    if (a.key === s.actionKey) opt.selected = true;
    sel.appendChild(opt);
  });
  badge.replaceWith(sel); sel.focus();
  const commit = () => {
    const chosen = ACTION_OPTS.find(a => a.key === sel.value) || ACTION_OPTS[0];
    s.actionKey = chosen.key;
    s.actionColor = chosen.color;
    badge.textContent = t('action.' + s.actionKey);
    badge.style.background = `${s.actionColor}22`;
    badge.style.color = s.actionColor;
    badge.style.border = `1px solid ${s.actionColor}33`;
    sel.replaceWith(badge);
  };
  sel.addEventListener('change', commit);
  sel.addEventListener('blur', commit);
  sel.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { sel.value = s.actionKey; commit(); }
  });
}

function startElementEdit(span) {
  const s = importedSteps.find(x => x.idx === +span.dataset.idx);
  if (!s) return;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'element-input'; inp.value = s.element;
  inp.placeholder = '要素名を入力...';
  span.replaceWith(inp); inp.focus(); inp.select();
  const commit = () => {
    s.element = inp.value.trim();
    span.textContent = s.element || '＋ 要素名を入力...';
    span.className = `step-element editable${s.element ? '' : ' empty'}`;
    inp.replaceWith(span);
  };
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { inp.value = s.element; commit(); }
  });
}

function startMemoEdit(span) {
  const s = importedSteps.find(x => x.idx === +span.dataset.idx);
  if (!s) return;
  const ta = document.createElement('textarea');
  ta.className = 'memo-input'; ta.value = s.memo || ''; ta.rows = 2;
  ta.placeholder = 'このステップへのメモ（手順書に反映されます）';
  span.replaceWith(ta); ta.focus(); ta.select();
  const commit = () => {
    s.memo = ta.value.trim();
    const ns = document.createElement('span');
    ns.className = `memo-text${s.memo ? '' : ' empty'}`; ns.dataset.idx = span.dataset.idx;
    ns.textContent = s.memo || '＋ メモを追加...';
    ns.addEventListener('click', () => startMemoEdit(ns));
    ta.replaceWith(ns);
  };
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { ta.value = s.memo || ''; commit(); }
  });
}

function updateCount() {
  const total = importedSteps.length, en = importedSteps.filter(s => s.enabled).length;
  enabledCount.innerHTML = t('popup.enabled.count', { enabled: en, total });
  btnExport.disabled = en === 0;
}

function updateChkAll() {
  const all = importedSteps.every(s => s.enabled), none = importedSteps.every(s => !s.enabled);
  chkAll.checked = all; chkAll.indeterminate = !all && !none;
}

// ── Clipboard paste ────────────────────────────────────────────────────
async function pasteScreenshot(idx) {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find(tp => tp.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        const url = await readAsDataURL(blob);
        const s = importedSteps.find(x => x.idx === idx);
        if (s) { s.screenshot = url; renderSteps(); showToast(t('toast.screenshot.pasted')); }
        return;
      }
    }
    showToast(t('toast.paste.fail'));
  } catch (_) {
    showToast(t('toast.paste.fail'));
  }
}

// ── Single capture ─────────────────────────────────────────────────────
function startSingleCapture(idx) {
  if (!chrome.runtime?.id) { showToast(t('toast.ext.reload')); return; }
  pendingSingleCaptureIdx = idx;
  try {
    chrome.runtime.sendMessage({ type: 'SINGLE_CAPTURE_START' }).catch(() => {});
  } catch (_) {
    pendingSingleCaptureIdx = null;
    showToast(t('toast.conn.error'));
    return;
  }
  showToast(t('toast.capture.shooting'));
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !changes.singleCaptureResult?.newValue) return;
  const { screenshot } = changes.singleCaptureResult.newValue;
  if (pendingSingleCaptureIdx !== null) {
    if (screenshot) {
      const s = importedSteps.find(x => x.idx === pendingSingleCaptureIdx);
      if (s) { s.screenshot = screenshot; renderSteps(); showToast(t('toast.capture.shot')); }
    } else {
      showToast(t('toast.capture.fail'));
    }
  }
  pendingSingleCaptureIdx = null;
  chrome.storage.session.remove('singleCaptureResult').catch(() => {});
});

chkAll.addEventListener('change', () => {
  importedSteps.forEach(s => { s.enabled = chkAll.checked; });
  stepsList.querySelectorAll('.step-chk').forEach(c => { c.checked = chkAll.checked; });
  stepsList.querySelectorAll('.step-card').forEach(c => c.classList.toggle('disabled', !chkAll.checked));
  updateCount();
});

// ── Preview in viewer ─────────────────────────────────────────────────
btnPreviewViewer.addEventListener('click', async () => {
  if (typeof JSZip === 'undefined') { showToast(t('toast.jszip.wait')); return; }

  if (sourceNavZip) {
    // Nav ZIP: open full nav ZIP (with all docs) in viewer
    const choice = await showSaveDialog(t('save.dialog.title.viewer'), t('save.dialog.skip'));
    if (choice === null) return;
    if (choice === 'save') await exportNavZip(importedFilename || `${importedTitle}_${formatDatetime()}`);
    showToast(t('toast.viewer.opening'));
    try {
      const blob = await buildNavZip();
      const blobUrl = URL.createObjectURL(blob);
      const viewerBase = chrome.runtime?.getURL ? chrome.runtime.getURL('viewer.html') : 'viewer.html';
      const viewerUrl = `${viewerBase}?zipUrl=${encodeURIComponent(blobUrl)}&filename=${encodeURIComponent((importedFilename || `${importedTitle}_${formatDatetime()}`) + '.zip')}`;
      window.open(viewerUrl, '_blank');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      showToast(t('toast.viewer.opened'));
    } catch (err) { showToast(t('toast.viewer.fail')); console.error(err); }
    return;
  }

  // Single doc
  const active = importedSteps.filter(s => s.enabled);
  if (!active.length) { showToast(t('toast.no.steps')); return; }
  const choice = await showSaveDialog(t('save.dialog.title.viewer'), t('save.dialog.skip'));
  if (choice === null) return;
  if (choice === 'save') await exportZip(active, importedFilename || `${importedTitle}_${formatDatetime()}`);
  showToast(t('toast.viewer.opening'));
  try {
    const zip = new JSZip();
    const shots = zip.folder('screenshots');
    const now = new Date().toLocaleString('ja-JP');
    const cardsHTML = active.map((s, i) => {
      const num = String(i + 1).padStart(3, '0');
      let screenshotSrc = null;
      if (s.screenshot) {
        if (s.screenshot.startsWith('data:')) {
          const fname = `step_${num}.${mimeToExt(base64MimeType(s.screenshot))}`;
          shots.file(fname, base64ToUint8(s.screenshot));
          screenshotSrc = `screenshots/${fname}`;
        } else {
          screenshotSrc = s.screenshot;
        }
      }
      return buildStepCardHTML(i + 1, t('action.' + s.actionKey), s.actionColor, s.element, s.url, s.value, s.memo, screenshotSrc, showUrl);
    }).join('');
    await appendBundledFonts(zip);
    zip.file('index.html', buildPageHTML(importedTitle, now, active.length, cardsHTML));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const blobUrl = URL.createObjectURL(blob);
    const viewerBase = chrome.runtime?.getURL ? chrome.runtime.getURL('viewer.html') : 'viewer.html';
    const viewerUrl = `${viewerBase}?zipUrl=${encodeURIComponent(blobUrl)}&filename=${encodeURIComponent(importedTitle + '.zip')}`;
    window.open(viewerUrl, '_blank');
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    showToast(t('toast.viewer.opened'));
  } catch (err) {
    showToast(t('toast.viewer.fail'));
    console.error(err);
  }
});

// ── Export ────────────────────────────────────────────────────────────
btnExport.addEventListener('click', async () => {
  const active = importedSteps.filter(s => s.enabled);
  if (!active.length) { showToast(t('toast.no.steps')); return; }
  if (sourceNavZip) {
    await exportNavZip(importedFilename || `${importedTitle}_${formatDatetime()}`);
  } else {
    await exportZip(active, importedFilename || `${importedTitle}_${formatDatetime()}`);
  }
});

async function buildNavZip() {
  // Save current doc state
  if (activeNavDocIdx >= 0) {
    navDocs[activeNavDocIdx].steps = importedSteps.map(s => ({...s}));
    navDocs[activeNavDocIdx].title = importedTitle;
  }

  const newZip = new JSZip();
  const now = new Date().toLocaleString('ja-JP');

  // Pre-fetch font data once for reuse across root + sub-documents
  const fontBuffers = {};
  for (const f of FONT_FILES) {
    const resp = await fetch(chrome.runtime.getURL(`fonts/${f}`));
    fontBuffers[f] = await resp.arrayBuffer();
  }

  // Root index.html: replace old @import with local @font-face if present
  const masterEntry = sourceNavZip.file('index.html');
  if (masterEntry) {
    let masterHtml = await masterEntry.async('string');
    masterHtml = masterHtml.replace(
      /@import\s+url\([^)]*fonts\.googleapis\.com[^)]*\)\s*;?/g,
      "@font-face{font-family:'Noto Sans JP';font-weight:100 900;font-display:swap;src:url('fonts/NotoSansJP-Variable.woff2') format('woff2')}"
    );
    newZip.file('index.html', masterHtml);
  }

  // Root fonts/
  const rootFonts = newZip.folder('fonts');
  for (const [f, buf] of Object.entries(fontBuffers)) {
    rootFonts.file(f, buf);
  }

  for (const doc of navDocs) {
    const prefix = doc.prefix + '/';
    if (doc.steps === null) {
      const tasks = [];
      sourceNavZip.forEach((relPath, entry) => {
        if (!entry.dir && relPath.startsWith(prefix)) {
          if (relPath === doc.prefix + '/index.html') {
            // Replace old @import with local @font-face
            tasks.push(entry.async('string').then(html => {
              newZip.file(relPath, html.replace(
                /@import\s+url\([^)]*fonts\.googleapis\.com[^)]*\)\s*;?/g,
                "@font-face{font-family:'Noto Sans JP';font-weight:100 900;font-display:swap;src:url('fonts/NotoSansJP-Variable.woff2') format('woff2')}"
              ));
            }));
          } else {
            tasks.push(entry.async('uint8array').then(data => { newZip.file(relPath, data); }));
          }
        }
      });
      await Promise.all(tasks);
      // Bundle fonts for this unedited sub-document
      const docFonts = newZip.folder(doc.prefix + '/fonts');
      for (const [f, buf] of Object.entries(fontBuffers)) {
        docFonts.file(f, buf);
      }
    } else {
      const activeSteps = doc.steps.filter(s => s.enabled);
      const cardsHTML = activeSteps.map((s, i) => {
        const num = String(i + 1).padStart(3, '0');
        let screenshotSrc = null;
        if (s.screenshot) {
          if (s.screenshot.startsWith('data:')) {
            const fname = `step_${num}.${mimeToExt(base64MimeType(s.screenshot))}`;
            newZip.file(prefix + 'screenshots/' + fname, base64ToUint8(s.screenshot));
            screenshotSrc = `screenshots/${fname}`;
          } else {
            screenshotSrc = s.screenshot;
          }
        }
        return buildStepCardHTML(i + 1, t('action.' + s.actionKey), s.actionColor, s.element, s.url, s.value, s.memo, screenshotSrc, showUrl);
      }).join('');
      newZip.file(prefix + 'index.html', buildPageHTML(doc.title, now, activeSteps.length, cardsHTML));
      // Bundle fonts for this sub-document
      const docFonts = newZip.folder(doc.prefix + '/fonts');
      for (const [f, buf] of Object.entries(fontBuffers)) {
        docFonts.file(f, buf);
      }
    }
  }

  return newZip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

async function exportNavZip(baseName) {
  if (typeof JSZip === 'undefined') { showToast(t('toast.jszip.wait')); return; }
  const blob = await buildNavZip();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${baseName}.zip`; a.click();
  URL.revokeObjectURL(a.href);
  showToast(t('toast.saved', { name: baseName, n: importedSteps.filter(s => s.enabled).length }));
}

const FONT_FILES = ['NotoSansJP-Variable.woff2'];

async function appendBundledFonts(zip) {
  const folder = zip.folder('fonts');
  for (const f of FONT_FILES) {
    const resp = await fetch(chrome.runtime.getURL(`fonts/${f}`));
    folder.file(f, await resp.arrayBuffer());
  }
}

async function exportZip(activeSteps, baseName) {
  if (typeof JSZip === 'undefined') { showToast(t('toast.jszip.wait')); return; }
  const zip = new JSZip();
  const shots = zip.folder('screenshots');
  const now = new Date().toLocaleString('ja-JP');

  const cardsHTML = activeSteps.map((s, i) => {
    const num = String(i + 1).padStart(3, '0');
    let screenshotSrc = null;
    if (s.screenshot) {
      if (s.screenshot.startsWith('data:')) {
        const fname = `step_${num}.${mimeToExt(base64MimeType(s.screenshot))}`;
        shots.file(fname, base64ToUint8(s.screenshot));
        screenshotSrc = `screenshots/${fname}`;
      } else {
        screenshotSrc = s.screenshot;
      }
    }
    return buildStepCardHTML(i + 1, t('action.' + s.actionKey), s.actionColor, s.element, s.url, s.value, s.memo, screenshotSrc, showUrl);
  }).join('');

  await appendBundledFonts(zip);
  zip.file('index.html', buildPageHTML(importedTitle, now, activeSteps.length, cardsHTML));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${baseName}.zip`; a.click();
  URL.revokeObjectURL(a.href);
  showToast(t('toast.saved', { name: baseName, n: activeSteps.length }));
}

// ── HTML builders ─────────────────────────────────────────────────────
function buildStepCardHTML(num, aLabel, aColor, element, url, value, memo, screenshot, showUrl = true) {
  return `
  <div class="step-card">
    <div class="step-header">
      <div class="step-number">${num}</div>
      <div class="step-meta">
        <div class="step-title">
          <span class="action-badge" style="background:${aColor}22;color:${aColor};border:1px solid ${aColor}44">${esc(aLabel)}</span>
          ${esc(element)}
        </div>
        <div class="step-detail">
          ${showUrl ? `<span>🌐 <a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(tryHostname(url))}</a></span>` : ''}
          ${value ? `<span>⌨ 入力値: <code>${esc(value)}</code></span>` : ''}
          ${memo  ? `<span>💬 ${esc(memo)}</span>` : ''}
        </div>
      </div>
    </div>
    ${screenshot ? `<div class="step-screenshot"><img src="${screenshot}" alt="ステップ ${num}"></div>` : ''}
  </div>`;
}

function buildPageHTML(title, now, count, cardsHTML) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(title)}</title>
<style>
  @font-face{font-family:'Noto Sans JP';font-weight:100 900;font-display:swap;src:url('fonts/NotoSansJP-Variable.woff2') format('woff2')}
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Noto Sans JP',sans-serif;background:#f5f5f8;color:#1a1a2e;line-height:1.6}
  .page{max-width:900px;margin:0 auto;padding:40px 24px}
  h1{font-size:24px;font-weight:700;margin-bottom:6px}
  .meta{color:#666;font-size:13px;margin-bottom:32px;padding-bottom:20px;border-bottom:2px solid #e0e0ea}
  .meta span{margin-right:20px}
  .step-card{background:#fff;border-radius:12px;margin-bottom:20px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);border:1px solid #ebebf0}
  .step-header{display:flex;align-items:flex-start;gap:16px;padding:18px 20px}
  .step-number{min-width:36px;height:36px;background:linear-gradient(135deg,#e94560,#c62a47);color:#fff;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0}
  .step-meta{flex:1;min-width:0}
  .step-title{font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .action-badge{padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700}
  .step-detail{margin-top:6px;display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:#666}
  .step-detail a{color:#4a9eff;text-decoration:none}
  .step-detail code{background:#f0f0f5;padding:1px 5px;border-radius:3px;font-family:monospace}
  .step-screenshot{padding:0 20px 20px}
  .step-screenshot img{width:100%;border-radius:8px;border:1px solid #e0e0ea;box-shadow:0 2px 12px rgba(0,0,0,.08);cursor:zoom-in}
  .lb{display:none;position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:9999;align-items:center;justify-content:center;padding:24px;cursor:zoom-out}
  .lb.open{display:flex}
  .lb img{max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.8)}
  @media print{body{background:#fff}.step-card{box-shadow:none;page-break-inside:avoid}.lb{display:none!important}}
</style>
</head>
<body>
<div class="page">
  <h1>📋 ${esc(title)}</h1>
  <div class="meta"><span>📅 作成日時: ${now}</span><span>📌 総ステップ数: ${count}</span></div>
  ${cardsHTML}
</div>
<div class="lb" id="lb" onclick="this.classList.remove('open')"><img id="lbImg" alt=""></div>
<script>
document.querySelectorAll('.step-screenshot img').forEach(function(img){
  img.addEventListener('click',function(){document.getElementById('lbImg').src=this.src;document.getElementById('lb').classList.add('open');});
});
document.addEventListener('keydown',function(e){if(e.key==='Escape')document.getElementById('lb').classList.remove('open');});
</script>
</body>
</html>`;
}

// ── Helpers ───────────────────────────────────────────────────────────
// ── Lightbox ──────────────────────────────────────────────────────────
let _lightbox = null;
function showLightbox(src) {
  if (!_lightbox) {
    _lightbox = document.createElement('div');
    _lightbox.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out';
    const img = document.createElement('img');
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.7)';
    _lightbox.appendChild(img);
    _lightbox.addEventListener('click', () => { _lightbox.style.display = 'none'; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') _lightbox.style.display = 'none'; });
    document.body.appendChild(_lightbox);
  }
  _lightbox.querySelector('img').src = src;
  _lightbox.style.display = 'flex';
}

// ── Load from recording (opened from popup after stop) ────────────────
async function loadFromRecording() {
  const stored = await chrome.storage.local.get(['steps', 'stepMeta', 'docTitle']);
  const rawSteps = stored.steps || [];
  const rawMeta  = stored.stepMeta || {};
  if (rawSteps.length === 0) return;

  importedTitle    = stored.docTitle || t('popup.title.default');
  importedFilename = '';
  sourceNavZip     = null;
  sourceNavDocPrefix = '';
  navDocs = []; activeNavDocIdx = -1;

  importedSteps = rawSteps.map((s, i) => {
    const meta      = rawMeta[s.step] || {};
    const actionKey = meta.action || s.action || 'click';
    const opt       = ACTION_OPTS.find(a => a.key === actionKey) || ACTION_OPTS[0];
    return {
      idx:         i + 1,
      actionKey:   opt.key,
      actionColor: opt.color,
      element:     meta.element || s.element || '',
      url:         s.url   || '',
      value:       s.value || '',
      memo:        meta.memo || '',
      screenshot:  s.screenshot || null,
      enabled:     meta.enabled !== false,
    };
  });

  showLoadedUI(importedTitle);

  // Clear raw recording data from storage (now held in editor state).
  // docTitle is kept for popup.js to use as the next recording's initial title.
  chrome.storage.local.remove(['steps', 'stepMeta']);
}

// ── Auto-load ZIP from URL param (opened from viewer.html) ────────────
(async () => {
  const p = new URLSearchParams(location.search);
  if (p.get('fromRecording')) { await loadFromRecording(); return; }
  const zipUrl = p.get('zipUrl');
  const filename = p.get('filename');
  if (!zipUrl || !filename) return;
  showToast('⏳ 読み込み中...');
  try {
    const res = await fetch(zipUrl);
    const blob = await res.blob();
    await loadZipFile(new File([blob], decodeURIComponent(filename), { type: 'application/zip' }));
  } catch (_) {
    showToast(t('toast.zip.fail'));
  }
})();

function formatDatetime() { const d = new Date(), p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`; }
function esc(str) { return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function tryHostname(url) { try { const u = new URL(url); return u.hostname + u.pathname; } catch(_) { return url || ''; } }
function safeUrl(url) { return /^https?:\/\//i.test(url) ? url : '#'; }
function base64MimeType(d) { return d.match(/data:([^;]+);/)?.[1] || 'image/png'; }
function mimeToExt(m) { return {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[m] || 'png'; }
function base64ToUint8(d) { const b = atob(d.split(',')[1]), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
function readAsText(file) { return new Promise(r => { const fr = new FileReader(); fr.onload = e => r(e.target.result); fr.readAsText(file, 'UTF-8'); }); }
function readAsDataURL(file) { return new Promise(r => { const fr = new FileReader(); fr.onload = e => r(e.target.result); fr.readAsDataURL(file); }); }
function showToast(msg) { toast.textContent = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2800); }
