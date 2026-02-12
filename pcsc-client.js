/**
 * Minimal PC/SC client for communicating with Google's Smart Card Connector
 * extension on ChromeOS via cross-extension messaging.
 *
 * Protocol: JSON messages over chrome.runtime.connect port.
 * See: https://github.com/GoogleChromeLabs/chromeos_smart_card_connector
 */

const SMART_CARD_CONNECTOR_EXT_ID = 'khpfeaanjngmcnplbdlpegiifgpfgdco';

// PC/SC-Lite constants
const SCARD_SCOPE_SYSTEM = 2;
const SCARD_SHARE_SHARED = 2;
const SCARD_PROTOCOL_T0 = 1;
const SCARD_PROTOCOL_T1 = 2;
const SCARD_PROTOCOL_ANY = SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1;
const SCARD_PCI_T0 = { protocol: SCARD_PROTOCOL_T0 };
const SCARD_PCI_T1 = { protocol: SCARD_PROTOCOL_T1 };
const SCARD_S_SUCCESS = 0;
const SCARD_LEAVE_CARD = 0;

// SCardGetStatusChange state flags
const SCARD_STATE_UNAWARE = 0x0000;
const SCARD_STATE_IGNORE = 0x0001;
const SCARD_STATE_CHANGED = 0x0002;
const SCARD_STATE_UNKNOWN = 0x0004;
const SCARD_STATE_UNAVAILABLE = 0x0008;
const SCARD_STATE_EMPTY = 0x0010;
const SCARD_STATE_PRESENT = 0x0020;
const SCARD_STATE_MUTE = 0x0200;

const SCARD_INFINITE = 0xFFFFFFFF;

// Error codes
const SCARD_E_TIMEOUT = 0x8010000A;
const SCARD_E_CANCELLED = 0x80100002;

// GET DATA pseudo-APDU to read card UID
const GET_UID_APDU = [0xFF, 0xCA, 0x00, 0x00, 0x00];

class PcscClient {
  constructor() {
    this._port = null;
    this._requestId = 0;
    this._pending = new Map(); // request_id -> { resolve, reject }
    this._context = null;
    this._disposed = false;
  }

