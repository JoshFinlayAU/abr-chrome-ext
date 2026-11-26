# ABR Lookup – Chrome extension

A small Chrome extension (Manifest V3) for looking up the Australian Business Register (ABR):

- **Business/company name → ABN/ACN**: a ranked list of matching entity, business and trading names. Click one to see its details.
- **ABN → details**: entity name, ACN, ABN status, entity type, GST registration, state/postcode and registered business names.
- **ACN → details**: the same details, found by ACN.

A single search box works out what you typed. 11 digits is an ABN, 9 digits is an ACN, anything else is a name search. Spaces, dashes and `ABN`/`ACN` prefixes are ignored, so text pasted from invoices works. ABNs and ACNs are checksum-validated before any request is sent.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. The settings page opens from the popup (**Settings**). Paste your ABR authentication GUID and click **Save & test**.

You need a free GUID from the ABR. [Register here](https://abr.business.gov.au/Tools/WebServicesAgreement).

## How it works

The extension calls the ABR **JSON** web services (`https://abr.business.gov.au/json/`):

| Lookup | Endpoint |
|---|---|
| ABN | `AbnDetails.aspx?abn=…&guid=…` |
| ACN | `AcnDetails.aspx?acn=…&guid=…` |
| Name | `MatchingNames.aspx?name=…&maxResults=…&guid=…` |

Responses come back wrapped as JSONP (`callback({...})`). `src/abr.js` strips the wrapper and normalises the fields. The extension's host permission for `abr.business.gov.au/json/*` lets the popup call the API directly, without being blocked by CORS. The GUID is kept in `chrome.storage.sync` and is sent only to the ABR.

In name-search results, the ABR's `AbnStatus` codes `0000000001` and `0000000002` are shown as **Active** and **Cancelled**.

## Layout

```
manifest.json
src/abr.js          API client, input classification, ABN/ACN checksums
src/settings.js     chrome.storage settings helpers
src/popup.*         toolbar popup
src/options.*       settings page (GUID, max results)
icons/              icon.svg source + rendered PNGs
test/abr.test.js    unit tests (node:test)
```

## Development

```sh
npm test                      # unit tests (no network)
ABR_GUID=<your-guid> npm test # also runs live tests against the ABR
npm run package               # builds dist/abr-lookup.zip for the Chrome Web Store
```

There are no dependencies and no build step. To regenerate the icons: `for s in 16 32 48 128; do rsvg-convert -w $s -h $s icons/icon.svg -o icons/icon-$s.png; done`
