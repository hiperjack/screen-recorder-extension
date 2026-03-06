// finalizer.js — multi-document navigation package creator

// ── DOM ───────────────────────────────────────────────────────────────
const dropZone      = document.getElementById('dropZone');
const fileInput     = document.getElementById('fileInput');
const btnAdd        = document.getElementById('btnAdd');
const btnAddSection = document.getElementById('btnAddSection');
const docList       = document.getElementById('docList');
const btnExport     = document.getElementById('btnExport');
const docCount      = document.getElementById('docCount');
const navTitleInput = document.getElementById('navTitleInput');
const toast         = document.getElementById('toast');

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
// docs: [{ type:'doc', title, stepCount, zip, enabled, origName } | { type:'section', label }]
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
btnAddSection.addEventListener('click', () => {
  docs.push({ type: 'section', label: '新しいセクション', level: 1 });
  renderDocList();
});

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
    docs.push({ type: 'doc', title, stepCount, zip, enabled: true, origName: file.name });
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
  let docNum = 0;
  docs.forEach((d, i) => {
    const item = document.createElement('div');

    if (d.type === 'section') {
      const level = d.level || 1;
      item.className = 'doc-section-item';
      item.dataset.i = i;
      item.dataset.level = level;
      item.innerHTML = `
        <span class="section-icon">📁</span>
        <span class="section-label-span" data-i="${i}">${esc(d.label)}</span>
        <div class="level-controls">
          <button class="level-btn" data-i="${i}" data-dir="-1" ${level <= 1 ? 'disabled' : ''}>◀</button>
          <span class="level-badge">Lv.${level}</span>
          <button class="level-btn" data-i="${i}" data-dir="1" ${level >= 3 ? 'disabled' : ''}>▶</button>
        </div>
        <div class="doc-actions">
          <button class="order-btn" data-i="${i}" data-dir="up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="order-btn" data-i="${i}" data-dir="down" ${i === docs.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="remove-btn" data-i="${i}" title="削除">×</button>
        </div>`;
    } else {
      docNum++;
      item.className = `doc-item${d.enabled ? '' : ' disabled'}`;
      item.dataset.i = i;
      item.innerHTML = `
        <label class="toggle"><input type="checkbox" class="doc-chk" data-i="${i}" ${d.enabled ? 'checked' : ''}><span class="toggle-track"></span></label>
        <div class="doc-num-badge">${String(docNum).padStart(2, '0')}</div>
        <div class="doc-body">
          <span class="doc-title-span" data-i="${i}">${esc(d.title)}</span>
          <div class="doc-meta">${d.stepCount} ステップ · ${esc(d.origName)}</div>
        </div>
        <div class="doc-actions">
          <button class="view-btn" data-i="${i}" title="照会">👁</button>
          <button class="order-btn" data-i="${i}" data-dir="up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="order-btn" data-i="${i}" data-dir="down" ${i === docs.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="remove-btn" data-i="${i}" title="削除">×</button>
        </div>`;
    }
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
  docList.querySelectorAll('.section-label-span').forEach(span => {
    span.addEventListener('click', () => startSectionEdit(span));
  });
  docList.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i;
      docs[i].level = Math.max(1, Math.min(3, (docs[i].level || 1) + +btn.dataset.dir));
      renderDocList();
    });
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
  docList.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => viewDoc(+btn.dataset.i));
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

function startSectionEdit(span) {
  const i = +span.dataset.i;
  const inp = document.createElement('input');
  inp.className = 'section-label-input'; inp.value = docs[i].label;
  span.replaceWith(inp); inp.focus(); inp.select();
  const commit = () => {
    docs[i].label = inp.value.trim() || docs[i].label;
    span.textContent = docs[i].label;
    inp.replaceWith(span);
  };
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { inp.value = docs[i].label; commit(); }
  });
}

function updateExportBtn() {
  const docItems = docs.filter(d => d.type !== 'section');
  const active = docItems.filter(d => d.enabled);
  const total = docItems.length;
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
  const active = docs.filter(d => d.type !== 'section' && d.enabled);
  if (!active.length) { showToast('⚠ 出力対象の手順書がありません'); return; }
  await exportMasterZip(docs);
});