  /**
   * Open a long-lived port to the Smart Card Connector extension.
   */
  connect() {
    return new Promise((resolve, reject) => {
      try {
        this._port = chrome.runtime.connect(SMART_CARD_CONNECTOR_EXT_ID);
      } catch (e) {
        reject(new Error(
          'Failed to connect to Smart Card Connector. Is it installed? ' + e.message
        ));
        return;
      }

      this._port.onMessage.addListener((msg) => this._onMessage(msg));

      this._port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError;
        this._disposed = true;
        // Reject all pending requests
        for (const [, pending] of this._pending) {
          pending.reject(new Error('Port disconnected'));
        }
        this._pending.clear();
        this._port = null;
        this._context = null;
      });

      // Give the port a moment to establish, then resolve.
      // The Smart Card Connector doesn't send an explicit "ready" message;
      // we verify connectivity via SCardEstablishContext.
      setTimeout(() => resolve(), 100);
    });
  }

  /**
   * Send a PC/SC function call and return a promise for the result.
   */
  _call(functionName, args) {
    if (this._disposed || !this._port) {
      return Promise.reject(new Error('Not connected to Smart Card Connector'));
    }

    const requestId = ++this._requestId;

    return new Promise((resolve, reject) => {
      this._pending.set(requestId, { resolve, reject });

      this._port.postMessage({
        type: 'pcsc_lite_function_call::request',
        data: {
          request_id: requestId,
          payload: {
            function_name: functionName,
            arguments: args
          }
        }
      });
    });
  }

  /**
   * Handle incoming messages from the Smart Card Connector.
   */
  _onMessage(msg) {
    if (msg.type === 'pcsc_lite_function_call::response') {
      const { request_id, payload, error } = msg.data;
      const pending = this._pending.get(request_id);
      if (!pending) return;
      this._pending.delete(request_id);

      if (error !== undefined) {
        pending.reject(new Error('PC/SC error: ' + error));
      } else {
        // payload is an array: [error_code, ...results]
        const errorCode = payload[0];
        if (errorCode !== SCARD_S_SUCCESS) {
          pending.reject(new PcscError(errorCode));
        } else {
          pending.resolve(payload.slice(1));
        }
      }
    }
  }

  /**
   * SCardEstablishContext — create a resource manager context.
   * Returns the context handle.
   */
  async establishContext() {
    const result = await this._call('SCardEstablishContext', [
      SCARD_SCOPE_SYSTEM, null, null
    ]);
    this._context = result[0];
    return this._context;
  }

  /**
   * SCardListReaders — return an array of reader names.
   */
  async listReaders() {
    if (this._context === null) throw new Error('No context established');
    const result = await this._call('SCardListReaders', [this._context, null]);
    return result[0]; // array of reader name strings
  }

  /**
   * SCardConnect — connect to a card in the given reader.
   * Returns { handle, protocol }.
   */
  async connectCard(readerName) {
    if (this._context === null) throw new Error('No context established');
    const result = await this._call('SCardConnect', [
      this._context,
      readerName,
      SCARD_SHARE_SHARED,
      SCARD_PROTOCOL_ANY
    ]);
    return { handle: result[0], protocol: result[1] };
  }

  /**
   * SCardTransmit — send an APDU to the card and return the response bytes.
   */
  async transmit(cardHandle, protocol, apdu) {
    const pci = (protocol === SCARD_PROTOCOL_T0) ? SCARD_PCI_T0 : SCARD_PCI_T1;
    const result = await this._call('SCardTransmit', [cardHandle, pci, apdu, null]);
    // result[0] = ioRecvPci, result[1] = response bytes
    return result[1];
  }

  /**
   * SCardStatus — get card status including ATR.
   * Returns { readerName, state, protocol, atr }.
   */
  async status(cardHandle) {
    const result = await this._call('SCardStatus', [cardHandle]);
    return {
      readerName: result[0],
      state: result[1],
      protocol: result[2],
      atr: result[3]
    };
  }

  /**
   * SCardDisconnect — disconnect from the card.
   */
  async disconnect(cardHandle) {
    return this._call('SCardDisconnect', [cardHandle, SCARD_LEAVE_CARD]);
  }

  /**
   * SCardGetStatusChange — block until card state changes or timeout.
   * readerStates is an array of { reader_name, current_state }.
   * Returns updated reader states with event_state bitmask.
   */
  async getStatusChange(timeout, readerStates) {
    if (this._context === null) throw new Error('No context established');
    const result = await this._call('SCardGetStatusChange', [
      this._context, timeout, readerStates
    ]);
    return result[0]; // array of updated reader state objects
  }

  /**
   * SCardCancel — cancel a pending SCardGetStatusChange call.
   */
  async cancel() {
    if (this._context === null) return;
    return this._call('SCardCancel', [this._context]);
  }

  /**
   * SCardReleaseContext — release the resource manager context.
   */
  async releaseContext() {
    if (this._context === null) return;
    await this._call('SCardReleaseContext', [this._context]);
    this._context = null;
  }

  /**
   * Read the UID from a card using the GET DATA pseudo-APDU.
   * Returns the UID as a hex string, or null on failure.
   */
  async readCardUid(cardHandle, protocol) {
    const response = await this.transmit(cardHandle, protocol, GET_UID_APDU);
    if (response.length < 2) return null;

    const sw1 = response[response.length - 2];
    const sw2 = response[response.length - 1];

    if (sw1 === 0x90 && sw2 === 0x00) {
      const uidBytes = response.slice(0, -2);
      return bytesToHex(uidBytes);
    }
    return null;
  }

  /**
   * Tear down the connection.
   */
  dispose() {
    this._disposed = true;
    if (this._port) {
      this._port.disconnect();
      this._port = null;
    }
    this._context = null;
    for (const [, pending] of this._pending) {
      pending.reject(new Error('Client disposed'));
    }
    this._pending.clear();
  }
}

/**
 * PC/SC error with a numeric error code.
 */
class PcscError extends Error {
  constructor(code) {
    super(`PC/SC error: 0x${(code >>> 0).toString(16).toUpperCase()}`);
    this.code = code;
  }
}

/**
 * Convert a byte array to a colon-separated hex string.
 */
function bytesToHex(bytes) {
  return bytes
    .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(':');
}
