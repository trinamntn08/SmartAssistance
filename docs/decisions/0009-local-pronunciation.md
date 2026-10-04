# ADR-0009: User-triggered pronunciation with local browser voices

- Status: Superseded by [ADR-0010](0010-selection-sound-controls.md)
- Date: 2026-10-03
- Refines: ADR-0005 translation panel interaction

## Context

SmartAssistance is expanding its product direction toward people living, working,
or studying in another language. Reading translation should help users hear how
words are pronounced without leaving the browser. The requested first feature is
simple: click a word to hear it, with no recording or pronunciation scoring.

## Decision

Render translated text as text nodes and accessible word buttons in the extension
panel. Use locale-aware word segmentation, preserve whitespace and punctuation,
and provide keyboard activation. Clicking a word speaks it in the translation's
target language. Highlight the active word and provide Stop playback. A new click
cancels the previous utterance; there is no autoplay or playback queue.

Use browser speech synthesis through a small extension-local adapter. Select only
voices with `localService: true` and a compatible language. Always assign the
selected voice explicitly; never fall back to the browser default or a remote
voice. If no suitable local voice exists, explain that a device voice is needed.
Retrying checks the available voices again because loading can be asynchronous.
Voice availability and pronunciation quality depend on the browser and device.

Provide an explicit action to listen to the original selection without displaying
the source text. Require the user to choose its language: the current rewrite
provider does not return detected source language. This control does not submit a
new translation or infer language using an external service.

Stop and release playback when the panel hides or closes, consent is withdrawn,
the capture changes or expires, or the translation language/result changes. Bound
individual playback to 60 seconds and speech input to 10,000 characters. Ignore
callbacks from superseded utterances and release their text references.

No new production dependencies, Chrome permissions, speech API endpoints, audio
storage, microphone access, or server changes are required. Pronunciation sends
no additional text to SmartAssistance or the model provider. Existing translation
consent, capture expiry, and retention rules continue to apply.

## Validation and consequences

Test local-only voice selection, missing voices/browser support, late voice
availability, language matching, multilingual segmentation, cancellation, stale
callbacks, playback errors, bounded execution, and panel lifecycle behavior.
Browser workflow tests use synthetic text and a fake speech implementation; they
cannot establish audible output or installed voice quality. Manually verify real
Chrome playback, keyboard use, scrolling, and supported languages before release.

This is pronunciation playback rather than pronunciation assessment. Speech
recognition, audio recording, accent scoring, remote voices, and word interactions
on arbitrary webpages remain outside this feature.
