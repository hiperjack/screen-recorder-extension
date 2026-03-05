// popup.js — v3: step on/off + memo + imported file step editor with screenshot swap

// ── DOM ───────────────────────────────────────────────────────────
const btnRecord    = document.getElementById('btnRecord');
const btnClear     = document.getElementById('btnClear');
const btnExport    = document.getElementById('btnExport');
const statusDot    = document.getElementById('statusDot');
const statusText   = document.getElementById('statusText');
const stepCount    = document.getElementById('stepCount');
const recordIcon   = document.getElementById('recordIcon');
const recordLabel  = document.getElementById('recordLabel');
const stepsListContainer = document.getElementById('stepsListContainer');
const selectAllBar = document.getElementById('selectAllBar');
const enabledCount = document.getElementById('enabledCount');
const chkAll       = document.getElementById('chkAll');
const formatSelect = document.getElementById('formatSelect');
const toast        = document.getElementById('toast');

const dropZone          = document.getElementById('dropZone');
const fileInput         = document.getElementById('fileInput');
const loadedInfo        = document.getElementById('loadedInfo');
const loadedFileName    = document.getElementById('loadedFileName');
const btnCloseFile      = document.getElementById('btnCloseFile');
const importedStepsWrap = document.getElementById('importedStepsWrap');
const importedStepsList = document.getElementById('importedStepsList');
const chkImportAll      = document.getElementById('chkImportAll');
const importEnabledCount= document.getElementById('importEnabledCount');
const btnSaveImport     = document.getElementById('btnSaveImport');

// ── State ─────────────────────────────────────────────────────────
let steps      = [];   // captured steps
let stepMeta   = {};   // { [stepId]: { enabled, memo } }
let isRecording= false;

// Imported file state
let importedSteps = []; // parsed from HTML: { idx, title, actionLabel, actionColor, element, url, value, memo, screenshot, enabled }
let importedTitle = '操作手順書';

// ── Init ─────────────────────────────────────────────────────────
async function init() {
  const stored = await chrome.storage.local.get(['steps','stepMeta','isRecording']);
  steps       = stored.steps    || [];
  stepMeta    = stored.stepMeta || {};
  isRecording = stored.isRecording || false;
  steps.forEach(s => { if (!stepMeta[s.step]) stepMeta[s.step] = { enabled: true, memo: '' }; });
  renderStatus();
  renderStepsList();
}

// ── Tabs ─────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Status ────────────────────────────────────────────────────────
function renderStatus() {
  if (isRecording) {
    statusDot.classList.add('recording');
    statusText.textContent = '記録中';
    recordIcon.textContent = '⏹';
    recordLabel.textContent = '記録を停止する';
    btnRecord.classList.add('active');
  } else {
    statusDot.classList.remove('recording');
    statusText.textContent = steps.length > 0 ? '記録停止' : '待機中';
    recordIcon.textContent = '⏺';
    recordLabel.textContent = '記録を開始する';
    btnRecord.classList.remove('active');
  }
  const total = steps.length;
  stepCount.innerHTML = total > 0 ? `<span>${total}</span> ステップ記録済` : '';
  btnClear.disabled = total === 0;
  updateExportBtn();
}

function updateExportBtn() {
  btnExport.disabled = steps.filter(s => stepMeta[s.step]?.enabled !== false).length === 0;
}

