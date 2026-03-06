// viewer.js — standalone ZIP viewer (照会モード)

// ── DOM ───────────────────────────────────────────────────────────────
const loadArea     = document.getElementById('loadArea');
const dropZone     = document.getElementById('dropZone');
const fileInput    = document.getElementById('fileInput');
const contentFrame = document.getElementById('contentFrame');
const docTitle     = document.getElementById('docTitle');
const btnEdit      = document.getElementById('btnEdit');
const btnOpenFile  = document.getElementById('btnOpenFile');
const btnToggleTheme = document.getElementById('btnToggleTheme');
const toast        = document.getElementById('toast');

// ── Theme ─────────────────────────────────────────────────────────────
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

// ── State ─────────────────────────────────────────────────────────────
let currentZip = null;
let currentFilename = '';
let blobUrls = [];

// ── File loading ──────────────────────────────────────────────────────
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) { loadFile(fileInput.files[0]); fileInput.value = ''; }
});
btnOpenFile.addEventListener('click', () => fileInput.click());

function loadFile(file) {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    showToast('⚠ .zip ファイルを選択してください');
    return;
  }
  loadZipSource(file, file.name);
}

async function loadZipSource(source, name) {
  if (typeof JSZip === 'undefined') { showToast('⚠ JSZip の読み込みを待っています...'); return; }
  showToast('⏳ 読み込み中...');
  try {
    const zip = await JSZip.loadAsync(source);
    currentZip = zip;
    currentFilename = name;
    await renderZip(zip, name);
  } catch (err) {
    showToast('⚠ ZIPの読み込みに失敗しました');
    console.error(err);
  }
}

// ── Render ────────────────────────────────────────────────────────────
async function renderZip(zip, name) {
  // Revoke previous blob URLs
  blobUrls.forEach(u => URL.revokeObjectURL(u));
  blobUrls = [];

  const htmlEntry = zip.file('index.html');
  if (!htmlEntry) { showToast('⚠ index.html が見つかりません'); return; }
  let html = await htmlEntry.async('string');
  const parsedDoc = new DOMParser().parseFromString(html, 'text/html');
  const extractedTitle = parsedDoc.querySelector('h1')?.textContent?.replace(/^📋\s*/, '').trim() || name;

  // Replace image paths with blob URLs
  const imgReplacements = {};
  const tasks = [];
  zip.forEach((relPath, entry) => {
    if (!entry.dir && /\.(png|jpg|jpeg|gif|webp)$/i.test(relPath)) {
      tasks.push(entry.async('blob').then(blob => {
        const url = URL.createObjectURL(blob);
        blobUrls.push(url);
        imgReplacements[relPath] = url;
      }));
    }
  });
  await Promise.all(tasks);

  for (const [path, url] of Object.entries(imgReplacements)) {
    html = html.replaceAll(path, url);
  }

  const htmlBlob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const htmlUrl = URL.createObjectURL(htmlBlob);
  blobUrls.push(htmlUrl);

  contentFrame.src = htmlUrl;
  docTitle.textContent = extractedTitle;

  contentFrame.style.display = '';
  loadArea.style.display = 'none';
  btnEdit.style.display = '';
  showToast('✅ 読み込みました');
}

// ── Open in editor ─────────────────────────────────────────────────────
btnEdit.addEventListener('click', async () => {
  if (!currentZip) return;
  showToast('⏳ エディターを準備中...');
  try {
    const blob = await currentZip.generateAsync({ type: 'blob' });
    const blobUrl = URL.createObjectURL(blob);
    const base = chrome.runtime?.getURL ? chrome.runtime.getURL('editor.html') : 'editor.html';
    const editorUrl = `${base}?zipUrl=${encodeURIComponent(blobUrl)}&filename=${encodeURIComponent(currentFilename)}`;
    window.open(editorUrl, '_blank');
    // Keep blob URL alive long enough for editor to fetch it
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    showToast('✅ エディターを開きました');
  } catch (err) {
    showToast('⚠ エディターを開けませんでした');
    console.error(err);
  }
});

// ── Load from URL params (opened from finalizer) ──────────────────────
(async () => {
  const params = new URLSearchParams(location.search);
  const zipUrl = params.get('zipUrl');
  const filename = params.get('filename');
  if (!zipUrl || !filename) return;
  showToast('⏳ 読み込み中...');
  try {
    const response = await fetch(zipUrl);
    const blob = await response.blob();
    await loadZipSource(blob, decodeURIComponent(filename));
  } catch (err) {
    showToast('⚠ ZIPの読み込みに失敗しました');
    console.error(err);
  }
})();

// ── Helpers ───────────────────────────────────────────────────────────
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}
