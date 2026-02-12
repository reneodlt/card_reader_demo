/**
 * Popup UI for Smart Card Reader extension.
 * Reads state from the background service worker and displays it.
 * No direct PC/SC communication — background owns the connection.
 */

const ui = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  readerName: document.getElementById('readerName'),
  cardUid: document.getElementById('cardUid'),
  cardAtr: document.getElementById('cardAtr'),
  errorMsg: document.getElementById('errorMsg'),
  modeBadge: document.getElementById('modeBadge'),
  openSettings: document.getElementById('openSettings'),
  apiRequest: document.getElementById('apiRequest'),
  apiRequestTs: document.getElementById('apiRequestTs'),
  apiResponse: document.getElementById('apiResponse'),
  apiResponseTs: document.getElementById('apiResponseTs'),
};

const STATUS_LABELS = {
  initializing: 'Initializing...',
  connecting: 'Connecting to Smart Card Connector...',
  ready: 'Waiting for card...',
  card: 'Card detected',
  error: 'Error',
};

// --- UI rendering ---

function render(state, settings) {
  // Status dot + text
  ui.statusDot.className = 'status-dot ' + (state.status || 'initializing');
  ui.statusText.textContent = STATUS_LABELS[state.status] || state.status;

  // Reader
  if (state.readerName) {
    ui.readerName.textContent = state.readerName;
  } else {
    ui.readerName.innerHTML = '<span class="empty">No reader detected</span>';
  }

  // Card UID
  if (state.cardUid) {
    ui.cardUid.textContent = state.cardUid;
  } else {
    ui.cardUid.innerHTML = '<span class="empty">No card</span>';
  }

  // ATR
  if (state.cardAtr) {
    ui.cardAtr.textContent = state.cardAtr;
  } else {
    ui.cardAtr.innerHTML = '<span class="empty">—</span>';
  }

  // Error
  ui.errorMsg.textContent = state.error || '';

  // API debug
  if (state.apiRequest) {
    const r = state.apiRequest;
    ui.apiRequest.textContent = 'POST ' + r.url + '\n' + JSON.stringify(r.body, null, 2);
    ui.apiRequest.className = 'api-value';
    ui.apiRequestTs.textContent = formatTs(r.timestamp);
  } else {
    ui.apiRequest.innerHTML = '<span class="empty">No request yet</span>';
    ui.apiRequest.className = 'api-value';
    ui.apiRequestTs.textContent = '';
  }

  if (state.apiResponse) {
    const r = state.apiResponse;
    if (r.error) {
      ui.apiResponse.textContent = 'ERROR: ' + r.error;
      ui.apiResponse.className = 'api-value err';
    } else {
      const body = typeof r.body === 'object' ? JSON.stringify(r.body, null, 2) : r.body;
      ui.apiResponse.textContent = r.status + ' ' + body;
      ui.apiResponse.className = 'api-value ' + (r.status >= 200 && r.status < 300 ? 'ok' : 'err');
    }
    ui.apiResponseTs.textContent = formatTs(r.timestamp);
  } else {
    ui.apiResponse.innerHTML = '<span class="empty">No response yet</span>';
    ui.apiResponse.className = 'api-value';
    ui.apiResponseTs.textContent = '';
  }

  // Mode badge
  if (settings) {
    const modeLabel = settings.detectionMode === 'poll' ? 'Polling mode' : 'Event mode';
    ui.modeBadge.textContent = modeLabel;
  }
}

function formatTs(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString();
}

// --- Communication with background ---

function requestState() {
  chrome.runtime.sendMessage({ type: 'getState' }, (response) => {
    if (chrome.runtime.lastError) {
      render({ status: 'error', error: 'Background worker not running' }, null);
      return;
    }
    if (response) {
      render(response.state, response.settings);
    }
  });
}

// Listen for live updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'stateUpdate') {
    render(msg.state, null);
  }
});

// --- Settings link ---

ui.openSettings.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// --- Init ---

document.addEventListener('DOMContentLoaded', requestState);