// ── Manage tab — step list ────────────────────────────────────────
function renderStepsList() {
  if (steps.length === 0) {
    stepsListContainer.innerHTML = `<div class="empty-state"><span class="icon">🎬</span>「記録を開始する」を押してから<br>ページを操作してください</div>`;
    selectAllBar.style.display = 'none';
    return;
  }
  selectAllBar.style.display = 'flex';
  updateEnabledCount();
  updateSelectAllCheckbox();

  const list = document.createElement('div');
  list.className = 'steps-list';
  steps.forEach(s => {
    const meta    = stepMeta[s.step] || { enabled: true, memo: '' };
    const enabled = meta.enabled !== false;
    const aLabel  = { click:'クリック', input:'入力', select:'選択' }[s.action] || s.action;
    const aColor  = { click:'#e94560', input:'#4a9eff', select:'#50c878' }[s.action] || '#888';
    const aIcon   = { click:'👆', input:'⌨', select:'📋' }[s.action] || '•';
    let host = ''; try { host = new URL(s.url).hostname; } catch(_) { host = s.url; }

    const row = document.createElement('div');
    row.className = `step-row${enabled ? '' : ' disabled-row'}`;
    row.dataset.stepId = s.step;
    row.innerHTML = `
      <label class="toggle"><input type="checkbox" class="step-toggle" data-id="${s.step}" ${enabled?'checked':''}><span class="toggle-track"></span></label>
      <div class="step-body">
        <div class="step-action-row">
          <span class="step-num-badge">${s.step}</span>
          <span class="action-badge" style="background:${aColor}22;color:${aColor};border:1px solid ${aColor}33">${aLabel}</span>
        </div>
        <div class="step-label">${aIcon} ${escapeHtml(s.element)}</div>
        <div class="step-url-line">${escapeHtml(host)}</div>
        <div class="step-memo"><span class="memo-text ${meta.memo?'':'empty'}" data-id="${s.step}">${meta.memo ? escapeHtml(meta.memo) : '＋ メモを追加...'}</span></div>
      </div>`;
    list.appendChild(row);
  });

  stepsListContainer.innerHTML = '';
  stepsListContainer.appendChild(list);

  list.querySelectorAll('.step-toggle').forEach(chk => {
    chk.addEventListener('change', () => {
      const id = parseInt(chk.dataset.id);
      stepMeta[id] = stepMeta[id] || { enabled: true, memo: '' };
      stepMeta[id].enabled = chk.checked;
      list.querySelector(`.step-row[data-step-id="${id}"]`)?.classList.toggle('disabled-row', !chk.checked);
      saveMeta();
    });
  });
  list.querySelectorAll('.memo-text').forEach(span => span.addEventListener('click', () => startMemoEdit(span)));
}

function startMemoEdit(span) {
  const id   = parseInt(span.dataset.id);
  const meta = stepMeta[id] || { enabled: true, memo: '' };
  const ta   = document.createElement('textarea');
  ta.className = 'memo-input'; ta.value = meta.memo || ''; ta.rows = 2;
  ta.placeholder = 'このステップへのメモ（手順書に反映されます）';
  span.replaceWith(ta); ta.focus(); ta.select();
  function commit() {
    const val = ta.value.trim();
    stepMeta[id] = stepMeta[id] || { enabled: true, memo: '' };
    stepMeta[id].memo = val;
    const ns = document.createElement('span');
    ns.className = `memo-text${val?'':' empty'}`; ns.dataset.id = id;
    ns.textContent = val || '＋ メモを追加...';
    ns.addEventListener('click', () => startMemoEdit(ns));
    ta.replaceWith(ns);
    saveMeta();
  }
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { ta.value = meta.memo || ''; commit(); }
  });
}

function updateEnabledCount() {
  const total   = steps.length;
  const enabled = steps.filter(s => stepMeta[s.step]?.enabled !== false).length;
  enabledCount.innerHTML = `<span>${enabled}</span> / ${total} 件 出力対象`;
  updateExportBtn();
}
function updateSelectAllCheckbox() {
  const all  = steps.every(s => stepMeta[s.step]?.enabled !== false);
  const none = steps.every(s => stepMeta[s.step]?.enabled === false);
  chkAll.checked = all;
  chkAll.indeterminate = !all && !none;
}
async function saveMeta() {
  await chrome.storage.local.set({ stepMeta });
  updateEnabledCount();
  updateSelectAllCheckbox();
}

chkAll.addEventListener('change', () => {
  steps.forEach(s => { stepMeta[s.step] = stepMeta[s.step] || {}; stepMeta[s.step].enabled = chkAll.checked; });
  document.querySelectorAll('.step-toggle').forEach(c => { c.checked = chkAll.checked; });
  document.querySelectorAll('#stepsListContainer .step-row').forEach(r => r.classList.toggle('disabled-row', !chkAll.checked));
  saveMeta();
});

// ── Record ────────────────────────────────────────────────────────
btnRecord.addEventListener('click', async () => {
  isRecording = !isRecording;
  if (isRecording) { steps = []; stepMeta = {}; }
  await chrome.storage.local.set({ isRecording, steps, stepMeta });
  await chrome.runtime.sendMessage({ type: 'SET_RECORDING_STATE', isRecording });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) { try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch(_){} }
  renderStatus(); renderStepsList();
});

