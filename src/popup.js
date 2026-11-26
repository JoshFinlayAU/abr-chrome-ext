import {
  ABR_WEB_BASE,
  classifyQuery,
  formatAbn,
  formatAcn,
  lookupAbn,
  lookupAcn,
  searchNames,
} from './abr.js';
import { loadSettings } from './settings.js';

const form = document.getElementById('search-form');
const input = document.getElementById('query');
const button = document.getElementById('search-btn');
const hint = document.getElementById('hint');
const content = document.getElementById('content');

let settings = { guid: '', maxResults: 20 };
let requestId = 0;          // ignore responses from superseded searches
let lastResults = null;     // { query, names } so "Back" can restore the list

// ---------- DOM helpers ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

function show(...nodes) {
  content.replaceChildren(...nodes);
  content.scrollTop = 0;
}

function showMessage(text, { error = false, action } = {}) {
  show(el('div', { class: `message${error ? ' error' : ''}` }, el('div', {}, text), action));
}

function showLoading(text) {
  show(el('div', { class: 'message' }, el('div', { class: 'spinner' }), text));
}

function setBusy(busy) {
  button.disabled = busy;
}

function openOptions(e) {
  e?.preventDefault();
  chrome.runtime.openOptionsPage();
}

function copyButton(value, label = 'Copy') {
  const btn = el('button', { class: 'copy', type: 'button', title: `Copy ${value}` }, label);
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value);
      btn.textContent = 'Copied';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = label; btn.classList.remove('copied'); }, 1200);
    } catch {
      btn.textContent = 'Failed';
    }
  });
  return btn;
}

