/**
 * Background service worker for Smart Card Reader extension.
 * Maintains persistent connection to Smart Card Connector and monitors
 * for card insertion/removal using either SCardGetStatusChange (event-driven)
 * or SCardStatus polling, depending on settings.
 */

importScripts('pcsc-client.js');

// --- State ---

let client = null;
let running = false;
let currentState = {
  status: 'initializing', // initializing | connecting | ready | card | error
  readerName: null,
  cardUid: null,
  cardAtr: null,
  cardInfo: null,       // { cardType, standard, cardName, rid, historicalBytes }
  error: null,
  apiRequest: null,     // { url, headers, body, timestamp }
  apiResponse: null,    // { status, statusText, headers, body, duration, timestamp } or { error, duration, timestamp }
};

// Rolling debug event log (last 50 entries)
const MAX_LOG_ENTRIES = 50;
let debugLog = [];

function addLog(level, message, detail) {
  const entry = {
    timestamp: new Date().toISOString(),
    level, // 'info' | 'warn' | 'error'
    message,
  };
  if (detail !== undefined) entry.detail = detail;
  debugLog.push(entry);
  if (debugLog.length > MAX_LOG_ENTRIES) debugLog.shift();
  // Broadcast log update to popup
  chrome.runtime.sendMessage({ type: 'logUpdate', log: debugLog }).catch(() => {});
}

let settings = {
  detectionMode: 'event',  // 'event' or 'poll'
  endpointUrl: '',
  venueId: '',
  clientId: '',
};

const POLL_INTERVAL_MS = 1500;
const STATUS_CHANGE_TIMEOUT = 60000; // 60s per SCardGetStatusChange call, then re-call

// --- Settings ---

async function loadSettings() {
  const stored = await chrome.storage.local.get(['detectionMode', 'endpointUrl', 'venueId', 'clientId']);
  settings.detectionMode = stored.detectionMode || 'event';
  settings.endpointUrl = stored.endpointUrl || '';
  settings.venueId = stored.venueId || '';

  // Generate client ID on first run
  if (!stored.clientId) {
    settings.clientId = crypto.randomUUID();
    await chrome.storage.local.set({ clientId: settings.clientId });
    console.log('[bg] Generated new client ID:', settings.clientId);
  } else {
    settings.clientId = stored.clientId;
  }
}

// React to settings changes — restart the monitoring loop
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let modeChanged = false;
  if (changes.detectionMode) {
    settings.detectionMode = changes.detectionMode.newValue;
    modeChanged = true;
  }
  if (changes.endpointUrl) settings.endpointUrl = changes.endpointUrl.newValue;
  if (changes.venueId) settings.venueId = changes.venueId.newValue;
  if (changes.clientId) settings.clientId = changes.clientId.newValue;

  if (modeChanged) {
    console.log('[bg] Detection mode changed to:', settings.detectionMode);
    restart();
  }
});

// --- Broadcast state to popup ---

function updateState(patch) {
  Object.assign(currentState, patch);
  // Broadcast to any open popups / extension pages
  chrome.runtime.sendMessage({ type: 'stateUpdate', state: currentState }).catch(() => {
    // No listeners — that's fine, popup may not be open
  });
}

// Popup requests current state, debug log, or resend
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getState') {
    sendResponse({ state: currentState, settings, log: debugLog });
    return false;
  }
  if (msg.type === 'getLog') {
    sendResponse({ log: debugLog });
    return false;
  }
  if (msg.type === 'resendRequest') {
    // Resend with optional overrides: { url, body }
    const uid = (msg.body && msg.body.card_id) || (currentState.cardUid) || 'unknown';
    addLog('info', 'Resend triggered from popup');
    callEndpoint(uid, { url: msg.url, body: msg.body });
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'clearLog') {
    debugLog = [];
    sendResponse({ ok: true });
    return false;
  }
});

// --- Endpoint call ---

/**
 * Call the configured endpoint, or resend with custom url/body.
 * @param {string} cardUid - Card UID (used to build default body)
 * @param {object} [overrides] - Optional { url, body } for resend
 */
