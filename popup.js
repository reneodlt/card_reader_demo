/**
 * Popup logic for the Smart Card Reader extension.
 * Connects to Smart Card Connector, discovers readers, polls for cards,
 * and displays the card UID.
 */

const POLL_INTERVAL_MS = 1000;

const ui = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  readerName: document.getElementById('readerName'),
  cardUid: document.getElementById('cardUid'),
  cardAtr: document.getElementById('cardAtr'),
  errorMsg: document.getElementById('errorMsg'),
};

let client = null;
let pollTimer = null;
let lastUid = null;

// --- UI helpers ---

function setStatus(state, text) {
  ui.statusDot.className = 'status-dot ' + state;
  ui.statusText.textContent = text;
}

function setReader(name) {
  ui.readerName.textContent = name || '';
  if (!name) ui.readerName.innerHTML = '<span class="empty">No reader detected</span>';
}

function setUid(uid) {
  if (uid) {
    ui.cardUid.textContent = uid;
  } else {
    ui.cardUid.innerHTML = '<span class="empty">No card</span>';
  }
}

function setAtr(atr) {
  if (atr) {
    ui.cardAtr.textContent = atr;
  } else {
    ui.cardAtr.innerHTML = '<span class="empty">—</span>';
  }
}

function showError(msg) {
  ui.errorMsg.textContent = msg;
}

function clearError() {
  ui.errorMsg.textContent = '';
}

// --- Main logic ---

async function init() {
  client = new PcscClient();
  setStatus('connecting', 'Connecting to Smart Card Connector...');

  try {
    await client.connect();
    await client.establishContext();
    setStatus('ready', 'Connected — waiting for reader...');
    clearError();
    startPolling();
  } catch (e) {
    setStatus('error', 'Connection failed');
    showError(e.message);
  }
}

function startPolling() {
  if (pollTimer) return;
  poll(); // immediate first poll
  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function poll() {
  if (!client) return;

  try {
    // List available readers
    const readers = await client.listReaders();

    if (!readers || readers.length === 0) {
      setStatus('ready', 'No readers found');
      setReader(null);
      setUid(null);
      setAtr(null);
      lastUid = null;
      return;
    }

    const readerName = readers[0];
    setReader(readerName);

    // Try to connect to a card in the first reader
    let card;
    try {
      card = await client.connectCard(readerName);
    } catch (e) {
      // No card present — this is normal
      setStatus('ready', 'Waiting for card...');
      setUid(null);
      setAtr(null);
      lastUid = null;
      clearError();
      return;
    }

    // Card is present — read UID
    setStatus('card', 'Card detected');
    clearError();

    try {
      const uid = await client.readCardUid(card.handle, card.protocol);
      setUid(uid);
      lastUid = uid;
    } catch (e) {
      setUid(null);
      showError('Failed to read UID: ' + e.message);
    }

    // Read ATR via SCardStatus
    try {
      const st = await client.status(card.handle);
      if (st.atr && st.atr.length > 0) {
        setAtr(bytesToHex(st.atr));
      } else {
        setAtr(null);
      }
    } catch (e) {
      setAtr(null);
    }

    // Disconnect from the card so the next poll can reconnect
    try {
      await client.disconnect(card.handle);
    } catch (e) {
      // ignore disconnect errors
    }

  } catch (e) {
    // Context-level error (connector disconnected, etc.)
    setStatus('error', 'Error');
    showError(e.message);
    stopPolling();
  }
}

// --- Lifecycle ---

window.addEventListener('load', init);

window.addEventListener('unload', () => {
  stopPolling();
  if (client) {
    client.dispose();
    client = null;
  }
});
