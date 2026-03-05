// finalizer.js — multi-document navigation package creator

// ── DOM ───────────────────────────────────────────────────────────────
const dropZone     = document.getElementById('dropZone');
const fileInput    = document.getElementById('fileInput');
const btnAdd       = document.getElementById('btnAdd');
const docList      = document.getElementById('docList');
const btnExport    = document.getElementById('btnExport');
const docCount     = document.getElementById('docCount');
const navTitleInput = document.getElementById('navTitleInput');
const toast        = document.getElementById('toast');

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

// ── State ─────────────────────────────────────────────────────────────
// docs: [{ title, stepCount, zip (JSZip), enabled, origName }]
let docs = [];

// ── File loading ──────────────────────────────────────────────────────
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => { if (fileInput.files.length) { addFiles(fileInput.files); fileInput.value = ''; } });
btnAdd.addEventListener('click', () => fileInput.click());

async function addFiles(fileList) {
  const files = [...fileList].filter(f => f.name.toLowerCase().endsWith('.zip'));
  if (!files.length) { showToast('⚠ .zip ファイルを選択してください'); return; }
  for (const file of files) await addZipFile(file);
  renderDocList();
  updateExportBtn();
}

async function addZipFile(file) {
  if (typeof JSZip === 'undefined') { showToast('⚠ JSZip の読み込みを待っています...'); return; }
  try {
    const zip = await JSZip.loadAsync(file);
    const htmlEntry = zip.file('index.html');
    if (!htmlEntry) { showToast(`⚠ ${file.name}: index.html が見つかりません`); return; }
    const html = await htmlEntry.async('string');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = doc.querySelector('h1')?.textContent?.replace(/^📋\s*/, '').trim() || file.name.replace(/\.zip$/i, '');
    const stepCount = doc.querySelectorAll('.step-card').length;
    docs.push({ title, stepCount, zip, enabled: true, origName: file.name });
    showToast(`📂 ${file.name} を追加しました（${stepCount} ステップ）`);
  } catch (err) {
    showToast(`⚠ ${file.name}: 読み込みに失敗しました`);
    console.error(err);
  }
}

// ── Render ────────────────────────────────────────────────────────────
function renderDocList() {
  if (docs.length === 0) {
    docList.innerHTML = '<div class="empty-hint">手順書 ZIP をドロップするか、「＋ ZIPファイルを追加」で追加してください</div>';
    return;
  }
  docList.innerHTML = '';
  docs.forEach((d, i) => {
    const item = document.createElement('div');
    item.className = `doc-item${d.enabled ? '' : ' disabled'}`;
    item.dataset.i = i;
    item.innerHTML = `
      <label class="toggle"><input type="checkbox" class="doc-chk" data-i="${i}" ${d.enabled ? 'checked' : ''}><span class="toggle-track"></span></label>
      <div class="doc-num-badge">${String(i + 1).padStart(2, '0')}</div>
      <div class="doc-body">
        <span class="doc-title-span" data-i="${i}">${esc(d.title)}</span>
        <div class="doc-meta">${d.stepCount} ステップ · ${esc(d.origName)}</div>
      </div>
      <div class="doc-actions">
        <button class="order-btn" data-i="${i}" data-dir="up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="order-btn" data-i="${i}" data-dir="down" ${i === docs.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="remove-btn" data-i="${i}" title="削除">×</button>
      </div>`;
    docList.appendChild(item);
  });

  docList.querySelectorAll('.doc-chk').forEach(chk => {
    chk.addEventListener('change', () => {
      docs[+chk.dataset.i].enabled = chk.checked;
      chk.closest('.doc-item').classList.toggle('disabled', !chk.checked);
      updateExportBtn();
    });
  });
  docList.querySelectorAll('.doc-title-span').forEach(span => {
    span.addEventListener('click', () => startTitleEdit(span));
  });
  docList.querySelectorAll('.order-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i, dir = btn.dataset.dir === 'up' ? -1 : 1;
      const j = i + dir;
      if (j < 0 || j >= docs.length) return;
      [docs[i], docs[j]] = [docs[j], docs[i]];
      renderDocList(); updateExportBtn();
    });
  });
  docList.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      docs.splice(+btn.dataset.i, 1);
      renderDocList(); updateExportBtn();
    });
  });
}

function startTitleEdit(span) {
  const i = +span.dataset.i;
  const inp = document.createElement('input');
  inp.className = 'doc-title-input'; inp.value = docs[i].title;
  span.replaceWith(inp); inp.focus(); inp.select();
  const commit = () => {
    docs[i].title = inp.value.trim() || docs[i].title;
    span.textContent = docs[i].title;
    inp.replaceWith(span);
  };
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { inp.value = docs[i].title; commit(); }
  });
}