async function callEndpoint(cardUid, overrides) {
  const url = (overrides && overrides.url) || settings.endpointUrl;
  if (!url) {
    const msg = 'No endpoint URL configured, skipping API call';
    console.log('[bg]', msg);
    addLog('warn', msg);
    return;
  }

  let body;
  if (overrides && overrides.body) {
    body = overrides.body;
  } else {
    body = {
      card_id: cardUid,
      venue_id: settings.venueId,
      client_id: settings.clientId,
    };
    // Include card metadata if available
    if (currentState.cardAtr) {
      body.card_atr = currentState.cardAtr;
    }
    if (currentState.cardInfo) {
      const ci = currentState.cardInfo;
      if (ci.cardName) body.card_name = ci.cardName;
      if (ci.standard) body.card_standard = ci.standard;
      if (ci.cardType) body.card_type = ci.cardType;
      if (ci.rid) body.card_rid = ci.rid;
    }
  }

  const requestHeaders = { 'Content-Type': 'application/json' };

  const apiRequest = {
    url,
    headers: requestHeaders,
    body,
    timestamp: new Date().toISOString(),
  };
  updateState({ apiRequest, apiResponse: null });
  addLog('info', 'Sending POST to ' + url, body);

  const startTime = performance.now();

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
    });

    const duration = Math.round(performance.now() - startTime);

    let respBody;
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      respBody = await resp.json();
    } else {
      respBody = await resp.text();
    }

    // Collect response headers
    const respHeaders = {};
    resp.headers.forEach((value, key) => {
      respHeaders[key] = value;
    });

    const apiResponse = {
      status: resp.status,
      statusText: resp.statusText,
      headers: respHeaders,
      body: respBody,
      duration,
      timestamp: new Date().toISOString(),
    };
    updateState({ apiResponse });
    console.log('[bg] API response:', resp.status, respBody);
    addLog(
      resp.status >= 200 && resp.status < 300 ? 'info' : 'warn',
      `Response: ${resp.status} ${resp.statusText} (${duration}ms)`,
      respBody
    );
  } catch (e) {
    const duration = Math.round(performance.now() - startTime);
    const apiResponse = {
      error: e.message,
      duration,
      timestamp: new Date().toISOString(),
    };
    updateState({ apiResponse });
    console.warn('[bg] API call failed:', e.message);
    addLog('error', 'Request failed: ' + e.message);
  }
}

// --- Card reading ---

async function readCard(readerName) {
  let card;
  try {
    card = await client.connectCard(readerName);
  } catch (e) {
    return; // connect failed — no card or reader busy
  }

  try {
    const uid = await client.readCardUid(card.handle, card.protocol);
    let atr = null;
    let cardInfo = null;
    try {
      const st = await client.status(card.handle);
      if (st.atr && st.atr.length > 0) {
        atr = bytesToHex(st.atr);
        cardInfo = parseAtr(st.atr);
      }
    } catch (_) {}

    updateState({
      status: 'card',
      readerName,
      cardUid: uid,
      cardAtr: atr,
      cardInfo,
      error: null,
      apiRequest: null,
      apiResponse: null,
    });
    console.log('[bg] Card UID:', uid);
    addLog('info', 'Card detected — UID: ' + (uid || '(none)'), { atr, ...(cardInfo || {}) });

    // Call the configured endpoint
    if (uid) {
      await callEndpoint(uid);
    }
  } catch (e) {
    updateState({ status: 'error', error: 'Failed to read card: ' + e.message });
  }

  try {
    await client.disconnect(card.handle);
  } catch (_) {}
}

// --- Event-driven mode (SCardGetStatusChange) ---

async function runEventLoop() {
  while (running) {
    let readers;
    try {
      readers = await client.listReaders();
    } catch (e) {
      updateState({ status: 'error', readerName: null, error: 'Lost connection: ' + e.message });
      break;
    }

    if (!readers || readers.length === 0) {
      updateState({ status: 'ready', readerName: null, cardUid: null, cardAtr: null, error: null });
      // Wait a bit then retry — no readers to watch
      await sleep(3000);
      continue;
    }

    const readerName = readers[0];
    updateState({ readerName });

    // Build initial reader state
    let readerStates = [{
      reader_name: readerName,
      current_state: SCARD_STATE_UNAWARE,
    }];

    // Inner loop: watch this reader for state changes
    while (running) {
      let updated;
      try {
        updated = await client.getStatusChange(STATUS_CHANGE_TIMEOUT, readerStates);
      } catch (e) {
        if (e instanceof PcscError) {
          if (e.code === SCARD_E_TIMEOUT) {
            // Timeout — just loop and call again
            continue;
          }
          if (e.code === SCARD_E_CANCELLED) {
            // Cancelled — we're restarting
            break;
          }
        }
        // Real error
        updateState({ status: 'error', error: 'Status change error: ' + e.message });
        break;
      }

      if (!updated || updated.length === 0) continue;

      const rs = updated[0];
      const eventState = rs.event_state;

      if (eventState & SCARD_STATE_PRESENT) {
        // Card is present
        if (currentState.status !== 'card') {
          await readCard(readerName);
        }
      } else {
        // Card removed
        if (currentState.status === 'card') {
          updateState({ status: 'ready', cardUid: null, cardAtr: null, error: null });
          console.log('[bg] Card removed');
          addLog('info', 'Card removed');
        }
      }

      // Update current_state for next call (clear CHANGED bit)
      readerStates = [{
        reader_name: readerName,
        current_state: eventState & ~SCARD_STATE_CHANGED,
      }];
    }
  }
}