btnClear.addEventListener('click', async () => {
  steps = []; stepMeta = {};
  await chrome.storage.local.set({ steps, stepMeta });
  renderStatus(); renderStepsList();
});

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'ADD_STEP') {
    const s = msg.step;
    steps.push(s);
    if (!stepMeta[s.step]) stepMeta[s.step] = { enabled: true, memo: '' };
    chrome.storage.local.set({ steps, stepMeta });
    renderStatus(); renderStepsList();
  }
});

// ── Export (capture steps) ────────────────────────────────────────
btnExport.addEventListener('click', async () => {
  const active = steps.filter(s => stepMeta[s.step]?.enabled !== false);
  if (!active.length) { showToast('⚠ 出力対象のステップがありません'); return; }
  const fmt = formatSelect.value;
  if (fmt === 'html') {
    await exportZip(active, `手順書_${today()}`);
  } else {
    const content = generateMarkdown(active);
    downloadBlob(content, `手順書_${today()}.md`, 'text/markdown');
    showToast(`✅ 手順書を保存しました（${active.length} ステップ）`);
  }
});

// ── File import ───────────────────────────────────────────────────
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });

function loadFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['html','htm'].includes(ext)) { showToast('⚠ .html ファイルを選択してください'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    parseImportedHTML(e.target.result);
    loadedFileName.textContent = file.name;
    loadedInfo.classList.add('visible');
    importedStepsWrap.classList.add('visible');
    dropZone.style.display = 'none';
    showToast(`📂 ${file.name} を読み込みました（${importedSteps.length} ステップ）`);
    renderImportedSteps();
  };
  reader.readAsText(file, 'UTF-8');
}

// Parse the HTML output from this extension
function parseImportedHTML(html) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(html, 'text/html');

  // Title
  importedTitle = doc.querySelector('h1')?.textContent?.replace(/^📋\s*/, '').trim() || '操作手順書';

  importedSteps = [];
  doc.querySelectorAll('.step-card').forEach((card, i) => {
    const badge     = card.querySelector('.action-badge');
    const titleEl   = card.querySelector('.step-title');
    const detailEl  = card.querySelector('.step-detail');
    const imgEl     = card.querySelector('.step-screenshot img');

    // Extract element name (step-title text minus the badge text)
    let element = titleEl?.textContent?.trim() || '';
    if (badge) element = element.replace(badge.textContent.trim(), '').trim();

    // Extract detail spans
    const spans = detailEl ? [...detailEl.querySelectorAll('span')] : [];
    let url = '', value = '', memo = '';
    spans.forEach(sp => {
      const t = sp.textContent.trim();
      if (t.startsWith('🌐')) { const a = sp.querySelector('a'); url = a?.href || ''; }
      else if (t.startsWith('⌨')) value = t.replace(/^⌨\s*入力値:\s*/, '');
      else if (t.startsWith('💬')) memo = t.replace(/^💬\s*/, '');
    });

    const actionLabel = badge?.textContent?.trim() || '';
    const actionColor = badge ? (badge.style.color || '#888') : '#888';

    importedSteps.push({
      idx: i + 1,
      actionLabel,
      actionColor,
      element,
      url,
      value,
      memo,
      screenshot: imgEl?.src || null,
      enabled: true
    });
  });
}

