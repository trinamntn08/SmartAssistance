# Chrome local translation implementation

Updated: 2026-10-04
Status: local adapter and integrated reading workflow implemented and tested.
Real-model release verification remains pending.

## Current implementation

Reading translation uses Chrome's Translator and LanguageDetector APIs in the
side panel through `apps/extension/src/local-translation.ts`. The service worker
owns capture scope, separate local acknowledgement, expiry, and attempt identity.
Results remain in panel memory. Reading makes no API request and has no cloud
fallback. Grammar correction and writing improvement use the server provider.

The panel supports automatic initial translation, target-language changes, and
settled selections while visible. Setup requiring a document gesture uses
**Enable local translation**; failures offer explicit retry or setup guidance.
Detection, translation, and setup waits are bounded. Superseded results are
discarded, and model objects are destroyed on panel teardown.

[ADR-0013](decisions/0013-chrome-local-reading-translation.md) records the provider,
consent, deadlines, language handling, and feasibility evidence. The initial probe
exposed APIs and downloadable pairs but did not run a real translation. Automated
tests inject fake models and verify lifecycle and local/cloud separation; they do
not establish native model quality or device performance.

## Remaining release work

Follow [local translation verification](local-translation-verification.md) for:

- Native Chrome side-panel setup, model downloads, reopening, and offline reuse.
- Device and language-pair compatibility, including English/French to Vietnamese.
- Bilingual review using the versioned 50-case synthetic corpus.
- Protected-fact preservation and acceptance thresholds from the product brief.
- First-use and warmed latency measurements, with browser and device details.

Record actual results and outstanding blockers in [implementation status](status.md).
The completed implementation checklist has been replaced by this summary; its
original sequence remains available in Git history.
