# ADR-0012: Guide installation of missing device voices

- Status: Accepted
- Date: 2026-10-03
- Refines: ADR-0010

## Context and decision

The user wants to discover and install missing pronunciation voices from the
extension. Chrome exposes available voices but has no OS voice-installation API.
Keep pronunciation local and offer installation guidance only after a missing
voice is reported. Pass the missing language tag as structured playback state;
show its display name without storing the selected text or the voice inventory.

On Windows offer the fixed `ms-settings:speech` link, manual navigation fallback,
and Manage voices / Add voices instructions. Windows owns language selection,
download and confirmation. macOS and ChromeOS get official installation guides;
Linux users get distribution-specific speech-engine guidance. No system commands,
native companion, additional permissions, dependencies, or remote speech fallback.
Every sound click queries available voices again. Installing an OS voice does not
guarantee Chrome exposes it; a browser restart may be needed. External settings
launch and actual installation require manual verification on the user's device.

Sources: [Windows settings URI reference](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings)
and [Microsoft voice installation instructions](https://support.microsoft.com/en-us/accessibility/windows/narrator/appendix-a-supported-languages-and-voices).
