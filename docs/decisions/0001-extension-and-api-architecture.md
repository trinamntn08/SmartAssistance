# ADR-0001: Manifest V3 extension with a server-side model gateway

- Status: Accepted
- Date: 2026-09-05
- Owners: Repository owner

## Context

SmartAssistance must read user-invoked text from arbitrary web editors, rephrase
or translate it, and safely replace the original. Editor text may contain private
communications. An OpenAI API key cannot be shipped in browser code, and a
general browser extension must not depend on ChatGPT website cookies or DOM
automation.

The first slice needs quick feedback while preserving a boundary that can later
support authentication, quotas, billing, provider changes, and data controls.

## Decision drivers

- Keep model credentials and policy enforcement outside the browser.
- Request the least Chrome access that supports the user-facing workflow.
- Share contracts without coupling domain behavior to Chrome or OpenAI.
- Provide a fast local-development path and a stateless deployment path.
- Prevent stale model responses from overwriting newer user edits.
- Keep production dependencies and operational components small.

## Options considered

### Direct OpenAI calls from the extension

This is the smallest topology but exposes or stores an API key in a client
environment. It also makes central quotas, abuse protection, prompt rollout, and
cost controls difficult. Rejected.

### Automate the ChatGPT website

This attempts to reuse a browser login by reading cookies or driving the ChatGPT
DOM. It is brittle, grants excessive access, and relies on an undocumented
integration boundary. Rejected.

### Extension plus a SmartAssistance API

The extension sends only the active draft and explicit rewrite settings to a
small backend. The backend validates the request and calls a model provider using
a server-held credential. Accepted.

### Local native companion application

This can keep a user-owned API key outside the extension and provide strong local
control, but installation, updates, signing, and cross-platform support make it
too expensive for the first slice. Deferred as a possible bring-your-own-key
mode.

## Decision

Use an npm workspace monorepo with:

- a TypeScript Chrome Manifest V3 extension;
- a provider-neutral rewrite domain service;
- a stateless Node.js 24 API;
- an OpenAI Responses API adapter on the server;
- shared TypeScript request and response contracts;
- esbuild, Biome, TypeScript, and Vitest quality tooling.

The MVP is invoked by an explicit toolbar, context-menu, or keyboard action and
uses `activeTab` rather than persistent access to all websites. It captures the
whole editable field, previews results, and checks a snapshot ID and content hash
before applying plain text.

## Consequences

- Positive: No OpenAI credential is shipped to Chrome; prompts, quotas, provider
  selection, and safety rules remain centrally controlled.
- Positive: The extension can be tested against a fake provider, and another
  provider can be introduced behind the existing domain interface.
- Positive: Temporary tab access matches the privacy-first product promise.
- Negative: Operating the API adds deployment, authentication, availability, and
  cost responsibility.
- Negative: The first contenteditable adapter replaces rich content as plain
  text; site-specific formatting support requires later adapters.
- Risk: Sensitive text crosses two external boundaries. Mitigate with explicit
  consent, TLS, no application persistence, redacted logs, `store: false`, narrow
  provider configuration, and accurate retention disclosure.
- Risk: Model latency allows the draft to change. Mitigate by refusing replacement
  when the current content hash differs from the captured snapshot.
- Follow-up: Select a production identity provider and quota store before public
  release.
- Follow-up: Add site-specific integration and formatting ADRs when evidence from
  beta usage identifies the highest-value editors.

## Validation

Validate the decision with a locally loadable vertical slice, contract and domain
tests, manual tests across the supported editor types, provider latency and cost
measurements, and a private-beta rewrite evaluation set. Revisit the topology if
latency, operating cost, or user trust prevents the success metrics in the project
brief.