function renderImportedSteps() {
  importedStepsList.innerHTML = '';
  updateImportEnabledCount();

  importedSteps.forEach(s => {
    const row = document.createElement('div');
    row.className = `step-row${s.enabled ? '' : ' disabled-row'}`;
    row.dataset.importIdx = s.idx;

    let host = '';
    try { host = new URL(s.url).hostname; } catch(_) { host = s.url || ''; }

    const thumbHtml = s.screenshot
      ? `<div class="step-thumb-wrap">
           <img class="step-thumb" src="${s.screenshot}" alt="step ${s.idx}" title="クリックで拡大">
           <div class="thumb-actions">
             <button class="thumb-btn thumb-btn-replace" data-idx="${s.idx}">🔄 差し替え</button>
             <button class="thumb-btn thumb-btn-remove"  data-idx="${s.idx}">🗑 削除</button>
           </div>
         </div>`
      : `<div class="thumb-actions" style="margin-top:4px">
           <button class="thumb-btn thumb-btn-add" data-idx="${s.idx}" style="flex:none;width:auto;padding:4px 8px">📷 スクショを追加</button>
         </div>`;

    row.innerHTML = `
      <label class="toggle"><input type="checkbox" class="import-toggle" data-idx="${s.idx}" ${s.enabled?'checked':''}><span class="toggle-track"></span></label>
      <div class="step-body">
        <div class="step-action-row">
          <span class="step-num-badge">${s.idx}</span>
          <span class="action-badge" style="background:${s.actionColor}22;color:${s.actionColor};border:1px solid ${s.actionColor}33">${escapeHtml(s.actionLabel)}</span>
        </div>
        <div class="step-label">${escapeHtml(s.element)}</div>
        <div class="step-url-line">${escapeHtml(host)}</div>
        <div class="step-memo"><span class="import-memo-text ${s.memo?'':'empty'}" data-idx="${s.idx}">${s.memo ? escapeHtml(s.memo) : '＋ メモを追加...'}</span></div>
        ${thumbHtml}
        <input type="file" class="screenshot-input" accept="image/*" data-idx="${s.idx}">
      </div>`;

    importedStepsList.appendChild(row);
  });

  // Toggle
  importedStepsList.querySelectorAll('.import-toggle').forEach(chk => {
    chk.addEventListener('change', () => {
      const idx = parseInt(chk.dataset.idx);
      const s   = importedSteps.find(x => x.idx === idx);
      if (s) { s.enabled = chk.checked; chk.closest('.step-row').classList.toggle('disabled-row', !chk.checked); }
      updateImportEnabledCount();
    });
  });

  // Memo
  importedStepsList.querySelectorAll('.import-memo-text').forEach(span => {
    span.addEventListener('click', () => startImportMemoEdit(span));
  });

  // Screenshot replace
  importedStepsList.querySelectorAll('.thumb-btn-replace, .thumb-btn-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx   = parseInt(btn.dataset.idx);
      const input = importedStepsList.querySelector(`.screenshot-input[data-idx="${idx}"]`);
      input.click();
    });
  });

  // Screenshot remove
  importedStepsList.querySelectorAll('.thumb-btn-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const s   = importedSteps.find(x => x.idx === idx);
      if (s) {
        s.screenshot = null;
        renderImportedSteps();
        showToast('🗑 スクリーンショットを削除しました');
      }
    });
  });

  // Screenshot file input
  importedStepsList.querySelectorAll('.screenshot-input').forEach(input => {
    input.addEventListener('change', () => {
      const idx  = parseInt(input.dataset.idx);
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        const s = importedSteps.find(x => x.idx === idx);
        if (s) {
          s.screenshot = e.target.result;
          renderImportedSteps();
          showToast('✅ スクリーンショットを差し替えました');
        }
      };
      reader.readAsDataURL(file);
    });
  });

  // Thumbnail zoom
  importedStepsList.querySelectorAll('.step-thumb').forEach(img => {
    img.addEventListener('click', () => {
      const blob = dataURLtoBlob(img.src);
      const url  = URL.createObjectURL(blob);
      chrome.tabs.create({ url });
    });
  });
}

function startImportMemoEdit(span) {
  const idx = parseInt(span.dataset.idx);
  const s   = importedSteps.find(x => x.idx === idx);
  if (!s) return;
  const ta = document.createElement('textarea');
  ta.className = 'memo-input'; ta.value = s.memo || ''; ta.rows = 2;
  ta.placeholder = 'このステップへのメモ（手順書に反映されます）';
  span.replaceWith(ta); ta.focus(); ta.select();
  function commit() {
    s.memo = ta.value.trim();
    const ns = document.createElement('span');
    ns.className = `import-memo-text${s.memo?'':' empty'}`; ns.dataset.idx = idx;
    ns.textContent = s.memo || '＋ メモを追加...';
    ns.addEventListener('click', () => startImportMemoEdit(ns));
    ta.replaceWith(ns);
  }
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { ta.value = s.memo || ''; commit(); }
  });
}

function updateImportEnabledCount() {
  const total   = importedSteps.length;
  const enabled = importedSteps.filter(s => s.enabled).length;
  importEnabledCount.innerHTML = `<span>${enabled}</span> / ${total} 件 出力対象`;
}

chkImportAll.addEventListener('change', () => {
  importedSteps.forEach(s => { s.enabled = chkImportAll.checked; });
  importedStepsList.querySelectorAll('.import-toggle').forEach(c => { c.checked = chkImportAll.checked; });
  importedStepsList.querySelectorAll('.step-row').forEach(r => r.classList.toggle('disabled-row', !chkImportAll.checked));
  updateImportEnabledCount();
});

