/**
 * Popup logic for the Smart Card Reader extension.
 * Connects to Smart Card Connector, discovers readers, polls for cards,
 * and displays the card UID.
 *
 * Strategy: connect to the card once, hold the handle, and use SCardStatus
 * to detect removal — avoids repeated connect/disconnect that causes the
 * reader LED to blink.
 */

const POLL_INTERVAL_MS = 1500;

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

// Current card session (null when no card is connected)
let activeCard = null; // { handle, protocol, uid, atr }

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
    // If we already have a card connected, just check it's still there
    if (activeCard) {
      try {
        await client.status(activeCard.handle);
        // Card still present — nothing to do
        return;
      } catch (e) {
        // Card removed or error — clean up
        try { await client.disconnect(activeCard.handle); } catch (_) {}
        activeCard = null;
        setStatus('ready', 'Waiting for card...');
        setUid(null);
        setAtr(null);
        clearError();
        return;
      }
    }

    // No active card — check for readers and try to connect
    const readers = await client.listReaders();

    if (!readers || readers.length === 0) {
      setStatus('ready', 'No readers found');
      setReader(null);
      setUid(null);
      setAtr(null);
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
      clearError();
      return;
    }

    // Card connected — read UID and ATR once, then hold the handle
    setStatus('card', 'Card detected');
    clearError();

    let uid = null;
    let atr = null;

    try {
      uid = await client.readCardUid(card.handle, card.protocol);
      setUid(uid);
    } catch (e) {
      setUid(null);
      showError('Failed to read UID: ' + e.message);
    }

    try {
      const st = await client.status(card.handle);
      if (st.atr && st.atr.length > 0) {
        atr = bytesToHex(st.atr);
        setAtr(atr);
      }
    } catch (e) {
      setAtr(null);
    }

    // Keep the handle open — we'll check status on subsequent polls
    activeCard = { handle: card.handle, protocol: card.protocol, uid, atr };

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
  if (activeCard) {
    try { client.disconnect(activeCard.handle); } catch (_) {}
    activeCard = null;
  }
  if (client) {
    client.dispose();
    client = null;
  }
});
