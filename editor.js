// editor.js — full-page step editor

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
const btnExport       = document.getElementById('btnExport');
const toast           = document.getElementById('toast');

// ── Action options ────────────────────────────────────────────────────
const ACTION_OPTS = [
  { label: 'クリック', color: '#e94560' },
  { label: '入力',     color: '#4a9eff' },
  { label: '選択',     color: '#50c878' },
];

// ── State ─────────────────────────────────────────────────────────────
let importedSteps = [];
let importedTitle = '操作手順書';
let showUrl = localStorage.getItem('showUrl') !== 'false';
let pendingSingleCaptureIdx = null;

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
  else showToast('⚠ .zip ファイルを選択してください');
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
  if (!htmlFile) { showToast('⚠ フォルダ内に index.html が見つかりません'); return; }

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
  if (typeof JSZip === 'undefined') { showToast('⚠ JSZip の読み込みを待っています...'); return; }
  try {
    const zip = await JSZip.loadAsync(file);

    // Detect nav ZIP (multiple docs)
    const subDocPaths = [];
    zip.forEach((relPath, entry) => {
      if (!entry.dir && /^doc_\d+\/index\.html$/.test(relPath)) subDocPaths.push(relPath);
    });
    if (subDocPaths.length > 0) {
      await showNavZipPicker(zip, subDocPaths.sort(), file.name);
      return;
    }

    const htmlEntry = zip.file('index.html');
    if (!htmlEntry) { showToast('⚠ ZIP 内に index.html が見つかりません'); return; }
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
  } catch (err) { showToast('⚠ ZIP の読み込みに失敗しました'); console.error(err); }
}

async function showNavZipPicker(zip, subDocPaths, zipName) {
  const docs = await Promise.all(subDocPaths.map(async path => {
    const html = await zip.file(path).async('string');
    const title = new DOMParser().parseFromString(html, 'text/html').querySelector('h1')?.textContent?.replace(/^📋\s*/, '').trim() || path;
    return { path, title };
  }));

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box" style="max-width:480px;width:90%">
        <div class="confirm-msg" style="text-align:left">
          <div style="font-size:14px;font-weight:700;margin-bottom:6px">📚 手順書を選択</div>
          <div style="font-size:12px;color:#7070a0;margin-bottom:14px">複数の手順書が含まれたZIPです。編集する手順書を選んでください。</div>
          <div id="navPickerList" style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto">
            ${docs.map((d, i) => `<button class="nav-pick-btn" data-i="${i}" style="text-align:left;padding:10px 14px;background:#13132a;border:1px solid #2a2a4a;border-radius:8px;color:#c0c0e0;font-family:inherit;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:10px"><span style="color:#e94560;font-weight:700;font-size:11px">${String(i+1).padStart(2,'0')}</span><span>${esc(d.title)}</span></button>`).join('')}
          </div>
        </div>
        <div class="confirm-actions" style="margin-top:16px">
          <button class="confirm-btn confirm-btn-cancel" id="navPickerCancel">キャンセル</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('.nav-pick-btn').forEach(btn => {
      btn.addEventListener('mouseenter', () => { btn.style.background = '#1a1a38'; btn.style.borderColor = '#4a4a8a'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = '#13132a'; btn.style.borderColor = '#2a2a4a'; });
      btn.addEventListener('click', async () => {
        overlay.remove();
        const d = docs[+btn.dataset.i];
        const prefix = d.path.replace('/index.html', '');
        parseImportedHTML(await zip.file(d.path).async('string'));
        const MIME = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif' };
        const dataUrls = {};
        const tasks = [];
        zip.forEach((rel, entry) => {
          if (!entry.dir && rel.startsWith(prefix + '/screenshots/')) {
            const fname = rel.slice(prefix.length + 1); // "screenshots/step_001.png"
            const mime = MIME[rel.split('.').pop().toLowerCase()] || 'image/png';
            tasks.push(entry.async('base64').then(b64 => { dataUrls[fname] = `data:${mime};base64,${b64}`; }));
          }
        });
        await Promise.all(tasks);
        importedSteps.forEach(s => {
          if (s.screenshot && !s.screenshot.startsWith('data:')) s.screenshot = dataUrls[s.screenshot] || null;
        });
        showLoadedUI(zipName);
        resolve();
      });
    });

    overlay.querySelector('#navPickerCancel').addEventListener('click', () => { overlay.remove(); resolve(); });
  });
}

