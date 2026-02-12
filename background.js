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
  error: null,
};

let settings = {
  detectionMode: 'event',  // 'event' or 'poll'
  endpointUrl: '',
  venueId: '',
};

const POLL_INTERVAL_MS = 1500;
const STATUS_CHANGE_TIMEOUT = 60000; // 60s per SCardGetStatusChange call, then re-call

// --- Settings ---

async function loadSettings() {
  const stored = await chrome.storage.local.get(['detectionMode', 'endpointUrl', 'venueId']);
  settings.detectionMode = stored.detectionMode || 'event';
  settings.endpointUrl = stored.endpointUrl || '';
  settings.venueId = stored.venueId || '';
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

// Popup requests current state
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getState') {
    sendResponse({ state: currentState, settings });
    return false;
  }
});

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
    try {
      const st = await client.status(card.handle);
      if (st.atr && st.atr.length > 0) {
        atr = bytesToHex(st.atr);
      }
    } catch (_) {}

    updateState({
      status: 'card',
      readerName,
      cardUid: uid,
      cardAtr: atr,
      error: null,
    });
    console.log('[bg] Card UID:', uid);
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
        // No card — normal
        if (currentState.status !== 'ready') {
          updateState({ status: 'ready', cardUid: null, cardAtr: null, error: null });
        }
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      // Card found — read UID and ATR
      let uid = null;
      let atr = null;
      try {
        uid = await client.readCardUid(card.handle, card.protocol);
      } catch (_) {}
      try {
        const st = await client.status(card.handle);
        if (st.atr && st.atr.length > 0) atr = bytesToHex(st.atr);
      } catch (_) {}

      updateState({ status: 'card', cardUid: uid, cardAtr: atr, error: null });
      console.log('[bg] Card UID (poll mode):', uid);
      activeCard = { handle: card.handle, protocol: card.protocol };

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
    return;
  }

  updateState({ status: 'ready', error: null });
  console.log('[bg] Connected. Mode:', settings.detectionMode);

  if (settings.detectionMode === 'event') {
    await runEventLoop();
  } else {
    await runPollLoop();
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
    if (!running || !client) {
      console.log('[bg] Keepalive: restarting...');
      start();
    }
  }
});

// Start on install and on service worker startup
chrome.runtime.onInstalled.addListener(() => start());
chrome.runtime.onStartup.addListener(() => start());

// Also start immediately (covers service worker restart)
start();
