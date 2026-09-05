# Project brief

Status: Accepted for MVP

Implementation status (2026-09-05): the local MVP is implemented; public-release
requirements remain open. This brief describes the target product, not a claim
that every requirement has shipped. See [current status](../status.md) for
implemented capabilities, verification evidence, and outstanding work.

## Product vision

- One-sentence vision: Help people turn rough text into clear, natural writing
  without leaving the browser field where they are working.
- Problem being solved: Writing and translating comments or emails currently
  requires copying sensitive text into another application, editing the result,
  and copying it back.
- Why this problem matters now: Multilingual communication is common, and users
  expect writing assistance to be fast, contextual, and under their control.

## Users and jobs

- Primary user: A multilingual knowledge worker or online contributor writing
  emails, comments, and short messages in Chrome.
- User's current workflow: Draft text, copy it into a separate AI or translation
  product, describe the desired rewrite, and paste the result back.
- Most important job to be done: Improve or translate the complete draft in its
  original editor while preserving meaning and important details.
- Accessibility and locale needs: Full keyboard operation, visible focus states,
  screen-reader labels, right-to-left text support, and a localized interface.

## Outcomes

- Primary success metric: At least 60% of generated rewrites are applied without
  a retry during the private beta.
- Guardrail metrics: p95 rewrite latency below five seconds for 2,000 characters,
  fewer than 2% technical failures, zero confirmed unintended overwrites, and no
  draft text persisted by SmartAssistance.
- What evidence would invalidate the idea: Fewer than 30% of rewrites are applied
  after 100 active beta users, or users consistently reject the permission and
  privacy model required for the feature.

## Initial scope

### In scope

- Chrome Manifest V3 extension invoked through its toolbar action, a context menu,
  or a keyboard shortcut.
- Complete-field capture for plain inputs, textareas, and basic contenteditable
  editors.
- Rephrase, grammar correction, concise, and translate operations.
- Natural, formal, and casual tones.
- Automatic source-language detection and explicit target-language selection.
- Preview, replace, copy, retry, and one-level undo.
- Thin SmartAssistance API that validates requests and calls the OpenAI Responses
  API using a server-side credential.
- Local development without user accounts; production authentication is required
  before public release.

### Out of scope

- Automatic background monitoring of every editable field.
- Reading email threads or surrounding page content.
- Persistent draft or rewrite history.
- Rich-text formatting preservation beyond plain paragraphs.
- Google Docs, canvas editors, cross-origin frames, and site-specific editor
  integrations.
- Mobile browsers, Firefox, Safari, and Edge packaging.
- Organization administration, shared style guides, and billing.

## Functional requirements

1. The user can invoke SmartAssistance while an eligible editable field is
   focused.
2. The extension captures the complete current field and indicates when applying
   the result may remove rich formatting.
3. The user can select an operation, tone, and output language.
4. The backend returns only a rewritten text value and operational metadata.
5. The extension previews the result before replacement.
6. Replacement occurs only if the editor still contains the captured version.
7. If the draft changed while generation was running, the extension refuses to
   overwrite it and keeps the rewrite available to copy.
8. The user can restore the previous value immediately after replacement.
9. Password, payment, hidden, disabled, and read-only fields are never captured.

## Non-functional requirements

- Availability and latency targets: 99.5% monthly API availability after public
  beta and p95 below five seconds for drafts up to 2,000 characters.
- Expected usage and scale: Private beta up to 1,000 users and 50 rewrites per
  active user per day; architecture must allow stateless horizontal API scaling.
- Supported clients and environments: Current stable Chrome on desktop, with
  Windows, macOS, and Linux development support.
- Data residency, retention, and deletion: Do not persist draft or rewritten text
  in the SmartAssistance database, cache, analytics, or application logs. Send
  only the active field to the configured model provider. Document provider
  retention separately and request `store: false` where supported.
- Authentication and authorization: Production users authenticate with a
  SmartAssistance account through a browser OAuth flow. The extension receives a
  short-lived application token. It never reads ChatGPT cookies or holds an
  OpenAI API key.
- Accessibility target: WCAG 2.2 AA for extension-owned interfaces.
- Budget or cost constraints: Model, token limits, and per-user quotas are
  configurable. Usage metadata is measured without recording user text.

## AI behavior

- Why AI is needed for this workflow: Rephrasing must preserve intent, tone,
  nuance, and multilingual meaning rather than perform literal substitution.
- Inputs and allowed data classes: User-invoked plain text from the active editor,
  the requested transformation, tone, source-language mode, and target language.
  Surrounding page content is excluded.
- Required outputs and structured contracts: One non-empty rewritten text value,
  detected language when available, and a request identifier. No commentary,
  markup, or executable instructions.
- Actions or tools the model may invoke: None.
- Actions that require human confirmation: Replacing editor content. Sending the
  draft is also preceded by first-use disclosure and consent.
- Failure and fallback behavior: Preserve the original editor, show a concise
  retryable error, and allow copying any successfully generated preview.
- Quality evaluation set and acceptance threshold: Versioned examples covering
  supported languages, tones, names, numbers, links, mentions, emojis, mixed
  languages, instruction-like input, and long drafts. A release must preserve all
  protected facts in at least 99% of deterministic checks and meet an 85% human
  preference threshold on the curated rewrite set.
- Safety, privacy, latency, and per-task cost limits: No model tools, maximum
  10,000 input characters, bounded output tokens, a 15-second provider timeout,
  no automatic retries after a user cancellation, and configurable user quotas.

## Delivery

- First milestone and acceptance criteria: A locally loadable extension can
  capture, rewrite, preview, safely replace, and undo text in the three supported
  editor types through a locally running API. Contract, domain, and editor-safety
  tests pass in CI.
- Deployment target: Chrome Web Store package plus a container-compatible Node.js
  API. The MVP uses no database.
- Owners and stakeholders: Repository owner; beta users provide product and
  language-quality feedback.
- Open questions: Production identity provider, pricing and quota policy, first
  site-specific rich editor, supported UI locales, and eligibility requirements
  for enhanced data-retention controls.
