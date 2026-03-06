// popup.js

// ── i18n ──────────────────────────────────────────────────────────
applyI18n();
const btnLang = document.getElementById('btnLang');
btnLang.textContent = (localStorage.getItem('lang') === 'en') ? '日' : 'EN';
btnLang.addEventListener('click', () => {
  const newLang = localStorage.getItem('lang') === 'en' ? 'ja' : 'en';
  localStorage.setItem('lang', newLang);
  btnLang.textContent = newLang === 'en' ? '日' : 'EN';
  applyI18n();
  renderStatus();
});

// ── DOM ───────────────────────────────────────────────────────────
const btnRecord        = document.getElementById('btnRecord');
const statusDot        = document.getElementById('statusDot');
const statusText       = document.getElementById('statusText');
const stepCount        = document.getElementById('stepCount');
const recordIcon       = document.getElementById('recordIcon');
const recordLabel      = document.getElementById('recordLabel');
const titleDialog      = document.getElementById('titleDialog');
const titleDialogInput = document.getElementById('titleDialogInput');
const btnDialogOk      = document.getElementById('btnDialogOk');
const btnDialogCancel  = document.getElementById('btnDialogCancel');
const toast            = document.getElementById('toast');

// ── State ─────────────────────────────────────────────────────────
let steps       = [];
let isRecording = false;
let docTitle    = '';

// ── Init ─────────────────────────────────────────────────────────
async function init() {
  const stored = await chrome.storage.local.get(['steps', 'isRecording', 'docTitle']);
  steps       = stored.steps    || [];
  isRecording = stored.isRecording || false;
  docTitle    = stored.docTitle || t('popup.title.default');
  renderStatus();
}

// ── Status ────────────────────────────────────────────────────────
function renderStatus() {
  statusDot.className = `status-dot${isRecording ? ' recording' : ''}`;
  statusText.textContent = isRecording
    ? t('popup.status.recording')
    : (steps.length > 0 ? t('popup.status.stopped') : t('popup.status.idle'));
  recordIcon.textContent = isRecording ? '⏹' : '⏺';
  recordLabel.textContent = isRecording ? t('popup.record.stop') : t('popup.record.start');
  btnRecord.classList.toggle('active', isRecording);
  stepCount.innerHTML = steps.length > 0 ? t('popup.steps.recorded', { n: steps.length }) : '';
}

// ── Title dialog ──────────────────────────────────────────────────
btnRecord.addEventListener('click', async () => {
  if (isRecording) {
    await stopRecording();
  } else {
    titleDialogInput.value = docTitle || t('popup.title.default');
    titleDialog.style.display = '';
    requestAnimationFrame(() => { titleDialogInput.focus(); titleDialogInput.select(); });
  }
});

btnDialogOk.addEventListener('click', startRecording);
btnDialogCancel.addEventListener('click', () => { titleDialog.style.display = 'none'; });
titleDialogInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') startRecording();
  if (e.key === 'Escape') titleDialog.style.display = 'none';
});

// ── Record ────────────────────────────────────────────────────────
async function startRecording() {
  titleDialog.style.display = 'none';
  docTitle = titleDialogInput.value.trim() || t('popup.title.default');
  steps = [];
  isRecording = true;
  await chrome.storage.local.set({ docTitle, steps, stepMeta: {}, isRecording: true });
  await chrome.runtime.sendMessage({ type: 'SET_RECORDING_STATE', isRecording: true, lang: localStorage.getItem('lang') || 'ja' });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) { try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch(_){} }
  renderStatus();
}

async function stopRecording() {
  isRecording = false;
  await chrome.storage.local.set({ isRecording: false });
  await chrome.runtime.sendMessage({ type: 'SET_RECORDING_STATE', isRecording: false, lang: localStorage.getItem('lang') || 'ja' });
  if (steps.length === 0) {
    renderStatus();
    showToast(t('toast.no.steps'));
    return;
  }
  renderStatus();
  chrome.tabs.create({ url: chrome.runtime.getURL('editor.html?fromRecording=1') });
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'ADD_STEP') {
    steps.push(msg.step);
    renderStatus();
  }
});

// ── Navigation ────────────────────────────────────────────────────
document.getElementById('btnOpenEditor').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
});
document.getElementById('btnOpenViewer').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
});
document.getElementById('btnOpenFinalizer').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('finalizer.html') });
});

// ── Toast ─────────────────────────────────────────────────────────
function showToast(msg) {
  toast.textContent = msg; toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

init();