function showLoadedUI(name) {
  toolbarFilename.textContent = name; toolbarFilename.style.display = '';
  btnCloseFile.style.display = ''; enabledCount.style.display = '';
  chkAllLabel.style.display = ''; chkUrlLabel.style.display = '';
  btnExport.style.display = '';
  loadArea.style.display = 'none'; stepsArea.style.display = '';
  docTitleText.textContent = importedTitle;
  showToast(`📂 ${name} を読み込みました（${importedSteps.length} ステップ）`);
  renderSteps();
}

docTitleText.addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'doc-title-input'; inp.value = importedTitle;
  docTitleText.replaceWith(inp); inp.focus(); inp.select();
  function commit() {
    importedTitle = inp.value.trim() || importedTitle;
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

btnCloseFile.addEventListener('click', async () => {
  const ok = await showConfirm('手順書を閉じますか？', '未保存の編集内容は失われます');
  if (!ok) return;
  importedSteps = [];
  toolbarFilename.style.display = 'none'; btnCloseFile.style.display = 'none';
  enabledCount.style.display = 'none'; chkAllLabel.style.display = 'none';
  chkUrlLabel.style.display = 'none'; btnExport.style.display = 'none';
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
      actionLabel: badge?.textContent?.trim() || '',
      actionColor: badge?.style.color || '#888',
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
          <span class="action-badge" style="background:${s.actionColor}22;color:${s.actionColor};border:1px solid ${s.actionColor}33;cursor:pointer" data-idx="${s.idx}">${esc(s.actionLabel)}</span>
          <span class="step-element editable${s.element ? '' : ' empty'}" data-idx="${s.idx}">${s.element ? esc(s.element) : '＋ 要素名を入力...'}</span>
        </div>
        <div class="step-url">${esc(host)}</div>
        <div><span class="memo-text ${s.memo ? '' : 'empty'}" data-idx="${s.idx}">${s.memo ? esc(s.memo) : '＋ メモを追加...'}</span></div>
        ${thumbHtml}
        <input type="file" class="screenshot-input" accept="image/*" data-idx="${s.idx}">
      </div>`;
    stepsList.appendChild(card);
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
      if (s) { s.screenshot = null; renderSteps(); showToast('🗑 削除しました'); }
    });
  });
  stepsList.querySelectorAll('.screenshot-input').forEach(input => {
    input.addEventListener('change', () => {
      if (!input.files[0]) return;
      readAsDataURL(input.files[0]).then(url => {
        const s = importedSteps.find(x => x.idx === +input.dataset.idx);
        if (s) { s.screenshot = url; renderSteps(); showToast('✅ 差し替えました'); }
      });
    });
  });
  stepsList.querySelectorAll('.step-img').forEach(img => {
    img.addEventListener('click', () => showLightbox(img.src));
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add-step';
  addBtn.textContent = '＋ 新規ステップを追加';
  addBtn.addEventListener('click', addNewStep);
  stepsList.appendChild(addBtn);

  updateCount(); updateChkAll();
}

function addNewStep() {
  const newIdx = importedSteps.length > 0 ? Math.max(...importedSteps.map(s => s.idx)) + 1 : 1;
  importedSteps.push({
    idx: newIdx,
    actionLabel: 'クリック',
    actionColor: '#e94560',
    element: '',
    url: '', value: '', memo: '',
    screenshot: null,
    enabled: true,
  });
  renderSteps();
  showToast('✅ 新規ステップを追加しました');
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
    opt.value = a.label; opt.textContent = a.label;
    if (a.label === s.actionLabel) opt.selected = true;
    sel.appendChild(opt);
  });
  badge.replaceWith(sel); sel.focus();
  const commit = () => {
    const chosen = ACTION_OPTS.find(a => a.label === sel.value) || ACTION_OPTS[0];
    s.actionLabel = chosen.label;
    s.actionColor = chosen.color;
    badge.textContent = s.actionLabel;
    badge.style.background = `${s.actionColor}22`;
    badge.style.color = s.actionColor;
    badge.style.border = `1px solid ${s.actionColor}33`;
    sel.replaceWith(badge);
  };
  sel.addEventListener('change', commit);
  sel.addEventListener('blur', commit);
  sel.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { sel.value = s.actionLabel; commit(); }
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
  enabledCount.innerHTML = `<span>${en}</span> / ${total} 件 出力対象`;
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
      const imageType = item.types.find(t => t.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        const url = await readAsDataURL(blob);
        const s = importedSteps.find(x => x.idx === idx);
        if (s) { s.screenshot = url; renderSteps(); showToast('📋 貼り付けました'); }
        return;
      }
    }
    showToast('⚠ クリップボードに画像がありません');
  } catch (_) {
    showToast('⚠ クリップボードへのアクセスに失敗しました');
  }
}

// ── Single capture ─────────────────────────────────────────────────────
function startSingleCapture(idx) {
  if (!chrome.runtime?.id) { showToast('⚠ 拡張機能を再読み込みしてください'); return; }
  pendingSingleCaptureIdx = idx;
  try {
    chrome.runtime.sendMessage({ type: 'SINGLE_CAPTURE_START' }).catch(() => {});
  } catch (_) {
    pendingSingleCaptureIdx = null;
    showToast('⚠ 接続エラー。ページを再読み込みしてください');
    return;
  }
  showToast('📸 撮影したいページに切り替えてクリックしてください');
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !changes.singleCaptureResult?.newValue) return;
  const { screenshot } = changes.singleCaptureResult.newValue;
  if (pendingSingleCaptureIdx !== null) {
    if (screenshot) {
      const s = importedSteps.find(x => x.idx === pendingSingleCaptureIdx);
      if (s) { s.screenshot = screenshot; renderSteps(); showToast('📸 撮影しました'); }
    } else {
      showToast('⚠ スクリーンショットの取得に失敗しました');
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

// ── Export ────────────────────────────────────────────────────────────
btnExport.addEventListener('click', async () => {
  const active = importedSteps.filter(s => s.enabled);
  if (!active.length) { showToast('⚠ 出力対象のステップがありません'); return; }
  await exportZip(active, `${importedTitle}_edited`);
});

async function exportZip(activeSteps, baseName) {
  if (typeof JSZip === 'undefined') { showToast('⚠ JSZip の読み込みを待っています...'); return; }
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
    return buildStepCardHTML(i + 1, s.actionLabel, s.actionColor, s.element, s.url, s.value, s.memo, screenshotSrc, showUrl);
  }).join('');

  zip.file('index.html', buildPageHTML(importedTitle, now, activeSteps.length, cardsHTML));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${baseName}.zip`; a.click();
  URL.revokeObjectURL(a.href);
  showToast(`💾 ${baseName}.zip を保存しました（${activeSteps.length} ステップ）`);
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
          ${showUrl ? `<span>🌐 <a href="${esc(url)}" target="_blank">${esc(tryHostname(url))}</a></span>` : ''}
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
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
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
  .step-screenshot img{width:100%;border-radius:8px;border:1px solid #e0e0ea;box-shadow:0 2px 12px rgba(0,0,0,.08)}
  @media print{body{background:#fff}.step-card{box-shadow:none;page-break-inside:avoid}}
</style>
</head>
<body>
<div class="page">
  <h1>📋 ${esc(title)}</h1>
  <div class="meta"><span>📅 作成日時: ${now}</span><span>📌 総ステップ数: ${count}</span></div>
  ${cardsHTML}
</div>
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

// ── Auto-load ZIP from URL param (opened from viewer.html) ────────────
(async () => {
  const p = new URLSearchParams(location.search);
  const zipUrl = p.get('zipUrl');
  const filename = p.get('filename');
  if (!zipUrl || !filename) return;
  showToast('⏳ 読み込み中...');
  try {
    const res = await fetch(zipUrl);
    const blob = await res.blob();
    await loadZipFile(new File([blob], decodeURIComponent(filename), { type: 'application/zip' }));
  } catch (_) {
    showToast('⚠ ZIPの読み込みに失敗しました');
  }
})();

function esc(str) { return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function tryHostname(url) { try { const u = new URL(url); return u.hostname + u.pathname; } catch(_) { return url || ''; } }
function base64MimeType(d) { return d.match(/data:([^;]+);/)?.[1] || 'image/png'; }
function mimeToExt(m) { return {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[m] || 'png'; }
function base64ToUint8(d) { const b = atob(d.split(',')[1]), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
function readAsText(file) { return new Promise(r => { const fr = new FileReader(); fr.onload = e => r(e.target.result); fr.readAsText(file, 'UTF-8'); }); }
function readAsDataURL(file) { return new Promise(r => { const fr = new FileReader(); fr.onload = e => r(e.target.result); fr.readAsDataURL(file); }); }
function showToast(msg) { toast.textContent = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2800); }