function statusBadge(status) {
  const cls = /^active$/i.test(status) ? 'active' : /^cancel/i.test(status) ? 'cancelled' : '';
  return el('span', { class: `badge ${cls}` }, status || 'Unknown');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------- Hint while typing ----------

function updateHint() {
  const q = classifyQuery(input.value);
  hint.classList.toggle('error', q.type === 'invalid');
  if (q.type === 'abn') hint.textContent = `Look up ABN ${formatAbn(q.value)}`;
  else if (q.type === 'acn') hint.textContent = `Look up ACN ${formatAcn(q.value)}`;
  else if (q.type === 'name') hint.textContent = `Search names matching “${q.value}”`;
  else if (q.type === 'invalid') hint.textContent = q.error;
  else hint.textContent = 'Enter a business name, ABN (11 digits) or ACN (9 digits).';
}

// ---------- Rendering ----------

function renderResults(query, names) {
  lastResults = { query, names };
  if (!names.length) {
    showMessage(`No names match “${query}”.`);
    return;
  }
  const items = names.map((n) => {
    const cancelled = /^cancel/i.test(n.status) || !n.isCurrent;
    const btn = el('button', { class: `result${cancelled ? ' cancelled' : ''}`, type: 'button' },
      el('div', { class: 'name' }, n.name),
      el('div', { class: 'meta' },
        el('span', { class: 'abn' }, `ABN ${formatAbn(n.abn)}`),
        n.nameType && el('span', {}, n.nameType),
        (n.state || n.postcode) && el('span', {}, [n.state, n.postcode].filter(Boolean).join(' ')),
        n.status && statusBadge(n.status),
      ),
    );
    btn.addEventListener('click', () => runLookup({ type: 'abn', value: n.abn }, { fromResults: true, matched: n }));
    return el('li', {}, btn);
  });
  const count = names.length >= settings.maxResults
    ? `Top ${names.length} matches. Refine your search for more specific results.`
    : `${names.length} match${names.length === 1 ? '' : 'es'}`;
  show(el('div', { class: 'result-count' }, count), el('ul', { class: 'results' }, items));
}

function renderDetails(d, { fromResults = false, matched = null } = {}) {
  const rows = [];
  rows.push(['ABN', el('dd', {}, el('span', { class: 'num' }, formatAbn(d.abn)), copyButton(d.abn))]);
  if (d.acn) rows.push(['ACN', el('dd', {}, el('span', { class: 'num' }, formatAcn(d.acn)), copyButton(d.acn))]);
  rows.push(['Status', el('dd', {}, statusBadge(d.status), d.statusFrom && `from ${formatDate(d.statusFrom)}`)]);
  rows.push(['GST', el('dd', {}, d.gstFrom ? `Registered from ${formatDate(d.gstFrom)}` : 'Not registered')]);
  if (d.state || d.postcode) rows.push(['Location', el('dd', {}, [d.state, d.postcode].filter(Boolean).join(' '))]);

  const dl = el('dl', {}, rows.flatMap(([label, dd]) => [el('dt', {}, label), dd]));

  let namesSection = null;
  if (d.businessNames.length) {
    const LIMIT = 8;
    const list = el('ul');
    const renderNames = (all) => list.replaceChildren(...(all ? d.businessNames : d.businessNames.slice(0, LIMIT)).map((n) => el('li', {}, n)));
    renderNames(false);
    const more = d.businessNames.length > LIMIT
      ? el('button', { type: 'button', onclick: (e) => { renderNames(true); e.currentTarget.remove(); } }, `Show all ${d.businessNames.length}`)
      : null;
    namesSection = el('div', { class: 'business-names' }, el('h3', {}, `Business names (${d.businessNames.length})`), list, more);
  }

  const back = fromResults && lastResults
    ? el('button', { class: 'back', type: 'button', onclick: () => renderResults(lastResults.query, lastResults.names) }, '← Back to results')
    : null;

  show(el('div', { class: 'details' },
    back,
    el('h2', {}, d.entityName || '(No entity name)', ' ', copyButton(d.entityName)),
    el('div', { class: 'entity-type' }, d.entityType),
    matched && matched.name.trim().toLowerCase() !== d.entityName.trim().toLowerCase()
      && el('div', { class: 'matched' }, `Matched ${(matched.nameType || 'name').toLowerCase()}: `, el('strong', {}, matched.name)),
    dl,
    namesSection,
    el('a', { class: 'abr-link', href: ABR_WEB_BASE + d.abn, target: '_blank', rel: 'noopener' }, 'View on ABN Lookup ↗'),
  ));
}

// ---------- Actions ----------

async function runLookup(q, { fromResults = false, matched = null } = {}) {
  if (!settings.guid) {
    showMessage('Add your ABR GUID to get started.', {
      action: el('div', {}, el('button', { type: 'button', class: 'copy', onclick: openOptions }, 'Open settings')),
    });
    return;
  }
  const id = ++requestId;
  setBusy(true);
  try {
    if (q.type === 'name') {
      showLoading('Searching…');
      const names = await searchNames(q.value, settings.guid, settings.maxResults);
      if (id === requestId) renderResults(q.value, names);
    } else {
      showLoading('Looking up…');
      const details = q.type === 'abn'
        ? await lookupAbn(q.value, settings.guid)
        : await lookupAcn(q.value, settings.guid);
      if (id === requestId) renderDetails(details, { fromResults, matched });
    }
  } catch (err) {
    if (id !== requestId) return;
    const back = fromResults && lastResults
      ? el('div', {}, el('button', { type: 'button', class: 'copy', onclick: () => renderResults(lastResults.query, lastResults.names) }, 'Back to results'))
      : undefined;
    showMessage(err.message || 'Something went wrong.', { error: true, action: back });
  } finally {
    if (id === requestId) setBusy(false);
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = classifyQuery(input.value);
  updateHint();
  if (q.type === 'empty' || q.type === 'invalid') {
    input.focus();
    return;
  }
  chrome.storage.session?.set({ lastQuery: input.value.trim() }).catch(() => {});
  lastResults = null;
  runLookup(q);
});

input.addEventListener('input', updateHint);
document.getElementById('open-options').addEventListener('click', openOptions);

// ---------- Init ----------

(async function init() {
  settings = await loadSettings();
  try {
    const { lastQuery } = (await chrome.storage.session?.get('lastQuery')) || {};
    if (lastQuery && !input.value) {
      input.value = lastQuery;
      input.select();
    }
  } catch { /* session storage unavailable */ }
  updateHint();
  if (!settings.guid) {
    showMessage('Add your ABR GUID to get started.', {
      action: el('div', {}, el('button', { type: 'button', class: 'copy', onclick: openOptions }, 'Open settings')),
    });
  }
})();