btnCloseFile.addEventListener('click', () => {
  importedSteps = [];
  loadedInfo.classList.remove('visible');
  importedStepsWrap.classList.remove('visible');
  dropZone.style.display = '';
  fileInput.value = '';
});

// ── Save imported ─────────────────────────────────────────────────
btnSaveImport.addEventListener('click', async () => {
  const active = importedSteps.filter(s => s.enabled);
  if (!active.length) { showToast('⚠ 出力対象のステップがありません'); return; }
  const base = (loadedFileName.textContent || '手順書').replace(/\.[^.]+$/, '');
  await exportImportedZip(active, `${base}_edited`);
});

// ── ZIP exporters ─────────────────────────────────────────────────

// Captured steps → ZIP
async function exportZip(activeSteps, baseName) {
  if (typeof JSZip === 'undefined') { showToast('⚠ JSZipの読み込みを待っています...'); return; }
  const zip = new JSZip();
  const screenshotsFolder = zip.folder('screenshots');

  // Assign filenames and strip base64 from steps before HTML gen
  const stepDefs = activeSteps.map((s, i) => {
    const num = String(i + 1).padStart(3, '0');
    const memo = stepMeta[s.step]?.memo || '';
    let screenshotFile = null;
    if (s.screenshot) {
      const ext = mimeToExt(base64MimeType(s.screenshot));
      screenshotFile = `step_${num}.${ext}`;
      screenshotsFolder.file(screenshotFile, base64ToUint8(s.screenshot));
    }
    return { s, i: i + 1, memo, screenshotFile };
  });

  const html = buildPageHTML(
    activeSteps[0]?.title || '操作手順書',
    new Date().toLocaleString('ja-JP'),
    activeSteps.length,
    stepDefs.map(({ s, i, memo, screenshotFile }) => {
      const aLabel = { click:'クリック', input:'入力', select:'選択' }[s.action] || s.action;
      const aColor = { click:'#e94560', input:'#4a9eff', select:'#50c878' }[s.action] || '#888';
      return buildStepCardHTML(i, aLabel, aColor, s.element, s.url, s.value, memo,
        screenshotFile ? `screenshots/${screenshotFile}` : null);
    }).join('')
  );

  zip.file('index.html', html);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  downloadBlobDirect(blob, `${baseName}.zip`);
  showToast(`✅ ${baseName}.zip を保存しました（${activeSteps.length} ステップ）`);
}

// Imported steps → ZIP
async function exportImportedZip(activeSteps, baseName) {
  if (typeof JSZip === 'undefined') { showToast('⚠ JSZipの読み込みを待っています...'); return; }
  const zip = new JSZip();
  const screenshotsFolder = zip.folder('screenshots');

  const stepDefs = activeSteps.map((s, i) => {
    const num = String(i + 1).padStart(3, '0');
    let screenshotFile = null;
    if (s.screenshot) {
      // Could be base64 (newly added/replaced) or a relative path (from original file)
      if (s.screenshot.startsWith('data:')) {
        const ext = mimeToExt(base64MimeType(s.screenshot));
        screenshotFile = `step_${num}.${ext}`;
        screenshotsFolder.file(screenshotFile, base64ToUint8(s.screenshot));
      } else {
        // Keep original path reference as-is (relative path from loaded file)
        screenshotFile = s.screenshot;
      }
    }
    return { s, i: i + 1, screenshotFile };
  });

  const html = buildPageHTML(
    importedTitle,
    new Date().toLocaleString('ja-JP'),
    activeSteps.length,
    stepDefs.map(({ s, i, screenshotFile }) =>
      buildStepCardHTML(i, s.actionLabel, s.actionColor, s.element, s.url, s.value, s.memo,
        screenshotFile || null)
    ).join('')
  );

  zip.file('index.html', html);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  downloadBlobDirect(blob, `${baseName}.zip`);
  showToast(`💾 ${baseName}.zip を保存しました（${activeSteps.length} ステップ）`);
}

