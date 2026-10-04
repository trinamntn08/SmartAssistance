import { afterEach, describe, expect, it, vi } from "vitest";
import { createPronunciation, localVoice, type PlaybackState } from "./pronunciation.js";

function voice(lang: string, localService = true): SpeechSynthesisVoice {
  return { lang, localService } as SpeechSynthesisVoice;
}
function setup(voices = [voice("fr-FR")]) {
  const synthesis = { getVoices: vi.fn(() => voices), speak: vi.fn(), cancel: vi.fn() };
  const states: PlaybackState[] = [];
  const player = createPronunciation(
    { synthesis, createUtterance: (text) => ({ text }) as SpeechSynthesisUtterance },
    (state) => states.push(state),
  );
  return { synthesis, states, player };
}
afterEach(() => vi.useRealTimers());

describe("local pronunciation", () => {
  it("prefers an exact local language and never selects remote voices", () => {
    const remote = voice("fr", false);
    const regional = voice("fr-CA");
    const exact = voice("fr");
    expect(localVoice([remote, regional, exact], "fr")).toBe(exact);
    expect(localVoice([remote, regional], "fr")).toBe(regional);
    expect(localVoice([remote, voice("en-US")], "fr")).toBeUndefined();
    expect(localVoice([voice("zh-TW")], "zh-CN")).toBeUndefined();
    expect(localVoice([voice("zh-CN")], "zh")?.lang).toBe("zh-CN");
  });
  it("assigns the local voice and cancels the previous word before another plays", () => {
    const { player, synthesis, states } = setup();
    player.speak("Bonjour", "fr");
    const first = synthesis.speak.mock.calls[0]?.[0] as SpeechSynthesisUtterance;
    const delayedEnd = first.onend;
    expect(first.voice?.localService).toBe(true);
    expect(first.lang).toBe("fr-FR");
    player.speak("monde", "fr");
    expect(synthesis.cancel).toHaveBeenCalledOnce();
    expect(first.text).toBe("");
    delayedEnd?.call(first, {} as SpeechSynthesisEvent);
    expect(states.at(-1)?.speaking).toBe(true);
    player.stop();
  });
  it("fails closed when voices have not loaded or only remote voices exist", () => {
    for (const voices of [[], [voice("fr-FR", false)]]) {
      const { player, synthesis, states } = setup(voices);
      player.speak("Bonjour", "fr");
      expect(synthesis.speak).not.toHaveBeenCalled();
      expect(states.at(-1)?.message).toContain("No local voice");
      // Retrying discovers voices loaded after the first click.
      synthesis.getVoices.mockReturnValue([voice("fr-FR")]);
      player.speak("Bonjour", "fr");
      expect(synthesis.speak).toHaveBeenCalledOnce();
      player.stop();
    }
  });
  it("reports unavailable browser speech without throwing", () => {
    const onState = vi.fn();
    createPronunciation(undefined, onState).speak("Bonjour", "fr");
    expect(onState.mock.lastCall?.[0].message).toContain("unavailable");
  });
  it("clears text and playback state after completion or error", () => {
    const { player, synthesis, states } = setup();
    player.speak("Bonjour", "fr");
    const first = synthesis.speak.mock.calls[0]?.[0] as SpeechSynthesisUtterance;
    first.onend?.call(first, {} as SpeechSynthesisEvent);
    expect(first.text).toBe("");
    expect(states.at(-1)?.speaking).toBe(false);
    player.speak("Bonjour", "fr");
    const second = synthesis.speak.mock.calls[1]?.[0] as SpeechSynthesisUtterance;
    second.onerror?.call(second, {} as SpeechSynthesisErrorEvent);
    expect(states.at(-1)?.message).toContain("Could not play");
    expect(second.text).toBe("");
  });
  it("bounds playback and safely handles platform exceptions", () => {
    vi.useFakeTimers();
    const { player, synthesis, states } = setup();
    player.speak("Bonjour", "fr");
    vi.advanceTimersByTime(60_000);
    expect(synthesis.cancel).toHaveBeenCalledOnce();
    expect(states.at(-1)?.speaking).toBe(false);
    synthesis.speak.mockImplementation(() => {
      throw new Error("Synthetic failure");
    });
    player.speak("Bonjour", "fr");
    expect(states.at(-1)?.message).toContain("Could not play");
  });
  it("does not submit empty or oversized text for speech", () => {
    const { player, synthesis, states } = setup();
    player.speak(" ", "fr");
    player.speak("x".repeat(10_001), "fr");
    expect(synthesis.speak).not.toHaveBeenCalled();
    expect(states.at(-1)?.message).toContain("Select a shorter passage");
  });
});
