/**
 * Options page logic. Loads/saves settings to chrome.storage.local.
 */

const els = {
  modeEvent: document.getElementById('modeEvent'),
  modePoll: document.getElementById('modePoll'),
  endpointUrl: document.getElementById('endpointUrl'),
  venueId: document.getElementById('venueId'),
  saveBtn: document.getElementById('saveBtn'),
  savedMsg: document.getElementById('savedMsg'),
};

async function load() {
  const stored = await chrome.storage.local.get(['detectionMode', 'endpointUrl', 'venueId']);

  if (stored.detectionMode === 'poll') {
    els.modePoll.checked = true;
  } else {
    els.modeEvent.checked = true;
  }

  els.endpointUrl.value = stored.endpointUrl || '';
  els.venueId.value = stored.venueId || '';
}

async function save() {
  const detectionMode = els.modePoll.checked ? 'poll' : 'event';
  const endpointUrl = els.endpointUrl.value.trim();
  const venueId = els.venueId.value.trim();

  await chrome.storage.local.set({ detectionMode, endpointUrl, venueId });

  els.savedMsg.classList.add('visible');
  setTimeout(() => els.savedMsg.classList.remove('visible'), 2000);
}

els.saveBtn.addEventListener('click', save);
document.addEventListener('DOMContentLoaded', load);
