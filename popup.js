// popup.js — v2 with step on/off, memo editing, and file import

// ── DOM refs ──────────────────────────────────────────────────────
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

// Edit tab
const dropZone      = document.getElementById('dropZone');
const fileInput     = document.getElementById('fileInput');
const loadedInfo    = document.getElementById('loadedInfo');
const loadedFileName= document.getElementById('loadedFileName');
const btnCloseFile  = document.getElementById('btnCloseFile');
const editorWrap    = document.getElementById('editorWrap');
const htmlEditor    = document.getElementById('htmlEditor');
const btnPreview    = document.getElementById('btnPreview');
const btnSaveEdit   = document.getElementById('btnSaveEdit');

// ── State ─────────────────────────────────────────────────────────
let steps = [];        // raw captured steps
let stepMeta = {};     // { [step_id]: { enabled: bool, memo: string } }
let isRecording = false;
let loadedFile = null; // { name, content, ext }

// ── Init ─────────────────────────────────────────────────────────
async function init() {
  const stored = await chrome.storage.local.get(['steps', 'stepMeta', 'isRecording']);
  steps      = stored.steps    || [];
  stepMeta   = stored.stepMeta || {};
  isRecording= stored.isRecording || false;

  // Ensure all steps have meta entries
  steps.forEach(s => {
    if (!stepMeta[s.step]) stepMeta[s.step] = { enabled: true, memo: '' };
  });

  renderStatus();
  renderStepsList();
  updateExportBtn();
}

// ── Tab switching ─────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Status render ─────────────────────────────────────────────────
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
  const enabledSteps = steps.filter(s => stepMeta[s.step]?.enabled !== false);
  btnExport.disabled = enabledSteps.length === 0;
}

// ── Steps list render ─────────────────────────────────────────────
function renderStepsList() {
  if (steps.length === 0) {
    stepsListContainer.innerHTML = `
      <div class="empty-state">
        <span class="icon">🎬</span>
        「記録を開始する」を押してから<br>ページを操作してください
      </div>`;
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

    const actionLabel = { click: 'クリック', input: '入力', select: '選択' }[s.action] || s.action;
    const actionColor = { click: '#e94560', input: '#4a9eff', select: '#50c878' }[s.action] || '#888';
    const actionIcon  = { click: '👆', input: '⌨', select: '📋' }[s.action] || '•';

    let hostname = '';
    try { hostname = new URL(s.url).hostname; } catch (_) { hostname = s.url; }

    const row = document.createElement('div');
    row.className = `step-row${enabled ? '' : ' disabled-row'}`;
    row.dataset.stepId = s.step;

    row.innerHTML = `
      <label class="toggle" title="${enabled ? '有効（クリックで無効化）' : '無効（クリックで有効化）'}">
        <input type="checkbox" class="step-toggle" data-id="${s.step}" ${enabled ? 'checked' : ''}>
        <span class="toggle-track"></span>
      </label>
      <div class="step-body">
        <div class="step-action-row">
          <span class="step-num-badge">${s.step}</span>
          <span class="action-badge" style="background:${actionColor}22;color:${actionColor};border:1px solid ${actionColor}33">${actionLabel}</span>
        </div>
        <div class="step-label">${actionIcon} ${escapeHtml(s.element)}</div>
        <div class="step-url-line">${escapeHtml(hostname)}</div>
        <div class="step-memo">
          <span class="memo-text ${meta.memo ? '' : 'empty'}" data-id="${s.step}">${
            meta.memo ? escapeHtml(meta.memo) : '＋ メモを追加...'
          }</span>
        </div>
      </div>`;

    list.appendChild(row);
  });

  stepsListContainer.innerHTML = '';
  stepsListContainer.appendChild(list);

  // Toggle handlers
  list.querySelectorAll('.step-toggle').forEach(chk => {
    chk.addEventListener('change', () => {
      const id = parseInt(chk.dataset.id);
      if (!stepMeta[id]) stepMeta[id] = { enabled: true, memo: '' };
      stepMeta[id].enabled = chk.checked;
      const row = list.querySelector(`.step-row[data-step-id="${id}"]`);
      if (row) row.classList.toggle('disabled-row', !chk.checked);
      saveMetaAndUpdate();
    });
  });

  // Memo click → inline edit
  list.querySelectorAll('.memo-text').forEach(span => {
    span.addEventListener('click', () => startMemoEdit(span, list));
  });
}

