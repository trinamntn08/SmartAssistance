# Privacy and retention

## What leaves the browser

Capture reads only the complete focused eligible editor after a user invocation.
It does not submit a request. First use requires acceptance of the disclosure;
Generate then sends the captured text, operation, tone, and target language to the
configured SmartAssistance API and OpenAI. No surrounding page, thread, URL,
cookies, browsing history, or model API key is sent from the extension.

Replacement always requires a separate user action. Cancel stops waiting and
aborts the provider request where possible; it cannot retract data already sent.

## What SmartAssistance retains

- Chrome session storage contains one current draft and its interaction metadata.
  Previews live in panel memory; the content script temporarily retains an undo
  value and original editor nodes. None is written to local or synced storage.
- A capture expires ten minutes after capture. Recapture, navigation, source-tab
  closure, and Clear text and consent invalidate and clear it. Chrome may defer
  alarms or timers while suspended; expiry checks prevent reuse, and cleanup runs
  when the extension resumes execution. Closing a panel alone does not end the
  shared interaction in other panels.
- The versioned consent preference is stored locally, scoped to the configured
  API endpoint. Clear text and consent removes it and invalidates the capture.
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
