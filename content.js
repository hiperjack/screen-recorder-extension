// content.js — injected into every page
(function () {
  if (window.__procedureRecorderInitialized) return;
  window.__procedureRecorderInitialized = true;

  let isRecording = false;
  let stepCounter = 0;
  let highlightOverlay = null;
  let screenshotTiming = 'mousedown';

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
  let captureInProgress = false;

  async function captureStep(action, el, extra = {}) {
    if (!isRecording || captureInProgress) return;
    captureInProgress = true;
    stepCounter++;

    showHighlight(el);

    // click mode: wait for highlight to render before sending capture request
    if (screenshotTiming === 'click') {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }

    const step = {
      step: stepCounter,
      timestamp: new Date().toISOString(),
      url: location.href,
      title: document.title,
      action,
      element: describeElement(el),
      xpath: getXPath(el),
      ...extra
    };

    // Fire-and-forget: background handles screenshot capture + storage.
    // This message is sent before any navigation can occur, and the background
    // service worker continues even if this content script context is destroyed.
    try {
      chrome.runtime.sendMessage({ type: 'CAPTURE_AND_SAVE_STEP', step });
    } catch (_) {}

    // Hide highlight after a short delay (visual feedback only)
    setTimeout(() => {
      hideHighlight();
      captureInProgress = false;
    }, 400);
  }

  // ── Event listeners ───────────────────────────────────────────────
  function onClick(e) {
    if (!isRecording) return;
    const el = e.target.closest('a, button, input, select, [role="button"], [onclick]') || e.target;
    captureStep('click', el);
  }

  function onMouseDown(e) {
    if (!isRecording || e.button !== 0) return;
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
    if (screenshotTiming === 'mousedown') {
      document.addEventListener('mousedown', onMouseDown, true);
    } else {
      document.addEventListener('click', onClick, true);
    }
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onChange, true);
  }

  function detachListeners() {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('change', onChange, true);
  }

  // ── Message handler ───────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'RECORDING_STATE_CHANGED') {
      screenshotTiming = message.screenshotTiming || 'mousedown';
      isRecording = message.isRecording;
      detachListeners(); // always detach first to prevent duplicate listeners
      if (isRecording) {
        stepCounter = 0;
        createOverlay();
        attachListeners();
        showRecordingBadge();
      } else {
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
      screenshotTiming = res.screenshotTiming || 'mousedown';
      isRecording = true;
      createOverlay();
      attachListeners();
      showRecordingBadge();
    }
  });
})();
