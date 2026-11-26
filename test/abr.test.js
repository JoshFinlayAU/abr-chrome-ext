import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AbrError,
  classifyQuery,
  formatAbn,
  formatAcn,
  isValidAbn,
  isValidAcn,
  lookupAbn,
  lookupAcn,
  parseJsonp,
  searchNames,
} from '../src/abr.js';

const GUID = '00000000-0000-0000-0000-000000000000';

function fakeFetch(body, { status = 200, capture } = {}) {
  return async (url) => {
    if (capture) capture.push(url);
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
}

test('ABN checksum', () => {
  assert.equal(isValidAbn('51824753556'), true);  // ATO
  assert.equal(isValidAbn('53004085616'), true);  // BP
  assert.equal(isValidAbn('51824753557'), false);
  assert.equal(isValidAbn('1234'), false);
});

test('ACN checksum', () => {
  assert.equal(isValidAcn('004085616'), true);
  assert.equal(isValidAcn('008105682'), true);
  assert.equal(isValidAcn('004085617'), false);
});

test('formatting', () => {
  assert.equal(formatAbn('51824753556'), '51 824 753 556');
  assert.equal(formatAcn('004085616'), '004 085 616');
  assert.equal(formatAbn(''), '');
});

test('classifyQuery detects ABN, ACN and names', () => {
  assert.deepEqual(classifyQuery('51 824 753 556'), { type: 'abn', value: '51824753556' });
  assert.deepEqual(classifyQuery('ABN: 51-824-753-556'), { type: 'abn', value: '51824753556' });
  assert.deepEqual(classifyQuery('004 085 616'), { type: 'acn', value: '004085616' });
  assert.deepEqual(classifyQuery('acn 004085616'), { type: 'acn', value: '004085616' });
  assert.deepEqual(classifyQuery('  Telstra  '), { type: 'name', value: 'Telstra' });
  assert.deepEqual(classifyQuery('7-Eleven'), { type: 'name', value: '7-Eleven' });
  assert.deepEqual(classifyQuery('1300'), { type: 'name', value: '1300' });
  assert.equal(classifyQuery('').type, 'empty');
  assert.equal(classifyQuery('51824753557').type, 'invalid');
  assert.equal(classifyQuery('004085617').type, 'invalid');
  assert.equal(classifyQuery('1234567890').type, 'invalid');
  assert.equal(classifyQuery('ABN 1234').type, 'invalid');
});

test('parseJsonp unwraps callback', () => {
  assert.deepEqual(parseJsonp('callback({"a":1})'), { a: 1 });
  assert.deepEqual(parseJsonp('x({"a":[1,2]});\n'), { a: [1, 2] });
  assert.deepEqual(parseJsonp('{"a":1}'), { a: 1 });
  assert.throws(() => parseJsonp('<html>'), AbrError);
});

const ABN_BODY = 'callback({"Abn":"53004085616","AbnStatus":"Active","AbnStatusEffectiveFrom":"1999-11-01","Acn":"004085616","AddressDate":"2017-05-02","AddressPostcode":"3008","AddressState":"VIC","BusinessName":["BP CARLINGFORD","BP DUBBO"],"EntityName":"BP AUSTRALIA PTY LTD","EntityTypeCode":"PRV","EntityTypeName":"Australian Private Company","Gst":"2000-07-01","Message":""})';

test('lookupAbn builds URL and normalises', async () => {
  const urls = [];
  const d = await lookupAbn('53004085616', GUID, { fetchImpl: fakeFetch(ABN_BODY, { capture: urls }) });
  const url = new URL(urls[0]);
  assert.equal(url.pathname, '/json/AbnDetails.aspx');
  assert.equal(url.searchParams.get('abn'), '53004085616');
  assert.equal(url.searchParams.get('guid'), GUID);
  assert.equal(d.entityName, 'BP AUSTRALIA PTY LTD');
  assert.equal(d.acn, '004085616');
  assert.equal(d.gstFrom, '2000-07-01');
  assert.deepEqual(d.businessNames, ['BP CARLINGFORD', 'BP DUBBO']);
});

test('lookupAcn uses AcnDetails endpoint', async () => {
  const urls = [];
  const d = await lookupAcn('004085616', GUID, { fetchImpl: fakeFetch(ABN_BODY, { capture: urls }) });
  assert.match(urls[0], /AcnDetails\.aspx\?acn=004085616/);
  assert.equal(d.abn, '53004085616');
});

test('API Message becomes AbrError', async () => {
  const body = 'callback({"Abn":"","Message":"The GUID entered is not recognised as a Registered Party"})';
  await assert.rejects(lookupAbn('51824753556', GUID, { fetchImpl: fakeFetch(body) }),
    { name: 'AbrError', message: /not recognised/ });
});

test('empty ABN record is reported as not found', async () => {
  const body = 'callback({"Abn":"","Message":""})';
  await assert.rejects(lookupAbn('51824753556', GUID, { fetchImpl: fakeFetch(body) }), /No record found/);
});

test('HTTP and network errors', async () => {
  await assert.rejects(lookupAbn('51824753556', GUID, { fetchImpl: fakeFetch('', { status: 500 }) }), /HTTP 500/);
  await assert.rejects(lookupAbn('51824753556', GUID, { fetchImpl: async () => { throw new TypeError('fail'); } }), /Could not reach/);
});

test('missing GUID', async () => {
  await assert.rejects(lookupAbn('51824753556', '', { fetchImpl: fakeFetch(ABN_BODY) }), /No ABR GUID/);
});

test('timeout', async () => {
  const hang = (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(lookupAbn('51824753556', GUID, { fetchImpl: hang, timeoutMs: 10 }), /too long/);
});

test('searchNames normalises and maps status codes', async () => {
  const body = 'callback({"Message":"","Names":[{"Abn":"59662704544","AbnStatus":"0000000001","IsCurrent":true,"Name":"Smith and Co Plumbing","NameType":"Business Name","Postcode":"5244","Score":100,"State":"SA"},{"Abn":"61008105682","AbnStatus":"0000000002","IsCurrent":true,"Name":"Smith Plumbing","NameType":"Entity Name","Postcode":"5070","Score":94,"State":"SA"}]})';
  const urls = [];
  const names = await searchNames('smith plumbing', GUID, 10, { fetchImpl: fakeFetch(body, { capture: urls }) });
  const url = new URL(urls[0]);
  assert.equal(url.searchParams.get('name'), 'smith plumbing');
  assert.equal(url.searchParams.get('maxResults'), '10');
  assert.equal(names.length, 2);
  assert.equal(names[0].status, 'Active');
  assert.equal(names[1].status, 'Cancelled');
  assert.equal(names[1].score, 94);
});

// Live tests against the real ABR. Run with: ABR_GUID=... npm test
const LIVE_GUID = process.env.ABR_GUID;
test('live: ABN, ACN and name search', { skip: !LIVE_GUID && 'set ABR_GUID to run' }, async () => {
  const ato = await lookupAbn('51824753556', LIVE_GUID);
  assert.equal(ato.entityName, 'AUSTRALIAN TAXATION OFFICE');
  const bp = await lookupAcn('004085616', LIVE_GUID);
  assert.equal(bp.abn, '53004085616');
  const names = await searchNames('telstra', LIVE_GUID, 5);
  assert.ok(names.length > 0);
  assert.match(names[0].abn, /^\d{11}$/);
});