function startMemoEdit(span, list) {
  const id   = parseInt(span.dataset.id);
  const meta = stepMeta[id] || { enabled: true, memo: '' };

  const textarea = document.createElement('textarea');
  textarea.className = 'memo-input';
  textarea.value     = meta.memo || '';
  textarea.rows      = 2;
  textarea.placeholder = 'このステップへのメモ（手順書に反映されます）';

  span.replaceWith(textarea);
  textarea.focus();
  textarea.select();

  function commit() {
    const val = textarea.value.trim();
    if (!stepMeta[id]) stepMeta[id] = { enabled: true, memo: '' };
    stepMeta[id].memo = val;

    const newSpan = document.createElement('span');
    newSpan.className  = `memo-text${val ? '' : ' empty'}`;
    newSpan.dataset.id = id;
    newSpan.textContent= val || '＋ メモを追加...';
    newSpan.addEventListener('click', () => startMemoEdit(newSpan, list));
    textarea.replaceWith(newSpan);
    saveMetaAndUpdate();
  }

  textarea.addEventListener('blur', commit);
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { textarea.value = meta.memo || ''; commit(); }
  });
}

function updateEnabledCount() {
  const total   = steps.length;
  const enabled = steps.filter(s => stepMeta[s.step]?.enabled !== false).length;
  enabledCount.innerHTML = `<span>${enabled}</span> / ${total} 件 出力対象`;
  updateExportBtn();
}

function updateSelectAllCheckbox() {
  const allEnabled = steps.every(s => stepMeta[s.step]?.enabled !== false);
  const noneEnabled= steps.every(s => stepMeta[s.step]?.enabled === false);
  chkAll.checked = allEnabled;
  chkAll.indeterminate = !allEnabled && !noneEnabled;
}

async function saveMetaAndUpdate() {
  await chrome.storage.local.set({ stepMeta });
  updateEnabledCount();
  updateSelectAllCheckbox();
}

// ── Select-all checkbox ───────────────────────────────────────────
chkAll.addEventListener('change', () => {
  steps.forEach(s => {
    if (!stepMeta[s.step]) stepMeta[s.step] = { enabled: true, memo: '' };
    stepMeta[s.step].enabled = chkAll.checked;
  });
  // Update all toggles visually
  document.querySelectorAll('.step-toggle').forEach(chk => {
    chk.checked = chkAll.indeterminate ? chk.checked : chkAll.checked;
  });
  document.querySelectorAll('.step-row').forEach(row => {
    const id = parseInt(row.dataset.stepId);
    row.classList.toggle('disabled-row', !stepMeta[id]?.enabled);
  });
  saveMetaAndUpdate();
});

// ── Record toggle ─────────────────────────────────────────────────
btnRecord.addEventListener('click', async () => {
  isRecording = !isRecording;
  if (isRecording) { steps = []; stepMeta = {}; }

  await chrome.storage.local.set({ isRecording, steps, stepMeta });
  await chrome.runtime.sendMessage({ type: 'SET_RECORDING_STATE', isRecording });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    } catch (_) {}
  }

  renderStatus();
  renderStepsList();
});

// ── Clear ─────────────────────────────────────────────────────────
btnClear.addEventListener('click', async () => {
  steps = []; stepMeta = {};
  await chrome.storage.local.set({ steps, stepMeta });
  renderStatus();
  renderStepsList();
});

// ── New step from content script ──────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ADD_STEP') {
    const s = message.step;
    steps.push(s);
    if (!stepMeta[s.step]) stepMeta[s.step] = { enabled: true, memo: '' };
    chrome.storage.local.set({ steps, stepMeta });
    renderStatus();
    renderStepsList();
  }
});

// ── Export ────────────────────────────────────────────────────────
btnExport.addEventListener('click', () => {
  const activeSteps = steps.filter(s => stepMeta[s.step]?.enabled !== false);
  if (activeSteps.length === 0) { showToast('⚠ 出力対象のステップがありません'); return; }

  const format = formatSelect.value;
  const content = format === 'html'
    ? generateHTML(activeSteps)
    : generateMarkdown(activeSteps);
  const ext  = format === 'html' ? 'html' : 'md';
  const mime = format === 'html' ? 'text/html' : 'text/markdown';
  downloadBlob(content, `手順書_${today()}.${ext}`, mime);
  showToast(`✅ 手順書を保存しました（${activeSteps.length} ステップ）`);
});

// ── File import (Edit tab) ────────────────────────────────────────
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadFileIntoEditor(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFileIntoEditor(fileInput.files[0]);
});

function loadFileIntoEditor(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['html','htm','md'].includes(ext)) {
    showToast('⚠ .html または .md ファイルを選択してください');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    loadedFile = { name: file.name, content: e.target.result, ext };
    loadedFileName.textContent = file.name;
    loadedInfo.classList.add('visible');
    editorWrap.classList.add('visible');
    htmlEditor.value = e.target.result;
    showToast(`📂 ${file.name} を読み込みました`);
  };
  reader.readAsText(file, 'UTF-8');
}

