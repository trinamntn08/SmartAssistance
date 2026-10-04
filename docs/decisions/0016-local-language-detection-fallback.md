# ADR-0016: Reliable local language detection fallback for reading

- Status: Accepted
- Date: 2026-10-04
- Refines: ADR-0013

## Context

The user reports uncertain-language errors for a French MSN headline and a long
French paragraph, after successful capture. An isolated Edge extension's existing
chrome.i18n.detectLanguage identifies both exact passages as reliable French with
100 percent confidence. The primary LanguageDetector output on the user's device
is unavailable to this investigation; short text alone does not explain the error.

## Decision

Retain the primary model detector and confidence rules. If its returned result
is uncertain, consult the browser extension's local i18n detector once, when
available. Require isReliable=true, validated language tags and percentages,
at least 80 percent for the winner, and a 20-point margin over the next candidate.
Reject und, malformed, unreliable, and ambiguous results. Do not infer language
from the page URL, locale, or surrounding content.

Limit the fallback wait to two seconds and honor cancellation/attempt identity.
Fallback absence, failure, or uncertainty preserves the original uncertainty
error. It does not bypass model setup, unavailable translation APIs, unsupported
pairs, consent, capture expiry, or source/target validation. Only source detection
falls back; translation remains device-local with no API/cloud fallback, logging,
new permissions, or dependencies. Pronunciation already uses this extension API.

## Validation and limits

Unit cases cover confident-primary bypass, reliable recovery, unreliable/ambiguous
results, invalid percentages, unknown language, timeout, and cancellation. Browser
fixtures use real extension detection on synthetic French prose with an uncertain
fake model detector and verify no cloud requests. Real translation-model quality
and the user's native retest remain separate gates.

Reference: [Extension language detection](https://developer.chrome.com/docs/extensions/reference/api/i18n#method-detectLanguage).
