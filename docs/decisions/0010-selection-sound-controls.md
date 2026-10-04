# ADR-0010: Select text and use a sound icon

- Status: Accepted
- Date: 2026-10-03
- Supersedes: ADR-0009
- Refines: ADR-0005 panel presentation

## Context

The user found the clickable-word interface and original-language controls too
complicated. They requested a sound icon and visible original text so they can
select the text they want to hear. This explicitly changes the earlier
translation-only presentation requirement.

## Decision

Show Original and Translation as separate read-only text areas in the reading
panel. Each heading has one accessible sound icon. Clicking the icon speaks the
selected substring in that text area, or its whole passage if nothing is selected.
Selection remains available after focusing the sound button, including keyboard
activation. During preparation/playback the same icon becomes Stop; clicking it
cancels. Using the other icon replaces the previous playback. There are no
clickable words, word-navigation controls, separate Stop button, language picker
for pronunciation, or expandable pronunciation settings.

Use the selected target language for translation speech. For original speech,
call Chrome's `i18n.detectLanguage` on the full captured passage, locally, with a
two-second deadline. Choose the highest-percentage non-unknown language accounting
for at least half the passage. This is best-effort dominant-language detection;
short or mixed-language passages can be ambiguous. If detection fails or reports
no usable language, show a concise error instead of choosing a default voice.
See [Chrome's language-detection API](https://developer.chrome.com/docs/extensions/reference/api/i18n#method-detectLanguage).

Retain ADR-0009's local-only speech boundary: explicitly assign a compatible voice
with `localService: true`, with no remote/default fallback. No extra provider/API
call, permission, production dependency, microphone access, audio file, or history
is added. Display only the already captured original and current translation.
No surrounding page content is captured.

Stop speech and invalidate pending language detection when the panel hides/closes,
the capture changes/expires, translation language/result changes, consent is
withdrawn, or another sound action is requested. Match asynchronous detection to
its action revision and captured snapshot before speaking. Retain the 60-second
utterance limit, 10,000-character speech-input limit, temporary in-memory text,
playback-error handling, and rejection of superseded speech callbacks.

The two text areas share available sidebar height and scroll internally. Writing
mode keeps its existing original/preview, editing, Copy, Replace, and Undo flow;
sound icons are initially limited to reading translation.

## Validation and consequences

Test selected/full passage playback on both icons, automatic source-language
selection, Stop toggling, switching icons, keyboard activation, unknown/delayed
language detection, deadlines, consent/expiry/lifecycle cancellation, and local-only
voice handling. Chromium workflows verify selection survives the icon click and
both text areas fit at normal and narrow sidebar sizes. Speech is faked in tests;
audible output, real local voices, and detection/pronunciation quality still need
manual Chrome verification.
