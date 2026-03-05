// popup.js

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
const docTitleInput  = document.getElementById('docTitleInput');
const chkShowUrl     = document.getElementById('chkShowUrl');
const toast          = document.getElementById('toast');

// ── State ─────────────────────────────────────────────────────────
let steps      = [];
let stepMeta   = {};
let isRecording= false;
let docTitle   = '操作手順書';
let showUrl    = true;

// ── Init ─────────────────────────────────────────────────────────
async function init() {
  const stored = await chrome.storage.local.get(['steps','stepMeta','isRecording','docTitle','showUrl']);
  steps       = stored.steps    || [];
  stepMeta    = stored.stepMeta || {};
  isRecording = stored.isRecording || false;
  docTitle    = stored.docTitle || '操作手順書';
  showUrl     = stored.showUrl !== false;
  docTitleInput.value = docTitle;
  chkShowUrl.checked  = showUrl;
  steps.forEach(s => { if (!stepMeta[s.step]) stepMeta[s.step] = { enabled: true, memo: '' }; });
  renderStatus();
  renderStepsList();
}

docTitleInput.addEventListener('input', async () => {
  docTitle = docTitleInput.value || '操作手順書';
  await chrome.storage.local.set({ docTitle });
});

chkShowUrl.addEventListener('change', async () => {
  showUrl = chkShowUrl.checked;
  await chrome.storage.local.set({ showUrl });
});

// ── Tabs ─────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

document.getElementById('btnOpenEditor').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
});

document.getElementById('btnOpenFinalizer').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('finalizer.html') });
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

// ── Action options ────────────────────────────────────────────────
const ACTION_OPTS = [
  { raw: 'click',  label: 'クリック', color: '#e94560' },
  { raw: 'input',  label: '入力',     color: '#4a9eff' },
  { raw: 'select', label: '選択',     color: '#50c878' },
];

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
  steps.forEach((s, idx) => {
    const meta    = stepMeta[s.step] || { enabled: true, memo: '' };
    const enabled = meta.enabled !== false;
    const actionRaw = stepMeta[s.step]?.action || s.action;
    const aLabel  = { click:'クリック', input:'入力', select:'選択' }[actionRaw] || actionRaw;
    const aColor  = { click:'#e94560', input:'#4a9eff', select:'#50c878' }[actionRaw] || '#888';
    const aIcon   = { click:'👆', input:'⌨', select:'📋' }[actionRaw] || '•';
    let host = ''; try { host = new URL(s.url).hostname; } catch(_) { host = s.url; }

    const row = document.createElement('div');
    row.className = `step-row${enabled ? '' : ' disabled-row'}`;
    row.dataset.stepId = s.step;
    row.innerHTML = `
      <div class="step-order">
        <button class="order-btn" data-id="${s.step}" data-dir="up" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button class="order-btn" data-id="${s.step}" data-dir="down" ${idx === steps.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
      <label class="toggle"><input type="checkbox" class="step-toggle" data-id="${s.step}" ${enabled?'checked':''}><span class="toggle-track"></span></label>
      <div class="step-body">
        <div class="step-action-row">
          <span class="step-num-badge">${s.step}</span>
          <span class="action-badge" style="background:${aColor}22;color:${aColor};border:1px solid ${aColor}33;cursor:pointer" data-id="${s.step}">${aLabel}</span>
        </div>
        <div class="step-label">${aIcon} <span class="element-text" data-id="${s.step}">${escapeHtml(meta.element || s.element)}</span></div>
        <div class="step-url-line">${escapeHtml(host)}</div>
        ${s.value ? `<div class="step-value-line">⌨ ${escapeHtml(s.value)}</div>` : ''}
        <div class="step-memo"><span class="memo-text ${meta.memo?'':'empty'}" data-id="${s.step}">${meta.memo ? escapeHtml(meta.memo) : '＋ メモを追加...'}</span></div>
      </div>`;
    list.appendChild(row);
  });

  stepsListContainer.innerHTML = '';
  stepsListContainer.appendChild(list);

  list.querySelectorAll('.action-badge').forEach(badge => badge.addEventListener('click', () => startActionEdit(badge)));
  list.querySelectorAll('.order-btn').forEach(btn => {
    btn.addEventListener('click', () => moveStep(parseInt(btn.dataset.id), btn.dataset.dir === 'up' ? -1 : 1));
  });
  list.querySelectorAll('.element-text').forEach(span => span.addEventListener('click', () => startElementEdit(span)));
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

function moveStep(id, dir) {
  const idx = steps.findIndex(s => s.step === id);
  if (idx < 0) return;
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= steps.length) return;
  [steps[idx], steps[swapIdx]] = [steps[swapIdx], steps[idx]];
  chrome.storage.local.set({ steps });
  renderStepsList();
}

