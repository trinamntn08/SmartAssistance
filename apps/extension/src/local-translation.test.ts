import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserLocalTranslationPlatform,
  createLocalTranslation,
  type LocalTranslationPlatform,
} from "./local-translation.js";

function setup() {
  const detector = {
    detect: vi.fn(async () => [
      { detectedLanguage: "en", confidence: 0.95 },
      { detectedLanguage: "fr", confidence: 0.05 },
      { detectedLanguage: "und", confidence: 0 },
    ]),
    destroy: vi.fn(),
  };
  const translator = { translate: vi.fn(async () => "Xin chào"), destroy: vi.fn() };
  const platform = {
    languageDetector: {
      availability: vi.fn(async () => "available"),
      create: vi.fn(async () => detector),
    },
    translator: {
      availability: vi.fn(async () => "available"),
      create: vi.fn(async () => translator),
    },
    isUserActive: vi.fn(() => false),
  };
  const progress = vi.fn();
  const adapter = createLocalTranslation(platform, progress);
  const controller = new AbortController();
  return { detector, translator, platform, progress, adapter, controller };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("local translation adapter", () => {
  it("reuses one detector and translator, then releases both on disposal", async () => {
    const { adapter, platform, detector, translator, controller } = setup();
    expect(await adapter.translate("Hello", "vi", controller.signal)).toEqual({
      text: "Xin chào",
      sourceLanguage: "en",
    });
    await adapter.translate("A new passage", "vi", controller.signal);
    expect(platform.languageDetector.create).toHaveBeenCalledOnce();
    expect(platform.translator.create).toHaveBeenCalledOnce();
    await adapter.translate("Hello", "fr", controller.signal);
    expect(translator.destroy).toHaveBeenCalledOnce();
    expect(platform.translator.create).toHaveBeenCalledTimes(2);
    adapter.dispose();
    expect(detector.destroy).toHaveBeenCalledOnce();
    expect(translator.destroy).toHaveBeenCalledTimes(2);
    await expect(adapter.translate("Hello", "vi", controller.signal)).rejects.toMatchObject({
      code: "CANCELLED",
    });
  });
  it("returns original same-language text without creating a translator", async () => {
    const { adapter, platform, controller } = setup();
    expect(await adapter.translate("Hello\nworld", "en", controller.signal)).toEqual({
      text: "Hello\nworld",
      sourceLanguage: "en",
    });
    expect(platform.translator.availability).not.toHaveBeenCalled();
  });
  it("uses reliable local extension detection when the model is uncertain on a French headline", async () => {
    const { detector, platform, controller } = setup();
    detector.detect.mockResolvedValue([{ detectedLanguage: "fr", confidence: 0.6 }]);
    const fallback = vi.fn(async () => ({
      isReliable: true,
      languages: [{ language: "fr", percentage: 100 }],
    }));
    const adapter = createLocalTranslation({ ...platform, detectLocalLanguage: fallback });
    const text =
      'Didier Deschamps menacé par Pascal Olmeta avec une arme, Jean-Pierre Papin témoin de cette scène surréaliste : "Il est entré avec un pistolet"';
    expect((await adapter.translate(text, "vi", controller.signal)).sourceLanguage).toBe("fr");
    expect(fallback).toHaveBeenCalledExactlyOnceWith(text);
    expect(platform.translator.availability).toHaveBeenCalledWith({
      sourceLanguage: "fr",
      targetLanguage: "vi",
    });
  });
  it("does not consult a fallback for confident model detection", async () => {
    const { platform, controller } = setup();
    const fallback = vi.fn();
    await createLocalTranslation({ ...platform, detectLocalLanguage: fallback }).translate(
      "Hello",
      "vi",
      controller.signal,
    );
    expect(fallback).not.toHaveBeenCalled();
  });
  it.each([
    { isReliable: false, languages: [{ language: "fr", percentage: 100 }] },
    { isReliable: true, languages: [{ language: "fr", percentage: 60 }] },
    {
      isReliable: true,
      languages: [
        { language: "fr", percentage: 80 },
        { language: "en", percentage: 70 },
      ],
    },
    { isReliable: true, languages: [{ language: "und", percentage: 100 }] },
    { isReliable: true, languages: [{ language: "fr", percentage: 101 }] },
  ])("rejects unreliable or invalid fallback detection: %j", async (result) => {
    const { detector, platform, controller } = setup();
    detector.detect.mockResolvedValue([{ detectedLanguage: "fr", confidence: 0.6 }]);
    const adapter = createLocalTranslation({
      ...platform,
      detectLocalLanguage: async () => result,
    });
    await expect(
      adapter.translate("Synthetic title", "vi", controller.signal),
    ).rejects.toMatchObject({ code: "UNCERTAIN_LANGUAGE" });
    expect(platform.translator.create).not.toHaveBeenCalled();
  });
  it("bounds fallback detection and never starts translation after cancellation", async () => {
    vi.useFakeTimers();
    const { detector, platform, controller } = setup();
    detector.detect.mockResolvedValue([{ detectedLanguage: "fr", confidence: 0.6 }]);
    const fallback = vi.fn(() => new Promise<unknown>(() => {}));
    const adapter = createLocalTranslation({ ...platform, detectLocalLanguage: fallback });
    const request = adapter.translate("Synthetic title", "vi", controller.signal);
    const rejected = expect(request).rejects.toMatchObject({ code: "UNCERTAIN_LANGUAGE" });
    await vi.advanceTimersByTimeAsync(2_001);
    await rejected;
    expect(platform.translator.create).not.toHaveBeenCalled();
    const next = adapter.translate("Synthetic title", "vi", controller.signal);
    const cancelled = expect(next).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await cancelled;
    expect(platform.translator.create).not.toHaveBeenCalled();
  });
  it("accepts Chrome's appended und candidate when a known language is confident", async () => {
    const { adapter, detector, platform, controller } = setup();
    detector.detect.mockResolvedValue([
      { detectedLanguage: "en", confidence: 0.99 },
      { detectedLanguage: "und", confidence: 0.01 },
    ]);
    expect((await adapter.translate("Hello", "vi", controller.signal)).sourceLanguage).toBe("en");
    expect(platform.translator.availability).toHaveBeenCalledWith({
      sourceLanguage: "en",
      targetLanguage: "vi",
    });
  });
  it("rejects an und winner without requesting a translation model", async () => {
    const { adapter, detector, platform, controller } = setup();
    detector.detect.mockResolvedValue([
      { detectedLanguage: "en", confidence: 0.01 },
      { detectedLanguage: "und", confidence: 0.99 },
    ]);
    await expect(
      adapter.translate("Unknown passage", "vi", controller.signal),
    ).rejects.toMatchObject({ code: "UNCERTAIN_LANGUAGE" });
    expect(platform.translator.availability).not.toHaveBeenCalled();
  });
  it("keeps und in ambiguity checks and rejects und as a target", async () => {
    const { adapter, detector, platform, controller } = setup();
    detector.detect.mockResolvedValue([
      { detectedLanguage: "en", confidence: 0.8 },
      { detectedLanguage: "und", confidence: 0.7 },
    ]);
    await expect(adapter.translate("Hello", "vi", controller.signal)).rejects.toMatchObject({
      code: "UNCERTAIN_LANGUAGE",
    });
    await expect(adapter.translate("Hello", "und", controller.signal)).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
    });
    expect(platform.translator.availability).not.toHaveBeenCalled();
  });
  it("fails closed on missing APIs and unsupported language pairs", async () => {
    await expect(
      createLocalTranslation(undefined).translate("Hello", "vi", new AbortController().signal),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const { adapter, platform, controller } = setup();
    platform.translator.availability.mockResolvedValue("unavailable");
    await expect(adapter.translate("Hello", "vi", controller.signal)).rejects.toMatchObject({
      code: "UNSUPPORTED_LANGUAGE",
    });
    expect(platform.translator.create).not.toHaveBeenCalled();
  });
  it("requires an actual panel gesture for downloadable models and allows a later retry", async () => {
    const { adapter, platform, progress, controller } = setup();
    platform.languageDetector.availability.mockResolvedValue("downloadable");
    await expect(adapter.translate("Hello", "vi", controller.signal)).rejects.toMatchObject({
      code: "SETUP_REQUIRED",
    });
    expect(platform.languageDetector.create).not.toHaveBeenCalled();
    platform.isUserActive.mockReturnValue(true);
    await adapter.translate("Hello", "vi", controller.signal);
    expect(progress).toHaveBeenCalled();
    expect(progress.mock.calls.every(([message]) => message === "Translating...")).toBe(true);
  });
  it("checks user activation again when translator creation needs a download", async () => {
    const { adapter, platform, controller } = setup();
    platform.languageDetector.availability.mockResolvedValue("downloadable");
    platform.translator.availability.mockResolvedValue("downloading");
    platform.isUserActive.mockReturnValueOnce(true).mockReturnValueOnce(false);
    await expect(adapter.translate("Hello", "vi", controller.signal)).rejects.toMatchObject({
      code: "SETUP_REQUIRED",
    });
    expect(platform.translator.create).not.toHaveBeenCalled();
  });
  it("maps browser activation errors to safe setup guidance without exposing raw errors", async () => {
    const { adapter, platform, controller } = setup();
    platform.translator.create.mockRejectedValue({
      name: "NotAllowedError",
      message: "Sensitive selected text",
    });
    await expect(adapter.translate("Hello", "vi", controller.signal)).rejects.toMatchObject({
      code: "SETUP_REQUIRED",
    });
    platform.translator.create.mockRejectedValue(new Error("Sensitive selected text"));
    await expect(adapter.translate("Hello", "vi", controller.signal)).rejects.toMatchObject({
      code: "FAILED",
      message: "Local translation failed. Please try again.",
    });
  });
  it.each([
    { results: [] },
    { results: [{ detectedLanguage: "en", confidence: 0.79 }] },
    {
      results: [
        { detectedLanguage: "en", confidence: 0.8 },
        { detectedLanguage: "fr", confidence: 0.7 },
      ],
    },
    { results: [{ detectedLanguage: "en", confidence: Number.NaN }] },
    { results: [{ detectedLanguage: "und", confidence: 1 }] },
  ])("rejects uncertain or malformed language detection (%j)", async ({ results }) => {
    const { adapter, detector, platform, controller } = setup();
    detector.detect.mockResolvedValue(results);
    await expect(adapter.translate("Hello", "vi", controller.signal)).rejects.toMatchObject({
      code: "UNCERTAIN_LANGUAGE",
    });
    expect(platform.translator.create).not.toHaveBeenCalled();
  });
  it.each([
    ["zh-CN", "zh"],
    ["zh-TW", "zh-Hant"],
    ["zh-Hant", "zh-Hant"],
    ["fr-CA", "fr-CA"],
  ])("preserves scripts and only maps known tags (%s)", async (source, expected) => {
    const { adapter, detector, platform, controller } = setup();
    detector.detect.mockResolvedValue([{ detectedLanguage: source, confidence: 1 }]);
    await adapter.translate("Synthetic passage", "vi", controller.signal);
    expect(platform.translator.availability).toHaveBeenCalledWith({
      sourceLanguage: expected,
      targetLanguage: "vi",
    });
  });
  it.each(["", " ", "a".repeat(20_001)])(
    "rejects empty and oversized translation output",
    async (output) => {
      const { adapter, translator, controller } = setup();
      translator.translate.mockResolvedValue(output);
      await expect(adapter.translate("Hello", "vi", controller.signal)).rejects.toMatchObject({
        code: "INVALID_OUTPUT",
      });
    },
  );
  it("validates input before calling models", async () => {
    const { adapter, platform, controller } = setup();
    for (const text of ["", " ", "a".repeat(10_001)]) {
      await expect(adapter.translate(text, "vi", controller.signal)).rejects.toMatchObject({
        code: "INVALID_OUTPUT",
      });
    }
    await expect(
      adapter.translate("Hello", "vi; executable", controller.signal),
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
    expect(platform.languageDetector.availability).not.toHaveBeenCalled();
  });
  it("validates malformed provider values without leaking browser details", async () => {
    const { adapter, detector, translator, controller } = setup();
    detector.detect.mockResolvedValueOnce(null as never);
    await expect(adapter.translate("Hello", "vi", controller.signal)).rejects.toMatchObject({
      code: "UNCERTAIN_LANGUAGE",
    });
    translator.translate.mockResolvedValueOnce({ text: "Unsafe object" } as never);
    await expect(adapter.translate("Hello", "vi", controller.signal)).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
    });
  });
  it("sorts candidates and accepts the exact confidence and margin boundary", async () => {
    const { adapter, detector, controller } = setup();
    detector.detect.mockResolvedValue([
      { detectedLanguage: "fr", confidence: 0.6 },
      { detectedLanguage: "en", confidence: 0.8 },
    ]);
    expect((await adapter.translate("Hello", "vi", controller.signal)).sourceLanguage).toBe("en");
  });
  it("destroys late created instances after cancellation", async () => {
    const { adapter, platform, detector, controller } = setup();
    const created = deferred<typeof detector>();
    platform.languageDetector.create.mockReturnValue(created.promise);
    const result = adapter.translate("Hello", "vi", controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(platform.languageDetector.create).toHaveBeenCalled());
    controller.abort();
    await rejected;
    created.resolve(detector);
    await vi.waitFor(() => expect(detector.destroy).toHaveBeenCalledOnce());
  });
  it("cancels active translation and prevents late results from being returned", async () => {
    const { adapter, translator, detector, controller } = setup();
    const translated = deferred<string>();
    translator.translate.mockReturnValue(translated.promise);
    const result = adapter.translate("Hello", "vi", controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(translator.translate).toHaveBeenCalled());
    controller.abort();
    translated.resolve("Late text");
    await rejected;
    expect(detector.destroy).toHaveBeenCalledOnce();
    expect(translator.destroy).toHaveBeenCalledOnce();
  });
  it("supersedes previous requests without destroying the replacement's models", async () => {
    const { adapter, translator, detector, controller } = setup();
    const translated = deferred<string>();
    translator.translate.mockReturnValueOnce(translated.promise);
    const previous = adapter.translate("First passage", "vi", controller.signal);
    const rejected = expect(previous).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(translator.translate).toHaveBeenCalled());
    expect((await adapter.translate("Second passage", "vi", controller.signal)).text).toBe(
      "Xin chào",
    );
    await rejected;
    translated.resolve("Obsolete text");
    await Promise.resolve();
    expect(detector.destroy).toHaveBeenCalledOnce();
    expect(translator.destroy).toHaveBeenCalledOnce();
    adapter.dispose();
  });
  it("disposal cancels an in-flight detector before translation can start", async () => {
    const { adapter, detector, platform, controller } = setup();
    const detection = deferred<{ detectedLanguage: string; confidence: number }[]>();
    detector.detect.mockReturnValue(detection.promise);
    const result = adapter.translate("Hello", "vi", controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(detector.detect).toHaveBeenCalled());
    adapter.dispose();
    detection.resolve([{ detectedLanguage: "en", confidence: 1 }]);
    await rejected;
    expect(platform.translator.create).not.toHaveBeenCalled();
  });
  it.each(["availability", "detect", "translate", "setup"])("bounds the %s wait", async (stage) => {
    vi.useFakeTimers();
    const { adapter, platform, detector, translator, controller } = setup();
    const never = new Promise<never>(() => {});
    let milliseconds = 5_000;
    if (stage === "availability") platform.languageDetector.availability.mockReturnValue(never);
    if (stage === "detect") detector.detect.mockReturnValue(never);
    if (stage === "translate") {
      translator.translate.mockReturnValue(never);
      milliseconds = 15_000;
    }
    if (stage === "setup") {
      platform.languageDetector.availability.mockResolvedValue("downloadable");
      platform.isUserActive.mockReturnValue(true);
      platform.languageDetector.create.mockReturnValue(never);
      milliseconds = 120_000;
    }
    const rejected = expect(
      adapter.translate("Hello", "vi", controller.signal),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(milliseconds);
    await rejected;
  });
  it("detects browser APIs structurally and reads activation at invocation time", async () => {
    const { platform } = setup();
    vi.stubGlobal("Translator", platform.translator);
    vi.stubGlobal("LanguageDetector", platform.languageDetector);
    const activation = { isActive: false };
    vi.stubGlobal("navigator", { userActivation: activation });
    const detectLanguage = vi.fn(async () => ({
      isReliable: true,
      languages: [{ language: "fr", percentage: 100 }],
    }));
    vi.stubGlobal("chrome", { i18n: { detectLanguage } });
    const browser: LocalTranslationPlatform | undefined = browserLocalTranslationPlatform();
    expect(browser?.isUserActive()).toBe(false);
    await browser?.detectLocalLanguage?.("Synthetic French");
    expect(detectLanguage).toHaveBeenCalledExactlyOnceWith("Synthetic French");
    activation.isActive = true;
    expect(browser?.isUserActive()).toBe(true);
    vi.stubGlobal("Translator", {});
    expect(browserLocalTranslationPlatform()).toBeUndefined();
  });
});
