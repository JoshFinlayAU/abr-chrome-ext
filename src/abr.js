// ABR (Australian Business Register) client.
//
// Uses the ABR "JSON" web services, which return JSONP-wrapped JSON:
//   AbnDetails.aspx?abn=...     -> entity details by ABN
//   AcnDetails.aspx?acn=...     -> entity details by ACN
//   MatchingNames.aspx?name=... -> ranked list of matching names
// Every call needs an authentication GUID issued by the ABR.

export const API_BASE = 'https://abr.business.gov.au/json/';
export const ABR_WEB_BASE = 'https://abr.business.gov.au/ABN/View?abn=';
const TIMEOUT_MS = 15000;

// Status codes returned by MatchingNames (AbnDetails returns the words).
const NAME_STATUS = { '0000000001': 'Active', '0000000002': 'Cancelled' };

export class AbrError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AbrError';
  }
}

// ---------- Validation & formatting ----------

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
const ACN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 1];

export function isValidAbn(abn) {
  if (!/^\d{11}$/.test(abn)) return false;
  const digits = [...abn].map(Number);
  digits[0] -= 1;
  const sum = digits.reduce((acc, d, i) => acc + d * ABN_WEIGHTS[i], 0);
  return sum % 89 === 0;
}

export function isValidAcn(acn) {
  if (!/^\d{9}$/.test(acn)) return false;
  const digits = [...acn].map(Number);
  const sum = ACN_WEIGHTS.reduce((acc, w, i) => acc + w * digits[i], 0);
  return (10 - (sum % 10)) % 10 === digits[8];
}

export function formatAbn(abn) {
  return /^\d{11}$/.test(abn || '') ? abn.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4') : abn || '';
}

export function formatAcn(acn) {
  return /^\d{9}$/.test(acn || '') ? acn.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3') : acn || '';
}

/**
 * Work out what the user typed.
 * Returns { type: 'abn' | 'acn' | 'name', value } or { type: 'invalid' | 'empty', error }.
 * Accepts pasted forms like "ABN 51 824 753 556", "ACN: 004-085-616".
 */
export function classifyQuery(input) {
  const text = (input || '').trim();
  if (!text) return { type: 'empty', error: 'Enter a business name, ABN or ACN.' };

  const prefix = text.match(/^(ABN|ACN|ARBN)\b[\s:#.]*/i);
  const rest = prefix ? text.slice(prefix[0].length) : text;
  const compact = rest.replace(/[\s.\-]/g, '');

  if (/^\d+$/.test(compact)) {
    if (compact.length === 11) {
      return isValidAbn(compact)
        ? { type: 'abn', value: compact }
        : { type: 'invalid', error: `${formatAbn(compact)} is not a valid ABN (checksum failed).` };
    }
    if (compact.length === 9) {
      return isValidAcn(compact)
        ? { type: 'acn', value: compact }
        : { type: 'invalid', error: `${formatAcn(compact)} is not a valid ACN (checksum failed).` };
    }
    // A short number with no ABN/ACN prefix may legitimately be part of a name.
    if (!prefix && compact.length < 9) return { type: 'name', value: text };
    return { type: 'invalid', error: 'An ABN has 11 digits and an ACN has 9 digits.' };
  }

  return { type: 'name', value: text };
}

// ---------- Response parsing ----------

/** Strip the JSONP wrapper, e.g. `callback({...})`, and parse the JSON inside. */
export function parseJsonp(text) {
  const match = /^\s*[\w$.]+\s*\(([\s\S]*)\)\s*;?\s*$/.exec(text);
  try {
    return JSON.parse(match ? match[1] : text);
  } catch {
    throw new AbrError('Unexpected response from the ABR.');
  }
}

export function normaliseDetails(raw) {
  return {
    abn: raw.Abn || '',
    acn: raw.Acn || '',
    entityName: raw.EntityName || '',
    status: raw.AbnStatus || '',
    statusFrom: raw.AbnStatusEffectiveFrom || '',
    entityType: raw.EntityTypeName || '',
    entityTypeCode: raw.EntityTypeCode || '',
    gstFrom: raw.Gst || '',
    state: raw.AddressState || '',
    postcode: raw.AddressPostcode || '',
    businessNames: Array.isArray(raw.BusinessName) ? raw.BusinessName : [],
  };
}

export function normaliseName(raw) {
  return {
    abn: raw.Abn || '',
    name: raw.Name || '',
    nameType: raw.NameType || '',
    state: raw.State || '',
    postcode: raw.Postcode || '',
    score: typeof raw.Score === 'number' ? raw.Score : null,
    isCurrent: raw.IsCurrent !== false,
    status: NAME_STATUS[raw.AbnStatus] || raw.AbnStatus || '',
  };
}

// ---------- API calls ----------

async function call(endpoint, params, { fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (!params.guid) throw new AbrError('No ABR GUID set. Add one on the options page.');
  const url = new URL(endpoint, API_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url.toString(), { signal: controller.signal });
  } catch (err) {
    throw new AbrError(err?.name === 'AbortError' ? 'The ABR took too long to respond.' : 'Could not reach the ABR. Check your connection.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new AbrError(`The ABR returned an error (HTTP ${res.status}).`);

  const data = parseJsonp(await res.text());
  if (data.Message) throw new AbrError(data.Message);
  return data;
}

/** Look up an entity by ABN. Returns normalised details. */
export async function lookupAbn(abn, guid, opts) {
  const data = await call('AbnDetails.aspx', { abn, guid }, opts);
  if (!data.Abn) throw new AbrError(`No record found for ABN ${formatAbn(abn)}.`);
  return normaliseDetails(data);
}

/** Look up an entity by ACN. Returns normalised details. */
export async function lookupAcn(acn, guid, opts) {
  const data = await call('AcnDetails.aspx', { acn, guid }, opts);
  if (!data.Abn) throw new AbrError(`No ABN found for ACN ${formatAcn(acn)}.`);
  return normaliseDetails(data);
}

/** Search names. Returns an array of normalised matches, best first. */
export async function searchNames(name, guid, maxResults = 20, opts) {
  const data = await call('MatchingNames.aspx', { name, maxResults: String(maxResults), guid }, opts);
  return (data.Names || []).map(normaliseName);
}