function startActionEdit(badge) {
  const id = parseInt(badge.dataset.id);
  const curRaw = stepMeta[id]?.action || steps.find(s => s.step === id)?.action || 'click';
  const sel = document.createElement('select');
  sel.className = 'action-select';
  ACTION_OPTS.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.raw; opt.textContent = a.label;
    if (a.raw === curRaw) opt.selected = true;
    sel.appendChild(opt);
  });
  badge.replaceWith(sel); sel.focus();
  const commit = () => {
    const chosen = ACTION_OPTS.find(a => a.raw === sel.value) || ACTION_OPTS[0];
    stepMeta[id] = stepMeta[id] || { enabled: true, memo: '' };
    stepMeta[id].action = chosen.raw;
    badge.textContent = chosen.label;
    badge.style.background = `${chosen.color}22`;
    badge.style.color = chosen.color;
    badge.style.border = `1px solid ${chosen.color}33`;
    sel.replaceWith(badge);
    saveMeta();
  };
  sel.addEventListener('change', commit);
  sel.addEventListener('blur', commit);
  sel.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { sel.value = curRaw; commit(); }
  });
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

function startElementEdit(span) {
  const id  = parseInt(span.dataset.id);
  const cur = stepMeta[id]?.element || steps.find(s => s.step === id)?.element || '';
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'element-input'; inp.value = cur;
  span.replaceWith(inp); inp.focus(); inp.select();
  function commit() {
    const val = inp.value.trim();
    stepMeta[id] = stepMeta[id] || { enabled: true, memo: '' };
    stepMeta[id].element = val || undefined;
    const ns = document.createElement('span');
    ns.className = 'element-text'; ns.dataset.id = id;
    ns.textContent = val || cur;
    ns.addEventListener('click', () => startElementEdit(ns));
    inp.replaceWith(ns);
    saveMeta();
  }
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { inp.value = cur; commit(); }
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

// ── Export (captured steps) ───────────────────────────────────────
btnExport.addEventListener('click', async () => {
  const active = steps.filter(s => stepMeta[s.step]?.enabled !== false);
  if (!active.length) { showToast('⚠ 出力対象のステップがありません'); return; }
  await exportZip(active, `手順書_${today()}`);
});

async function exportZip(activeSteps, baseName) {
  if (typeof JSZip === 'undefined') { showToast('⚠ JSZipの読み込みを待っています...'); return; }
  const zip = new JSZip();
  const screenshotsFolder = zip.folder('screenshots');

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
    docTitle,
    new Date().toLocaleString('ja-JP'),
    activeSteps.length,
    stepDefs.map(({ s, i, memo, screenshotFile }) => {
      const actionRaw = stepMeta[s.step]?.action || s.action;
      const aLabel   = { click:'クリック', input:'入力', select:'選択' }[actionRaw] || actionRaw;
      const aColor   = { click:'#e94560', input:'#4a9eff', select:'#50c878' }[actionRaw] || '#888';
      const element  = stepMeta[s.step]?.element || s.element;
      return buildStepCardHTML(i, aLabel, aColor, element, s.url, s.value, memo,
        screenshotFile ? `screenshots/${screenshotFile}` : null, showUrl);
    }).join('')
  );

  zip.file('index.html', html);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  downloadBlobDirect(blob, `${baseName}.zip`);
  showToast(`✅ ${baseName}.zip を保存しました（${activeSteps.length} ステップ）`);
}

// ── HTML generators ───────────────────────────────────────────────
function generateMarkdown(activeSteps) {
  const now = new Date().toLocaleString('ja-JP');
  let md = `# ${docTitle}\n\n> **作成日時:** ${now}  \n> **総ステップ数:** ${activeSteps.length}\n\n---\n\n`;
  activeSteps.forEach((s, i) => {
    const aLabel   = { click:'クリック', input:'入力', select:'選択' }[s.action] || s.action;
    const memo     = stepMeta[s.step]?.memo || '';
    const element  = stepMeta[s.step]?.element || s.element;
    md += `## ステップ ${i+1}：${aLabel} — ${element}\n\n`;
    if (showUrl) md += `**ページ:** [${tryHostname(s.url)}](${s.url})  \n`;
    md += `**操作:** ${aLabel} → ${s.element}  \n`;
    if (s.value) md += `**入力値:** \`${s.value}\`  \n`;
    if (memo)    md += `**メモ:** ${memo}  \n`;
    md += `**日時:** ${new Date(s.timestamp).toLocaleString('ja-JP')}  \n\n`;
    if (s.screenshot) md += `![ステップ ${i+1}](${s.screenshot})\n\n`;
    md += `---\n\n`;
  });
  return md;
}

function buildStepCardHTML(num, aLabel, aColor, element, url, value, memo, screenshot, showUrl = true) {
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
          ${showUrl ? `<span>🌐 <a href="${escapeHtml(url)}" target="_blank">${escapeHtml(tryHostname(url))}</a></span>` : ''}
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
  @media print{body{background:#fff}.step-card{box-shadow:none;page-break-inside:avoid}}
</style>
</head>
<body>
<div class="page">
  <h1>📋 ${escapeHtml(title)}</h1>
  <div class="meta"><span>📅 作成日時: ${now}</span><span>📌 総ステップ数: ${count}</span></div>
  ${cardsHTML}
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
