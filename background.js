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
    chrome.storage.local.get('isRecording', (data) => {
      sendResponse({ isRecording: data.isRecording || false });
    });
    return true;
  }

  // State update — broadcast to all tabs
  if (message.type === 'SET_RECORDING_STATE') {
    const isRecording = message.isRecording;
    chrome.storage.local.set({ isRecording });
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'RECORDING_STATE_CHANGED',
          isRecording
        }).catch(() => {});
      });
    });
    sendResponse({ success: true });
    return true;
  }

  // Step relay: content script → storage + popup
  if (message.type === 'ADD_STEP') {
    chrome.storage.local.get('steps', (data) => {
      const steps = data.steps || [];
      steps.push(message.step);
      chrome.storage.local.set({ steps });
      // Forward to popup if open
      chrome.runtime.sendMessage(message).catch(() => {});
    });
    return false;
  }
});