// --- Poll mode (SCardStatus) ---

async function runPollLoop() {
  let activeCard = null; // { handle, protocol }

  while (running) {
    try {
      // If holding a card, check it's still there
      if (activeCard) {
        try {
          await client.status(activeCard.handle);
          // Still present — sleep and continue
          await sleep(POLL_INTERVAL_MS);
          continue;
        } catch (e) {
          // Card removed
          try { await client.disconnect(activeCard.handle); } catch (_) {}
          activeCard = null;
          updateState({ status: 'ready', cardUid: null, cardAtr: null, error: null });
          console.log('[bg] Card removed (poll mode)');
          addLog('info', 'Card removed (poll mode)');
          continue;
        }
      }

      // No active card — look for readers and cards
      let readers;
      try {
        readers = await client.listReaders();
      } catch (e) {
        updateState({ status: 'error', readerName: null, error: 'Lost connection: ' + e.message });
        break;
      }

      if (!readers || readers.length === 0) {
        updateState({ status: 'ready', readerName: null, cardUid: null, cardAtr: null, error: null });
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const readerName = readers[0];
      updateState({ readerName });

      let card;
      try {
        card = await client.connectCard(readerName);
      } catch (e) {
        // If the client lost its connection/context, break so we can recover
        if (!client.isConnected()) {
          updateState({ status: 'error', readerName: null, error: 'Lost connection: ' + e.message });
          break;
        }
        // Otherwise it's a normal "no card present" condition
        if (currentState.status !== 'ready') {
          updateState({ status: 'ready', cardUid: null, cardAtr: null, error: null });
        }
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      // Card found — read UID, ATR and card info
      let uid = null;
      let atr = null;
      let cardInfo = null;
      try {
        uid = await client.readCardUid(card.handle, card.protocol);
      } catch (_) {}
      try {
        const st = await client.status(card.handle);
        if (st.atr && st.atr.length > 0) {
          atr = bytesToHex(st.atr);
          cardInfo = parseAtr(st.atr);
        }
      } catch (_) {}

      updateState({ status: 'card', cardUid: uid, cardAtr: atr, cardInfo, error: null });
      console.log('[bg] Card UID (poll mode):', uid);
      addLog('info', 'Card detected (poll) — UID: ' + (uid || '(none)'), { atr, ...(cardInfo || {}) });
      activeCard = { handle: card.handle, protocol: card.protocol };

      // Call the configured endpoint
      if (uid) {
        await callEndpoint(uid);
      }

    } catch (e) {
      updateState({ status: 'error', error: e.message });
      break;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

// --- Lifecycle ---

async function start() {
  running = true;
  await loadSettings();
  updateState({ status: 'connecting', error: null });

  client = new PcscClient();
  try {
    await client.connect();
    await client.establishContext();
  } catch (e) {
    updateState({ status: 'error', error: 'Failed to connect to Smart Card Connector: ' + e.message });
    addLog('error', 'Failed to connect to Smart Card Connector', e.message);
    running = false;
    client = null;
    return;
  }

  updateState({ status: 'ready', error: null });
  console.log('[bg] Connected. Mode:', settings.detectionMode);
  addLog('info', 'Connected to Smart Card Connector', { mode: settings.detectionMode });

  if (settings.detectionMode === 'event') {
    await runEventLoop();
  } else {
    await runPollLoop();
  }

  // If we reach here the loop exited — either intentionally via restart()
  // (which sets running=false) or unexpectedly due to a connection error.
  // In the latter case, schedule auto-recovery so the keepalive can restart.
  if (running) {
    console.log('[bg] Monitoring loop exited unexpectedly, scheduling recovery');
    addLog('warn', 'Connection lost, recovering in 2s…');
    running = false;
    if (client) { client.dispose(); client = null; }
    await sleep(2000);
    start();
  }
}

async function restart() {
  running = false;
  if (client) {
    try { await client.cancel(); } catch (_) {}
    client.dispose();
    client = null;
  }
  // Small delay to let pending calls settle
  await sleep(500);
  start();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Keep service worker alive with periodic alarm
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    const needsRestart = !running || !client || !client.isConnected();
    if (needsRestart) {
      console.log('[bg] Keepalive: not healthy, restarting...');
      addLog('warn', 'Keepalive detected stale connection, restarting');
      restart();
    }
  }
});

// Start on install and on service worker startup
chrome.runtime.onInstalled.addListener(() => start());
chrome.runtime.onStartup.addListener(() => start());

// Also start immediately (covers service worker restart)
start();
