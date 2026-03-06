// background.js — service worker

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
    chrome.storage.local.get(['isRecording', 'screenshotTiming'], (data) => {
      sendResponse({
        isRecording: data.isRecording || false,
        screenshotTiming: data.screenshotTiming || 'mousedown'
      });
    });
    return true;
  }

  // State update — broadcast to all tabs
  if (message.type === 'SET_RECORDING_STATE') {
    const { isRecording, screenshotTiming = 'click' } = message;
    chrome.storage.local.set({ isRecording, screenshotTiming });
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'RECORDING_STATE_CHANGED',
          isRecording,
          screenshotTiming
        }).catch(() => {});
      });
    });
    sendResponse({ success: true });
    return true;
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