async function exportMasterZip(allDocs) {
  if (typeof JSZip === 'undefined') { showToast('⚠ JSZip の読み込みを待っています...'); return; }
  showToast('⏳ ZIPを作成中...');
  try {
    const masterZip = new JSZip();

    // Assign prefixes to enabled doc items
    let docIndex = 0;
    for (const d of allDocs) {
      if (d.type === 'section') continue;
      if (!d.enabled) { d._prefix = null; continue; }
      docIndex++;
      d._prefix = `doc_${String(docIndex).padStart(3, '0')}`;
    }

    // Copy doc files into master zip
    const tasks = [];
    for (const d of allDocs) {
      if (d.type === 'section' || !d.enabled || !d._prefix) continue;
      const prefix = d._prefix;
      d.zip.forEach((relPath, entry) => {
        if (!entry.dir) {
          tasks.push(entry.async('uint8array').then(data => {
            masterZip.file(`${prefix}/${relPath}`, data);
          }));
        }
      });
    }
    await Promise.all(tasks);

    const navTitle = navTitleInput.value.trim() || '操作手順書';
    const firstDoc = allDocs.find(d => d.type !== 'section' && d.enabled && d._prefix);
    const firstDocSrc = firstDoc ? `${firstDoc._prefix}/index.html` : '';

    masterZip.file('index.html', buildNavPageHTML(navTitle, allDocs, firstDocSrc));

    const blob = await masterZip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${navTitle}_navigation.zip`;
    a.click();
    URL.revokeObjectURL(a.href);

    const activeCount = allDocs.filter(d => d.type !== 'section' && d.enabled).length;
    showToast(`✅ ${navTitle}_navigation.zip を保存しました（${activeCount} 件）`);

    // Clean up temp prefixes
    for (const d of allDocs) delete d._prefix;
  } catch (err) {
    showToast('⚠ ZIP の作成に失敗しました');
    console.error(err);
    for (const d of allDocs) delete d._prefix;
  }
}

// ── Navigation page builder ───────────────────────────────────────────
function buildNavLinks(allDocs) {
  let html = '';
  let docNum = 0;
  let depth = 0;
  const openLevels = [];

  function closeToLevel(targetLevel) {
    while (openLevels.length > 0 && openLevels[openLevels.length - 1] >= targetLevel) {
      depth--;
      const ind = '  '.repeat(depth);
      html += `${ind}  </div>\n${ind}</div>\n`;
      openLevels.pop();
    }
  }

  for (const d of allDocs) {
    if (d.type === 'section') {
      const level = d.level || 1;
      closeToLevel(level);
      const ind = '  '.repeat(depth);
      html += `${ind}<div class="section-group level-${level}">\n`;
      html += `${ind}  <div class="section-hdr" onclick="toggleSection(this)"><span class="section-arrow">▾</span><span>${esc(d.label)}</span></div>\n`;
      html += `${ind}  <div class="section-docs">\n`;
      depth++;
      openLevels.push(level);
    } else if (d.enabled && d._prefix) {
      docNum++;
      const ind = '  '.repeat(depth);
      html += ind + navLinkHTML(docNum, d.title, d._prefix);
    }
  }
  closeToLevel(0); // close all remaining open sections
  return html;
}

function navLinkHTML(num, title, prefix) {
  const src = `${prefix}/index.html`;
  return `<a class="doc-link" href="javascript:void(0)" data-src="${src}" onclick="navigate(this,'${src}')"><span class="doc-num">${String(num).padStart(2, '0')}</span>${esc(title)}</a>\n`;
}

function buildNavPageHTML(title, allDocs, firstDocSrc) {
  const navLinks = buildNavLinks(allDocs);
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
  .sidebar{width:280px;min-width:200px;background:#1a1a2e;color:#e8e8f0;display:flex;flex-direction:column;overflow:hidden;border-right:1px solid #2a2a3e;flex-shrink:0;transition:width 0.2s,min-width 0.2s}
  .sidebar.collapsed{width:42px;min-width:42px}
  .sidebar-header{padding:12px 10px;border-bottom:1px solid #2a2a3e;display:flex;align-items:center;gap:8px;min-height:50px;overflow:hidden}
  .sidebar-logo{width:24px;height:24px;background:linear-gradient(135deg,#e94560,#c62a47);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
  .sidebar-title{font-size:13px;font-weight:700;color:#f0f0ff;line-height:1.3;flex:1;overflow:hidden;white-space:nowrap}
  .sidebar-toggle{background:transparent;border:1px solid #2a2a3e;color:#5a5a80;cursor:pointer;border-radius:4px;width:26px;height:26px;font-size:11px;padding:0;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:color 0.15s}
  .sidebar-toggle:hover{color:#a0a0d0;border-color:#3a3a5a}
  .sidebar-body{flex:1;overflow:hidden;display:flex;flex-direction:column}
  .sidebar.collapsed .sidebar-title,.sidebar.collapsed .sidebar-body{display:none}
  .sidebar-list{flex:1;overflow-y:auto;padding:8px 0}
  .sidebar-list::-webkit-scrollbar{width:4px}
  .sidebar-list::-webkit-scrollbar-thumb{background:#2a2a3e;border-radius:2px}
  .doc-link{display:block;padding:10px 14px;color:#8080b0;font-size:12px;text-decoration:none;cursor:pointer;border-left:3px solid transparent;transition:all 0.15s;border-bottom:1px solid #151525;line-height:1.4}
  .doc-link:hover{background:#1e1e30;color:#c0c0e0}
  .doc-link.active{background:#1e1e30;color:#f0f0ff;border-left-color:#e94560}
  .doc-num{font-size:10px;color:#e94560;font-weight:700;margin-right:6px}
  .section-group{border-bottom:1px solid #151525}
  .section-hdr{padding:8px 14px;font-size:11px;font-weight:700;color:#5a5a80;cursor:pointer;display:flex;align-items:center;gap:6px;user-select:none;transition:color 0.15s}
  .section-hdr:hover{color:#9090b0;background:#141424}
  .section-group.level-2>.section-hdr{padding-left:22px;font-size:10px}
  .section-group.level-3>.section-hdr{padding-left:30px;font-size:10px;font-weight:500}
  .section-arrow{font-size:10px;transition:transform 0.2s;display:inline-block;flex-shrink:0}
  .section-group.closed .section-arrow{transform:rotate(-90deg)}
  .section-docs{overflow:hidden;max-height:4000px;transition:max-height 0.25s ease}
  .section-group.closed .section-docs{max-height:0}
  .section-docs>.doc-link{padding-left:24px}
  .section-docs>.section-group>.section-docs>.doc-link{padding-left:34px}
  .section-docs>.section-group>.section-docs>.section-group>.section-docs>.doc-link{padding-left:44px}
  .content{flex:1;overflow:hidden}
  iframe{width:100%;height:100%;border:none}
</style>
</head>
<body>
<div class="container">
  <div class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-logo">📋</div>
      <div class="sidebar-title">${esc(title)}</div>
      <button class="sidebar-toggle" id="sidebarToggle" onclick="toggleSidebar()" title="メニューを開閉">◀</button>
    </div>
    <div class="sidebar-body">
      <div class="sidebar-list">
${navLinks}
      </div>
    </div>
  </div>
  <div class="content">
    <iframe id="docFrame" src="${firstDocSrc}"></iframe>
  </div>
</div>
<script>
  function navigate(el, src) {
    document.querySelectorAll('.doc-link').forEach(l => l.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('docFrame').src = src;
  }
  function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('sidebarToggle');
    sidebar.classList.toggle('collapsed');
    btn.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
  }
  function toggleSection(hdr) {
    hdr.closest('.section-group').classList.toggle('closed');
  }
  // Activate first link on load
  document.querySelector('.doc-link')?.classList.add('active');
<\/script>
</body>
</html>`;
}

// ── Viewer (browse mode) — opens standalone viewer.html ──────────────
async function viewDoc(i) {
  const d = docs[i];
  if (!d.zip) return;
  showToast('⏳ 照会モードを準備中...');
  try {
    const blob = await d.zip.generateAsync({ type: 'blob' });
    const blobUrl = URL.createObjectURL(blob);
    // Keep blob URL alive long enough for viewer.html to fetch it
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    const base = chrome.runtime?.getURL ? chrome.runtime.getURL('viewer.html') : 'viewer.html';
    const viewerUrl = `${base}?zipUrl=${encodeURIComponent(blobUrl)}&filename=${encodeURIComponent(d.origName)}`;
    window.open(viewerUrl, '_blank');
  } catch (err) {
    showToast('⚠ 照会モードを開けませんでした');
    console.error(err);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────
function esc(str) { return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showToast(msg) { toast.textContent = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2800); }
