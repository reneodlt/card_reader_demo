/**
 * Popup UI for Smart Card Reader extension.
 * Reads state from the background service worker and displays it.
 * Provides API debug panel with resend/edit-and-resend, response headers,
 * request duration, and a rolling event log.
 */

const ui = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  readerName: document.getElementById('readerName'),
  cardUid: document.getElementById('cardUid'),
  cardAtr: document.getElementById('cardAtr'),
  cardInfoSection: document.getElementById('cardInfoSection'),
  cardInfo: document.getElementById('cardInfo'),
  errorMsg: document.getElementById('errorMsg'),
  modeBadge: document.getElementById('modeBadge'),
  openSettings: document.getElementById('openSettings'),
  // API debug
  apiRequest: document.getElementById('apiRequest'),
  apiRequestTs: document.getElementById('apiRequestTs'),
  apiResponse: document.getElementById('apiResponse'),
  apiResponseTs: document.getElementById('apiResponseTs'),
  apiDuration: document.getElementById('apiDuration'),
  headersToggle: document.getElementById('headersToggle'),
  respHeaders: document.getElementById('respHeaders'),
  // Resend
  resendBtn: document.getElementById('resendBtn'),
  editToggleBtn: document.getElementById('editToggleBtn'),
  editSection: document.getElementById('editSection'),
  editUrl: document.getElementById('editUrl'),
  editBody: document.getElementById('editBody'),
  editError: document.getElementById('editError'),
  sendEditedBtn: document.getElementById('sendEditedBtn'),
  cancelEditBtn: document.getElementById('cancelEditBtn'),
  // Tabs
  tabs: document.querySelectorAll('.tab'),
  panelApi: document.getElementById('panel-api'),
  panelLog: document.getElementById('panel-log'),
  // Log
  logContainer: document.getElementById('logContainer'),
  clearLogBtn: document.getElementById('clearLogBtn'),
};

const STATUS_LABELS = {
  initializing: 'Initializing...',
  connecting: 'Connecting to Smart Card Connector...',
  ready: 'Waiting for card...',
  card: 'Card detected',
  error: 'Error',
};

// Track last request for resend
let lastRequest = null;

// --- Tab switching ---

ui.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    ui.tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.getAttribute('data-tab');
    ui.panelApi.classList.toggle('active', target === 'api');
    ui.panelLog.classList.toggle('active', target === 'log');
  });
});

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

  // Card info (parsed from ATR)
  if (state.cardInfo && hasCardInfo(state.cardInfo)) {
    ui.cardInfoSection.style.display = '';
    const rows = [];
    if (state.cardInfo.cardName) rows.push(infoRow('Card', state.cardInfo.cardName));
    if (state.cardInfo.standard) rows.push(infoRow('Standard', state.cardInfo.standard));
    if (state.cardInfo.cardType) rows.push(infoRow('Type', state.cardInfo.cardType));
    if (state.cardInfo.rid) rows.push(infoRow('Manufacturer', state.cardInfo.rid));
    if (state.cardInfo.historicalBytes) rows.push(infoRow('Historical', state.cardInfo.historicalBytes));
    ui.cardInfo.innerHTML = rows.join('');
  } else {
    ui.cardInfoSection.style.display = 'none';
    ui.cardInfo.innerHTML = '';
  }

  // Error
  ui.errorMsg.textContent = state.error || '';

  // API Request
  if (state.apiRequest) {
    const r = state.apiRequest;
    lastRequest = r;
    const headerLines = r.headers
      ? Object.entries(r.headers).map(([k, v]) => k + ': ' + v).join('\n')
      : '';
    ui.apiRequest.textContent =
      'POST ' + r.url + '\n' +
      (headerLines ? headerLines + '\n\n' : '\n') +
      JSON.stringify(r.body, null, 2);
    ui.apiRequest.className = 'api-value';
    ui.apiRequestTs.textContent = formatTs(r.timestamp);
    ui.resendBtn.disabled = false;
    ui.editToggleBtn.disabled = false;
  } else {
    ui.apiRequest.innerHTML = '<span class="empty">No request yet</span>';
    ui.apiRequest.className = 'api-value';
    ui.apiRequestTs.textContent = '';
    ui.resendBtn.disabled = true;
    ui.editToggleBtn.disabled = true;
  }

  // API Response
  if (state.apiResponse) {
    const r = state.apiResponse;
    if (r.error) {
      ui.apiResponse.textContent = 'ERROR: ' + r.error;
      ui.apiResponse.className = 'api-value err';
      ui.headersToggle.style.display = 'none';
      ui.respHeaders.className = 'resp-headers';
    } else {
      const body = typeof r.body === 'object' ? JSON.stringify(r.body, null, 2) : r.body;
      ui.apiResponse.textContent = r.status + ' ' + (r.statusText || '') + '\n' + body;
      ui.apiResponse.className = 'api-value ' + (r.status >= 200 && r.status < 300 ? 'ok' : 'err');

      // Response headers
      if (r.headers && Object.keys(r.headers).length > 0) {
        ui.headersToggle.style.display = '';
        ui.respHeaders.textContent = Object.entries(r.headers)
          .map(([k, v]) => k + ': ' + v)
          .join('\n');
      } else {
        ui.headersToggle.style.display = 'none';
      }
    }

    // Duration
    if (r.duration !== undefined) {
      ui.apiDuration.textContent = '(' + r.duration + 'ms)';
    } else {
      ui.apiDuration.textContent = '';
    }

    ui.apiResponseTs.textContent = formatTs(r.timestamp);
  } else {
    ui.apiResponse.innerHTML = '<span class="empty">No response yet</span>';
    ui.apiResponse.className = 'api-value';
    ui.apiResponseTs.textContent = '';
    ui.apiDuration.textContent = '';
    ui.headersToggle.style.display = 'none';
    ui.respHeaders.className = 'resp-headers';
  }

  // Mode badge
  if (settings) {
    const modeLabel = settings.detectionMode === 'poll' ? 'Polling mode' : 'Event mode';
    ui.modeBadge.textContent = modeLabel;
  }
}