btnCloseFile.addEventListener('click', () => {
  loadedFile = null;
  htmlEditor.value = '';
  loadedInfo.classList.remove('visible');
  editorWrap.classList.remove('visible');
  fileInput.value = '';
});

btnPreview.addEventListener('click', () => {
  if (!htmlEditor.value.trim()) return;
  const ext = loadedFile?.ext || 'html';
  if (ext === 'md') {
    showToast('ℹ Markdownは保存後にブラウザ等で確認できます');
    return;
  }
  const blob = new Blob([htmlEditor.value], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  chrome.tabs.create({ url });
});

btnSaveEdit.addEventListener('click', () => {
  if (!htmlEditor.value.trim()) return;
  const ext  = loadedFile?.ext || 'html';
  const mime = ext === 'md' ? 'text/markdown' : 'text/html';
  const base = loadedFile?.name.replace(/\.[^.]+$/, '') || `手順書_編集済_${today()}`;
  downloadBlob(htmlEditor.value, `${base}_edited.${ext}`, mime);
  showToast('💾 編集済みファイルを保存しました');
});

// ── Generators ────────────────────────────────────────────────────
function generateMarkdown(activeSteps) {
  const now   = new Date().toLocaleString('ja-JP');
  const title = activeSteps[0]?.title || '操作手順書';
  let md = `# ${title}\n\n`;
  md += `> **作成日時:** ${now}  \n`;
  md += `> **総ステップ数:** ${activeSteps.length}\n\n---\n\n`;

  activeSteps.forEach((s, i) => {
    const actionLabel = { click: 'クリック', input: '入力', select: '選択' }[s.action] || s.action;
    const memo        = stepMeta[s.step]?.memo || '';
    md += `## ステップ ${i+1}：${actionLabel} — ${s.element}\n\n`;
    md += `**ページ:** [${tryHostname(s.url)}](${s.url})  \n`;
    md += `**操作:** ${actionLabel} → ${s.element}  \n`;
    if (s.value) md += `**入力値:** \`${s.value}\`  \n`;
    if (memo)    md += `**メモ:** ${memo}  \n`;
    md += `**日時:** ${new Date(s.timestamp).toLocaleString('ja-JP')}  \n\n`;
    if (s.screenshot) md += `![ステップ ${i+1} スクリーンショット](${s.screenshot})\n\n`;
    md += `---\n\n`;
  });
  return md;
}

function generateHTML(activeSteps) {
  const now   = new Date().toLocaleString('ja-JP');
  const title = activeSteps[0]?.title || '操作手順書';

  const stepsHTML = activeSteps.map((s, i) => {
    const actionLabel = { click: 'クリック', input: '入力', select: '選択' }[s.action] || s.action;
    const actionColor = { click: '#e94560', input: '#4a9eff', select: '#50c878' }[s.action] || '#888';
    const memo        = stepMeta[s.step]?.memo || '';

    return `
    <div class="step-card">
      <div class="step-header">
        <div class="step-number">${i+1}</div>
        <div class="step-meta">
          <div class="step-title">
            <span class="action-badge" style="background:${actionColor}22;color:${actionColor};border:1px solid ${actionColor}44">${actionLabel}</span>
            ${escapeHtml(s.element)}
          </div>
          <div class="step-detail">
            <span>🌐 <a href="${s.url}" target="_blank">${escapeHtml(tryHostname(s.url))}</a></span>
            ${s.value ? `<span>⌨ 入力値: <code>${escapeHtml(s.value)}</code></span>` : ''}
            ${memo     ? `<span>💬 ${escapeHtml(memo)}</span>` : ''}
            <span>🕐 ${new Date(s.timestamp).toLocaleString('ja-JP')}</span>
          </div>
        </div>
      </div>
      ${s.screenshot ? `<div class="step-screenshot"><img src="${s.screenshot}" alt="ステップ ${i+1}"></div>` : ''}
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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
  <div class="meta">
    <span>📅 作成日時: ${now}</span>
    <span>📌 総ステップ数: ${activeSteps.length}</span>
  </div>
  ${stepsHTML}
  <div class="footer">このドキュメントは「操作手順書ジェネレーター」Chrome拡張機能で自動生成されました</div>
</div>
</body>
</html>`;
}

// ── Helpers ───────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function tryHostname(url) {
  try { const u = new URL(url); return u.hostname + u.pathname; }
  catch(_) { return url; }
}

function today() {
  return new Date().toISOString().slice(0,10);
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

init();
