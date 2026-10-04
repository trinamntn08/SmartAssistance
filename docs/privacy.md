# Privacy and retention

## What leaves the browser

Capture reads only explicitly selected visible page text for translation, or the
complete focused eligible editor for writing, after a user invocation.
Writing-field capture does not submit a request. First use requires acceptance of the disclosure;
Generate then sends the captured text, writing mode, applicable improvement
style, and target language to the configured SmartAssistance API and OpenAI.
Reading translation processes the captured selection entirely in the extension
panel using Chrome's local LanguageDetector and Translator models. It makes no
SmartAssistance or cloud translation request and has no paid fallback. Chrome may
download language models after an explicit in-panel setup click; the selected
text is not included in a cloud translation request. Choosing
**Translate with SmartAssistance** translates locally after local acknowledgement
and any required setup, using the saved language or Vietnamese by default.
Opening selected text with the toolbar also translates immediately. Changing
the translation language requests a new translation of that same selection.
Before local acknowledgement, the panel waits. Local acknowledgement is separate
from cloud-writing consent and does not grant permission to send writing text.
While the panel is visible and consented, it checks for settled page selections
on the explicitly invoked active tab every 700ms. A new passage is captured and
translated automatically. Repeated text is ignored; mouse dragging and rapid
selection changes wait until the selection is finished and stable. Writing fields
are excluded from active reading. Hiding or closing the panel ends the reading
connection and stops polling; the owning reader disconnect also cancels its pending
translation. Navigation or switching away from the source tab clears reading
scope and requires a new invocation.
No
surrounding page, thread, URL,
cookies, browsing history, or model API key is sent from the extension.

Replacement always requires a separate user action. Local Cancel stops waiting
and discards obsolete results; Chrome may continue an already started model
download. Cloud writing Cancel cannot retract data already sent.

## What SmartAssistance retains

The panel displays only the already captured original selection and its current
translation. Pronunciation is explicitly triggered by either area's sound icon;
it reads that area's selection or its whole passage when nothing is selected.
Chrome's built-in language detector processes the full captured original locally
when its sound icon is used. No source-language service/API request is added.
Only compatible browser
voices marked `localService: true` receive text. The extension never selects a
remote/default fallback voice and makes no additional speech API request. Missing
local voices produce an explanatory message. Playback uses temporary in-memory
text, is capped at 60 seconds, and stops on panel hide/close, capture expiry/change,
translation language/result changes, or consent withdrawal. No microphone access,
audio files, pronunciation history, or source-language preference is stored.
Device speech services provide the voices; availability and quality vary.

- Chrome session storage contains one current draft and its interaction metadata.
  Previews live in panel memory; the content script temporarily retains an undo
  value and original editor nodes. None is written to local or synced storage.
- A capture expires ten minutes after capture. Recapture, navigation, source-tab
  closure, and Clear text and consent invalidate and clear it. Chrome may defer
  alarms or timers while suspended; expiry checks prevent reuse, and cleanup runs
  when the extension resumes execution. Closing a panel alone does not end the
  shared interaction in other panels.
- Cloud-writing consent is versioned and scoped to the API endpoint. Local reading
  has a separate versioned acknowledgement. Both preferences are stored locally;
  Clear text and consent removes both and invalidates the capture. Chrome manages
  installed models independently; clearing extension consent does not delete them.
- The preferred translation language is stored locally without selected text or
  translations. Clear text and consent retains this non-content preference.
- The API has no draft database/cache/history and does not log draft or rewrite
  bodies. Logs contain operational metadata only. SDK logging is disabled.
- Normal tests use synthetic text and a local fake provider. The separate live
  evaluation command requires explicit enablement and sends only its synthetic
  corpus, with aggregate and case-ID metadata reports that omit generated text.

Password inputs, payment autocomplete fields, one-time codes, hidden/inert,
disabled, and read-only editors are excluded. This is not a general detector for
every kind of sensitive text: users choose whether an otherwise eligible draft
may be sent. Site-specific widgets outside the supported editor scope are not
covered by these guarantees.

## External provider retention

`store: false` disables normal response storage for this request, but it does not
establish zero retention across all provider systems. OpenAI documents separate
abuse-monitoring retention, endpoint state, model-specific caching, and enhanced
account controls. See the [official data controls](https://developers.openai.com/api/docs/guides/your-data).

Before hosted use, the operator must select and disclose the applicable model,
provider-account retention controls, residency configuration, and operational
log retention. The local code does not establish enhanced retention eligibility.
Proxies, hosting logs, and error collectors must not record request/response bodies.

## Release prerequisites

The existing service token is a temporary server access gate. A hosted multi-user
release still needs application authentication, shared per-user quota accounting,
and verified provider settings. The synthetic evaluation set also needs measured
model results and human quality review against the product brief's thresholds.