function renderLog(log) {
  if (!log || log.length === 0) {
    ui.logContainer.innerHTML = '<div class="log-empty">No events yet</div>';
    return;
  }

  // Render newest first
  const entries = log.slice().reverse();
  ui.logContainer.innerHTML = entries.map((entry) => {
    const ts = formatTs(entry.timestamp);
    const levelCls = 'log-level-' + entry.level;
    let detailHtml = '';
    if (entry.detail !== undefined) {
      const detailStr = typeof entry.detail === 'object'
        ? JSON.stringify(entry.detail, null, 2)
        : String(entry.detail);
      detailHtml = '<div class="log-detail">' + escapeHtml(detailStr) + '</div>';
    }
    return (
      '<div class="log-entry">' +
        '<span class="log-ts">' + escapeHtml(ts) + '</span> ' +
        '<span class="' + levelCls + '">[' + entry.level.toUpperCase() + ']</span> ' +
        '<span class="log-msg">' + escapeHtml(entry.message) + '</span>' +
        detailHtml +
      '</div>'
    );
  }).join('');

  // Auto-scroll to top (newest)
  ui.logContainer.scrollTop = 0;
}

function formatTs(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function hasCardInfo(ci) {
  return ci && (ci.cardName || ci.standard || ci.cardType || ci.rid || ci.historicalBytes);
}

function infoRow(label, value) {
  return (
    '<div class="card-info-row">' +
      '<span class="card-info-key">' + escapeHtml(label) + '</span>' +
      '<span class="card-info-val">' + escapeHtml(value) + '</span>' +
    '</div>'
  );
}

// --- Response headers toggle ---

ui.headersToggle.addEventListener('click', () => {
  const visible = ui.respHeaders.classList.toggle('visible');
  ui.headersToggle.textContent = visible ? 'Hide headers' : 'Show headers';
});

// --- Resend ---

ui.resendBtn.addEventListener('click', () => {
  if (!lastRequest) return;
  ui.resendBtn.disabled = true;
  ui.resendBtn.textContent = 'Sending...';
  chrome.runtime.sendMessage(
    { type: 'resendRequest', url: lastRequest.url, body: lastRequest.body },
    () => {
      ui.resendBtn.disabled = false;
      ui.resendBtn.textContent = 'Resend';
    }
  );
});

// --- Edit & Resend ---

ui.editToggleBtn.addEventListener('click', () => {
  if (!lastRequest) return;
  ui.editUrl.value = lastRequest.url || '';
  ui.editBody.value = JSON.stringify(lastRequest.body, null, 2);
  ui.editError.style.display = 'none';
  ui.editSection.classList.add('active');
});

ui.cancelEditBtn.addEventListener('click', () => {
  ui.editSection.classList.remove('active');
});

ui.sendEditedBtn.addEventListener('click', () => {
  const url = ui.editUrl.value.trim();
  if (!url) {
    ui.editError.textContent = 'URL is required';
    ui.editError.style.display = 'block';
    return;
  }

  let body;
  try {
    body = JSON.parse(ui.editBody.value);
  } catch (e) {
    ui.editError.textContent = 'Invalid JSON: ' + e.message;
    ui.editError.style.display = 'block';
    return;
  }

  ui.editError.style.display = 'none';
  ui.sendEditedBtn.disabled = true;
  ui.sendEditedBtn.textContent = 'Sending...';

  chrome.runtime.sendMessage(
    { type: 'resendRequest', url, body },
    () => {
      ui.sendEditedBtn.disabled = false;
      ui.sendEditedBtn.textContent = 'Send';
      ui.editSection.classList.remove('active');
    }
  );
});

// --- Clear log ---

ui.clearLogBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clearLog' }, () => {
    renderLog([]);
  });
});

// --- Communication with background ---

function requestState() {
  chrome.runtime.sendMessage({ type: 'getState' }, (response) => {
    if (chrome.runtime.lastError) {
      render({ status: 'error', error: 'Background worker not running' }, null);
      return;
    }
    if (response) {
      render(response.state, response.settings);
      if (response.log) renderLog(response.log);
    }
  });
}

// Listen for live updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'stateUpdate') {
    render(msg.state, null);
  }
  if (msg.type === 'logUpdate') {
    renderLog(msg.log);
  }
});

// --- Settings link ---

ui.openSettings.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// --- Init ---

document.addEventListener('DOMContentLoaded', requestState);