// ── HTML generators ───────────────────────────────────────────────
function generateMarkdown(activeSteps) {
  const now = new Date().toLocaleString('ja-JP');
  const title = activeSteps[0]?.title || '操作手順書';
  let md = `# ${title}\n\n> **作成日時:** ${now}  \n> **総ステップ数:** ${activeSteps.length}\n\n---\n\n`;
  activeSteps.forEach((s, i) => {
    const aLabel = { click:'クリック', input:'入力', select:'選択' }[s.action] || s.action;
    const memo   = stepMeta[s.step]?.memo || '';
    md += `## ステップ ${i+1}：${aLabel} — ${s.element}\n\n`;
    md += `**ページ:** [${tryHostname(s.url)}](${s.url})  \n`;
    md += `**操作:** ${aLabel} → ${s.element}  \n`;
    if (s.value) md += `**入力値:** \`${s.value}\`  \n`;
    if (memo)    md += `**メモ:** ${memo}  \n`;
    md += `**日時:** ${new Date(s.timestamp).toLocaleString('ja-JP')}  \n\n`;
    if (s.screenshot) md += `![ステップ ${i+1}](${s.screenshot})\n\n`;
    md += `---\n\n`;
  });
  return md;
}

function generateHTML(activeSteps) {
  const now = new Date().toLocaleString('ja-JP');
  const title = activeSteps[0]?.title || '操作手順書';
  const cardsHTML = activeSteps.map((s, i) => {
    const aLabel = { click:'クリック', input:'入力', select:'選択' }[s.action] || s.action;
    const aColor = { click:'#e94560', input:'#4a9eff', select:'#50c878' }[s.action] || '#888';
    const memo   = stepMeta[s.step]?.memo || '';
    return buildStepCardHTML(i+1, aLabel, aColor, s.element, s.url, s.value, memo, s.screenshot);
  }).join('');
  return buildPageHTML(title, now, activeSteps.length, cardsHTML);
}

function generateImportedHTML(activeSteps) {
  const now = new Date().toLocaleString('ja-JP');
  const cardsHTML = activeSteps.map((s, i) =>
    buildStepCardHTML(i+1, s.actionLabel, s.actionColor, s.element, s.url, s.value, s.memo, s.screenshot)
  ).join('');
  return buildPageHTML(importedTitle, now, activeSteps.length, cardsHTML);
}

function buildStepCardHTML(num, aLabel, aColor, element, url, value, memo, screenshot) {
  return `
  <div class="step-card">
    <div class="step-header">
      <div class="step-number">${num}</div>
      <div class="step-meta">
        <div class="step-title">
          <span class="action-badge" style="background:${aColor}22;color:${aColor};border:1px solid ${aColor}44">${escapeHtml(aLabel)}</span>
          ${escapeHtml(element)}
        </div>
        <div class="step-detail">
          <span>🌐 <a href="${escapeHtml(url)}" target="_blank">${escapeHtml(tryHostname(url))}</a></span>
          ${value ? `<span>⌨ 入力値: <code>${escapeHtml(value)}</code></span>` : ''}
          ${memo  ? `<span>💬 ${escapeHtml(memo)}</span>` : ''}
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
<title>${escapeHtml(title)}</title>
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
  .footer{text-align:center;color:#aaa;font-size:12px;margin-top:40px;padding-top:20px;border-top:1px solid #e0e0ea}
  @media print{body{background:#fff}.step-card{box-shadow:none;page-break-inside:avoid}}
</style>
</head>
<body>
<div class="page">
  <h1>📋 ${escapeHtml(title)}</h1>
  <div class="meta"><span>📅 作成日時: ${now}</span><span>📌 総ステップ数: ${count}</span></div>
  ${cardsHTML}
  <div class="footer">このドキュメントは「操作手順書ジェネレーター」Chrome拡張機能で自動生成されました</div>
</div>
</body>
</html>`;
}

// ── ZIP / image helpers ───────────────────────────────────────────
function base64MimeType(dataURL) {
  return dataURL.match(/data:([^;]+);/)?.[1] || 'image/png';
}
function mimeToExt(mime) {
  return { 'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp', 'image/gif':'gif' }[mime] || 'png';
}
function base64ToUint8(dataURL) {
  const base64 = dataURL.split(',')[1];
  const bin    = atob(base64);
  const arr    = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function dataURLtoBlob(dataURL) {
  const mime = base64MimeType(dataURL);
  return new Blob([base64ToUint8(dataURL)], { type: mime });
}

// ── Helpers ───────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function tryHostname(url) {
  try { const u = new URL(url); return u.hostname + u.pathname; } catch(_) { return url||''; }
}
function today() { return new Date().toISOString().slice(0,10); }
function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  downloadBlobDirect(blob, filename);
}
function downloadBlobDirect(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function showToast(msg) {
  toast.textContent = msg; toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

init();