function updateExportBtn() {
  const active = docs.filter(d => d.enabled);
  const total = docs.length;
  if (total > 0) {
    docCount.style.display = '';
    docCount.innerHTML = `<span>${active.length}</span> / ${total} 件 出力対象`;
  } else {
    docCount.style.display = 'none';
  }
  btnExport.disabled = active.length === 0;
}

// ── Export ────────────────────────────────────────────────────────────
btnExport.addEventListener('click', async () => {
  const active = docs.filter(d => d.enabled);
  if (!active.length) { showToast('⚠ 出力対象の手順書がありません'); return; }
  await exportMasterZip(active);
});

async function exportMasterZip(activeDocs) {
  if (typeof JSZip === 'undefined') { showToast('⚠ JSZip の読み込みを待っています...'); return; }
  showToast('⏳ ZIPを作成中...');
  try {
    const masterZip = new JSZip();

    for (let i = 0; i < activeDocs.length; i++) {
      const d = activeDocs[i];
      const prefix = `doc_${String(i + 1).padStart(3, '0')}`;
      const tasks = [];
      d.zip.forEach((relPath, entry) => {
        if (!entry.dir) {
          tasks.push(entry.async('uint8array').then(data => {
            masterZip.file(`${prefix}/${relPath}`, data);
          }));
        }
      });
      await Promise.all(tasks);
    }

    const navTitle = navTitleInput.value.trim() || '操作手順書';
    const firstDoc = 'doc_001/index.html';

    const navLinks = activeDocs.map((d, i) => {
      const prefix = `doc_${String(i + 1).padStart(3, '0')}`;
      return `      <a class="doc-link" href="javascript:void(0)" data-src="${prefix}/index.html" onclick="navigate(this,'${prefix}/index.html')">
        <span class="doc-num">${String(i + 1).padStart(2, '0')}</span>${esc(d.title)}
      </a>`;
    }).join('\n');

    masterZip.file('index.html', buildNavPageHTML(navTitle, navLinks, firstDoc));

    const blob = await masterZip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${navTitle}_navigation.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(`✅ ${navTitle}_navigation.zip を保存しました（${activeDocs.length} 件）`);
  } catch (err) {
    showToast('⚠ ZIP の作成に失敗しました');
    console.error(err);
  }
}

// ── Navigation page builder ───────────────────────────────────────────
function buildNavPageHTML(title, navLinks, firstDoc) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;overflow:hidden;font-family:'Noto Sans JP',sans-serif}
  .container{display:flex;height:100vh}
  .sidebar{width:280px;min-width:200px;background:#1a1a2e;color:#e8e8f0;display:flex;flex-direction:column;overflow:hidden;border-right:1px solid #2a2a3e;flex-shrink:0}
  .sidebar-header{padding:16px 16px 12px;border-bottom:1px solid #2a2a3e;display:flex;align-items:center;gap:10px}
  .sidebar-logo{width:26px;height:26px;background:linear-gradient(135deg,#e94560,#c62a47);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0}
  .sidebar-title{font-size:13px;font-weight:700;color:#f0f0ff;line-height:1.3}
  .sidebar-list{flex:1;overflow-y:auto;padding:8px 0}
  .sidebar-list::-webkit-scrollbar{width:4px}
  .sidebar-list::-webkit-scrollbar-thumb{background:#2a2a3e;border-radius:2px}
  .doc-link{display:block;padding:10px 14px;color:#8080b0;font-size:12px;text-decoration:none;cursor:pointer;border-left:3px solid transparent;transition:all 0.15s;border-bottom:1px solid #151525;line-height:1.4}
  .doc-link:hover{background:#1e1e30;color:#c0c0e0}
  .doc-link.active{background:#1e1e30;color:#f0f0ff;border-left-color:#e94560}
  .doc-num{font-size:10px;color:#e94560;font-weight:700;margin-right:6px}
  .content{flex:1;overflow:hidden}
  iframe{width:100%;height:100%;border:none}
</style>
</head>
<body>
<div class="container">
  <div class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-logo">📋</div>
      <div class="sidebar-title">${esc(title)}</div>
    </div>
    <div class="sidebar-list">
${navLinks}
    </div>
  </div>
  <div class="content">
    <iframe id="docFrame" src="${firstDoc}"></iframe>
  </div>
</div>
<script>
  function navigate(el, src) {
    document.querySelectorAll('.doc-link').forEach(l => l.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('docFrame').src = src;
  }
  // Activate first link on load
  document.querySelector('.doc-link')?.classList.add('active');
<\/script>
</body>
</html>`;
}

// ── Helpers ───────────────────────────────────────────────────────────
function esc(str) { return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showToast(msg) { toast.textContent = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2800); }
