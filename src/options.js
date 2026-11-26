import { lookupAbn } from './abr.js';
import { GUID_PATTERN, loadSettings, saveSettings } from './settings.js';

// Australian Taxation Office: a stable ABN used to check that the GUID works.
const TEST_ABN = '51824753556';

const form = document.getElementById('options-form');
const guidInput = document.getElementById('guid');
const maxSelect = document.getElementById('max-results');
const saveBtn = document.getElementById('save');
const status = document.getElementById('status');

function setStatus(text, kind = '') {
  status.textContent = text;
  status.className = kind;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const guid = guidInput.value.trim();
  const maxResults = Number(maxSelect.value);

  if (!GUID_PATTERN.test(guid)) {
    setStatus('That doesn’t look like a GUID (expected xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).', 'error');
    guidInput.focus();
    return;
  }

  saveBtn.disabled = true;
  setStatus('Testing GUID with the ABR…');
  try {
    await lookupAbn(TEST_ABN, guid);
    await saveSettings({ guid, maxResults });
    setStatus('Saved. The GUID works.', 'ok');
  } catch (err) {
    setStatus(`Not saved: ${err.message}`, 'error');
  } finally {
    saveBtn.disabled = false;
  }
});

(async function init() {
  const settings = await loadSettings();
  guidInput.value = settings.guid;
  maxSelect.value = String(settings.maxResults);
  if (!maxSelect.value) maxSelect.value = '20';
})();
