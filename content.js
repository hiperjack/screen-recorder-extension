// content.js — injected into every page
(function () {
  if (window.__procedureRecorderInitialized) return;
  window.__procedureRecorderInitialized = true;

  let isRecording = false;
  let stepCounter = 0;
  let highlightOverlay = null;

  // ── Overlay highlight ────────────────────────────────────────────
  function createOverlay() {
    if (highlightOverlay) return;
    highlightOverlay = document.createElement('div');
    highlightOverlay.id = '__proc_overlay';
    Object.assign(highlightOverlay.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483647',
      border: '3px solid #FF4444',
      borderRadius: '4px',
      boxShadow: '0 0 0 2px rgba(255,68,68,0.3)',
      transition: 'all 0.15s ease',
      display: 'none',
      backgroundColor: 'rgba(255,68,68,0.08)'
    });
    document.body.appendChild(highlightOverlay);
  }

  function showHighlight(el) {
    if (!highlightOverlay) createOverlay();
    const rect = el.getBoundingClientRect();
    Object.assign(highlightOverlay.style, {
      display: 'block',
      top: `${rect.top - 3}px`,
      left: `${rect.left - 3}px`,
      width: `${rect.width + 6}px`,
      height: `${rect.height + 6}px`
    });
  }

  function hideHighlight() {
    if (highlightOverlay) highlightOverlay.style.display = 'none';
  }

  // ── Element description ──────────────────────────────────────────
  function describeElement(el) {
    const tag = el.tagName.toLowerCase();
    const label =
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('name') ||
      el.getAttribute('id') ||
      el.innerText?.trim().slice(0, 60) ||
      '';

    const typeAttr = el.getAttribute('type') || '';
    const role = el.getAttribute('role') || '';

    if (tag === 'a') return `リンク「${label || el.href}」`;
    if (tag === 'button' || role === 'button') return `ボタン「${label}」`;
    if (tag === 'input') {
      if (typeAttr === 'checkbox') return `チェックボックス「${label}」`;
      if (typeAttr === 'radio') return `ラジオボタン「${label}」`;
      if (typeAttr === 'submit' || typeAttr === 'button') return `ボタン「${label || typeAttr}」`;
      return `入力フィールド「${label}」`;
    }
    if (tag === 'select') return `ドロップダウン「${label}」`;
    if (tag === 'textarea') return `テキストエリア「${label}」`;
    return label ? `「${label}」` : `${tag}要素`;
  }

  function getXPath(el) {
    if (el.id) return `//*[@id="${el.id}"]`;
    const parts = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let idx = 1;
      let sib = el.previousSibling;
      while (sib) {
        if (sib.nodeType === Node.ELEMENT_NODE && sib.tagName === el.tagName) idx++;
        sib = sib.previousSibling;
      }
      parts.unshift(`${el.tagName.toLowerCase()}[${idx}]`);
      el = el.parentNode;
    }
    return '/' + parts.join('/');
  }

  // ── Capture step ─────────────────────────────────────────────────
  async function captureStep(action, el, extra = {}) {
    if (!isRecording) return;
    stepCounter++;

    showHighlight(el);

    // Small delay to let the highlight render before screenshot
    await new Promise(r => setTimeout(r, 120));

    const screenshot = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' }, res => {
        resolve(res?.screenshot || null);
      });
    });

    hideHighlight();

    const step = {
      step: stepCounter,
      timestamp: new Date().toISOString(),
      url: location.href,
      title: document.title,
      action,
      element: describeElement(el),
      xpath: getXPath(el),
      screenshot,
      ...extra
    };

    chrome.runtime.sendMessage({ type: 'ADD_STEP', step });
  }

  // ── Event listeners ───────────────────────────────────────────────
  function onClick(e) {
    if (!isRecording) return;
    const el = e.target.closest('a, button, input, select, [role="button"], [onclick]') || e.target;
    captureStep('click', el);
  }

  let inputTimer = null;
  function onInput(e) {
    if (!isRecording) return;
    const el = e.target;
    if (!['INPUT', 'TEXTAREA'].includes(el.tagName)) return;
    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => {
      captureStep('input', el, { value: el.value });
    }, 800);
  }

  function onChange(e) {
    if (!isRecording) return;
    const el = e.target;
    if (el.tagName !== 'SELECT') return;
    captureStep('select', el, {
      value: el.options[el.selectedIndex]?.text || el.value
    });
  }

  function attachListeners() {
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onChange, true);
  }

  function detachListeners() {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('change', onChange, true);
  }

  // ── Message handler ───────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'RECORDING_STATE_CHANGED') {
      isRecording = message.isRecording;
      if (isRecording) {
        stepCounter = 0;
        createOverlay();
        attachListeners();
        showRecordingBadge();
      } else {
        detachListeners();
        hideHighlight();
        hideRecordingBadge();
      }
    }
  });

  // ── Recording badge ───────────────────────────────────────────────
  let badge = null;
  function showRecordingBadge() {
    if (badge) return;
    badge = document.createElement('div');
    badge.id = '__proc_badge';
    badge.innerHTML = `
      <span style="display:inline-block;width:10px;height:10px;background:#FF4444;
        border-radius:50%;margin-right:6px;animation:__proc_pulse 1s infinite;"></span>
      記録中
    `;
    Object.assign(badge.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: '2147483647',
      background: 'rgba(0,0,0,0.8)',
      color: '#fff',
      padding: '8px 14px',
      borderRadius: '20px',
      fontSize: '13px',
      fontFamily: 'sans-serif',
      display: 'flex',
      alignItems: 'center',
      pointerEvents: 'none',
      backdropFilter: 'blur(8px)'
    });
    const style = document.createElement('style');
    style.textContent = `@keyframes __proc_pulse {
      0%,100%{opacity:1;transform:scale(1)}
      50%{opacity:0.4;transform:scale(0.8)}
    }`;
    document.head.appendChild(style);
    document.body.appendChild(badge);
  }

  function hideRecordingBadge() {
    if (badge) { badge.remove(); badge = null; }
  }

  // Sync initial state
  chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATE' }, res => {
    if (res?.isRecording) {
      isRecording = true;
      createOverlay();
      attachListeners();
      showRecordingBadge();
    }
  });
})();
