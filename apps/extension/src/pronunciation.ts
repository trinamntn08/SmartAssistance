export interface SpeechPlatform {
  synthesis: Pick<SpeechSynthesis, "getVoices" | "speak" | "cancel">;
  createUtterance: (text: string) => SpeechSynthesisUtterance;
}

export interface PlaybackState {
  speaking: boolean;
  message: string;
  missingLanguage?: string;
}

/** Only explicitly selected local voices may receive text. Never use the default voice. */
export function localVoice(
  voices: readonly SpeechSynthesisVoice[],
  language: string,
): SpeechSynthesisVoice | undefined {
  const tag = language.toLowerCase();
  const local = voices.filter((voice) => voice.localService);
  const exact = local.find((voice) => voice.lang.toLowerCase() === tag);
  if (exact) return exact;
  const base = tag.split("-")[0];
  // Do not substitute a different Chinese regional/script voice.
  return local.find((voice) => {
    const candidate = voice.lang.toLowerCase();
    return (
      candidate === base || ((base !== "zh" || tag === base) && candidate.split("-")[0] === base)
    );
  });
}

export function createPronunciation(
  platform: SpeechPlatform | undefined,
  onState: (state: PlaybackState) => void,
) {
  let current: SpeechSynthesisUtterance | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function stop(): void {
    clearTimeout(timer);
    timer = undefined;
    if (current) {
      const previous = current;
      current = undefined;
      previous.onend = null;
      previous.onerror = null;
      try {
        platform?.synthesis.cancel();
      } catch {
        /* Playback still becomes inactive. */
      }
      previous.text = "";
    }
    onState({ speaking: false, message: "" });
  }
  function speak(text: string, language: string): void {
    stop();
    if (!platform) {
      onState({ speaking: false, message: "Pronunciation is unavailable in this browser." });
      return;
    }
    if (!text.trim()) return;
    if (text.length > 10_000) {
      onState({ speaking: false, message: "Select a shorter passage to hear its pronunciation." });
      return;
    }
    try {
      const voice = localVoice(platform.synthesis.getVoices(), language);
      if (!voice) {
        onState({
          speaking: false,
          missingLanguage: language,
          message:
            "No local voice is available for this language. Install a voice in your device’s speech settings, then try again.",
        });
        return;
      }
      const utterance = platform.createUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      current = utterance;
      const finish = (message: string) => {
        if (current !== utterance) return;
        stop();
        onState({ speaking: false, message });
      };
      utterance.onend = () => finish("");
      utterance.onerror = () => finish("Could not play pronunciation. Please try again.");
      timer = setTimeout(() => finish("Playback stopped. Click to listen again."), 60_000);
      onState({ speaking: true, message: "Playing pronunciation." });
      platform.synthesis.speak(utterance);
    } catch {
      stop();
      onState({ speaking: false, message: "Could not play pronunciation. Please try again." });
    }
  }
  return { speak, stop };
}
