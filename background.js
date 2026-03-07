// background.js — service worker

// ── Extension icon ────────────────────────────────────────────────────
function drawIcon(size, isRecording) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2, r = size / 2;

  if (isRecording) {
    // Red circle background
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e94560';
    ctx.fill();
    // White inner circle (classic ● recording indicator)
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  } else {
    // Dark gray circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#3a3a5a';
    ctx.fill();
    // White pause bars ⏸
    const bw = Math.max(2, r * 0.22), bh = r * 0.72, by = cy - bh / 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - r * 0.34, by, bw, bh);
    ctx.fillRect(cx + r * 0.12, by, bw, bh);
  }

  return ctx.getImageData(0, 0, size, size);
}

function updateActionIcon(isRecording) {
  chrome.action.setIcon({
    imageData: {
      16: drawIcon(16, isRecording),
      32: drawIcon(32, isRecording),
    }
  });
}

// Sync icon on service worker startup
chrome.storage.local.get('isRecording', data => {
  updateActionIcon(data.isRecording || false);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Screenshot capture (called from content script)
  if (message.type === 'CAPTURE_SCREENSHOT') {
    const windowId = sender.tab?.windowId;
    chrome.tabs.captureVisibleTab(windowId, { format: 'png', quality: 85 }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ screenshot: dataUrl });
      }
    });
    return true;
  }

  // State query
  if (message.type === 'GET_RECORDING_STATE') {
    chrome.storage.local.get(['isRecording', 'lang'], (data) => {
      sendResponse({ isRecording: data.isRecording || false, lang: data.lang || 'ja' });
    });
    return true;
  }

  // State update — broadcast to all tabs
  if (message.type === 'SET_RECORDING_STATE') {
    const { isRecording, lang = 'ja' } = message;
    chrome.storage.local.set({ isRecording, lang });
    updateActionIcon(isRecording);
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'RECORDING_STATE_CHANGED',
          isRecording,
          lang
        }).catch(() => {});
      });
    });
    sendResponse({ success: true });
    return true;
  }

  // Single capture: start → inject content script if needed, then broadcast READY
  if (message.type === 'SINGLE_CAPTURE_START') {
    chrome.storage.session.remove('singleCaptureResult');
    chrome.tabs.query({ currentWindow: true }, tabs => {
      tabs.forEach(tab => {
        if (!tab.url || /^(chrome|chrome-extension|about|data):/.test(tab.url)) {
          return;
        }
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
          .catch(() => {})
          .finally(() => {
            chrome.tabs.sendMessage(tab.id, { type: 'SINGLE_CAPTURE_READY' }).catch(() => {});
          });
      });
    });
    sendResponse({ ok: true });
    return true;
  }

  // Single capture: tab was clicked → capture + save result
  if (message.type === 'SINGLE_CAPTURE_CLICK') {
    const windowId = sender.tab?.windowId;
    chrome.tabs.captureVisibleTab(windowId, { format: 'png', quality: 85 }, dataUrl => {
      const screenshot = chrome.runtime.lastError ? null : (dataUrl || null);
      chrome.storage.session.set({ singleCaptureResult: { screenshot } });
      const wId = sender.tab?.windowId;
      chrome.tabs.query(wId != null ? { windowId: wId } : {}, tabs => {
        tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { type: 'SINGLE_CAPTURE_DONE' }).catch(() => {}));
      });
    });
    return false;
  }

  // Single capture: cancelled from editor
  if (message.type === 'SINGLE_CAPTURE_CANCEL') {
    const wId = sender.tab?.windowId;
    chrome.tabs.query(wId != null ? { windowId: wId } : {}, tabs => {
      tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { type: 'SINGLE_CAPTURE_DONE' }).catch(() => {}));
    });
    return false;
  }

  // Capture screenshot + save step — all handled here so content script
  // doesn't need to wait for a response (survives page navigation)
  if (message.type === 'CAPTURE_AND_SAVE_STEP') {
    const step = message.step;
    const windowId = sender.tab?.windowId;
    chrome.tabs.captureVisibleTab(windowId, { format: 'png', quality: 85 }, (dataUrl) => {
      step.screenshot = chrome.runtime.lastError ? null : (dataUrl || null);
      chrome.storage.local.get('steps', (data) => {
        const steps = data.steps || [];
        steps.push(step);
        chrome.storage.local.set({ steps });
        chrome.runtime.sendMessage({ type: 'ADD_STEP', step }).catch(() => {});
      });
    });
    return false;
  }

  // Step relay: content script → storage + popup
  if (message.type === 'ADD_STEP') {
    chrome.storage.local.get('steps', (data) => {
      const steps = data.steps || [];
      steps.push(message.step);
      chrome.storage.local.set({ steps });
      chrome.runtime.sendMessage(message).catch(() => {});
    });
    return false;
  }
});
