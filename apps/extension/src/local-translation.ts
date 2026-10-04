type ErrorCode =
  | "UNAVAILABLE"
  | "SETUP_REQUIRED"
  | "UNSUPPORTED_LANGUAGE"
  | "UNCERTAIN_LANGUAGE"
  | "TIMEOUT"
  | "CANCELLED"
  | "FAILED"
  | "INVALID_OUTPUT";

const messages: Record<ErrorCode, string> = {
  UNAVAILABLE: "Local translation is unavailable in this browser or on this device.",
  SETUP_REQUIRED: "Click Enable local translation to prepare Chrome's language models.",
  UNSUPPORTED_LANGUAGE: "Chrome cannot translate this language pair on this device.",
  UNCERTAIN_LANGUAGE:
    "Could not confidently identify the language. Select a longer passage in one language.",
  TIMEOUT: "Local translation took too long. Please try again.",
  CANCELLED: "Local translation was cancelled.",
  FAILED: "Local translation failed. Please try again.",
  INVALID_OUTPUT: "Local translation returned an invalid result. Please try again.",
};

export class LocalTranslationError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(messages[code]);
    this.name = "LocalTranslationError";
  }
}

interface Model {
  destroy(): void;
}
interface LocalDetector extends Model {
  detect(text: string, options: { signal: AbortSignal }): Promise<unknown>;
}
interface LocalTranslator extends Model {
  translate(text: string, options: { signal: AbortSignal }): Promise<unknown>;
}
interface CreateOptions {
  signal: AbortSignal;
  monitor: (monitor: { addEventListener(type: string, listener: () => void): void }) => void;
}
interface Pair {
  sourceLanguage: string;
  targetLanguage: string;
}
export interface LocalTranslationPlatform {
  languageDetector: {
    availability(): Promise<string>;
    create(options: CreateOptions): Promise<LocalDetector>;
  };
  translator: {
    availability(options: Pair): Promise<string>;
    create(options: Pair & CreateOptions): Promise<LocalTranslator>;
  };
  isUserActive(): boolean;
}

const DETECTION_MS = 5_000;
const TRANSLATION_MS = 15_000;
const SETUP_MS = 120_000;

function destroy(model: Model | undefined): void {
  try {
    model?.destroy();
  } catch {
    // Release remains best effort after a browser instance has already closed.
  }
}

/** Map only known Chrome Chinese identifiers; never discard a script or region. */
function language(tag: unknown): string | undefined {
  if (typeof tag !== "string" || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(tag)) {
    return undefined;
  }
  if (tag === "und") return undefined;
  if (tag === "zh-CN") return "zh";
  if (tag === "zh-TW") return "zh-Hant";
  return tag;
}

function detectedLanguage(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    throw new LocalTranslationError("UNCERTAIN_LANGUAGE");
  }
  const results: { language: string; confidence: number }[] = [];
  for (const result of value) {
    if (!result || typeof result !== "object")
      throw new LocalTranslationError("UNCERTAIN_LANGUAGE");
    // Chrome includes und as the probability mass for unidentified languages.
    // Keep it in confidence comparisons, but never choose it as a source.
    const tag = result.detectedLanguage === "und" ? "und" : language(result.detectedLanguage);
    const confidence = result.confidence;
    if (
      !tag ||
      typeof confidence !== "number" ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1
    ) {
      throw new LocalTranslationError("UNCERTAIN_LANGUAGE");
    }
    results.push({ language: tag, confidence });
  }
  results.sort((left, right) => right.confidence - left.confidence);
  const best = results[0];
  if (
    !best ||
    best.language === "und" ||
    best.confidence < 0.8 ||
    best.confidence + Number.EPSILON < (results[1]?.confidence ?? 0) + 0.2
  ) {
    throw new LocalTranslationError("UNCERTAIN_LANGUAGE");
  }
  return best.language;
}

export function createLocalTranslation(
  platform: LocalTranslationPlatform | undefined,
  onProgress: (message: string) => void = () => {},
) {
  let detector: LocalDetector | undefined;
  let translator: LocalTranslator | undefined;
  let pairKey: string | undefined;
  let current: AbortController | undefined;
  let disposed = false;

  function release(): void {
    destroy(detector);
    destroy(translator);
    detector = undefined;
    translator = undefined;
    pairKey = undefined;
  }

  async function translate(text: string, targetLanguage: string, signal: AbortSignal) {
    current?.abort();
    const operation = new AbortController();
    current = operation;
    const abort = () => operation.abort();
    signal.addEventListener("abort", abort, { once: true });
    // Destroy objects immediately even if Chrome ignores the per-call signal.
    operation.signal.addEventListener("abort", release, { once: true });
    const active = () => !disposed && !operation.signal.aborted && current === operation;
    function assertActive(): void {
      if (!active()) throw new LocalTranslationError("CANCELLED");
    }
    function wait<T>(
      start: () => Promise<T>,
      timeout: number,
      late?: (value: T) => void,
    ): Promise<T> {
      assertActive();
      return new Promise<T>((resolve, reject) => {
        let finished = false;
        const finish = (error?: unknown, value?: T) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          operation.signal.removeEventListener("abort", cancelled);
          if (error) reject(error);
          else resolve(value as T);
        };
        const cancelled = () => finish(new LocalTranslationError("CANCELLED"));
        const timer = setTimeout(
          () => {
            finish(new LocalTranslationError("TIMEOUT"));
            operation.abort();
          },
          Math.max(0, timeout),
        );
        operation.signal.addEventListener("abort", cancelled, { once: true });
        Promise.resolve()
          .then(() => {
            assertActive();
            return start();
          })
          .then(
            (value) => {
              if (finished || !active()) {
                late?.(value);
                return;
              }
              finish(undefined, value);
            },
            (error: unknown) => finish(error),
          );
      });
    }
    function creationBudget(
      availability: string,
      unsupported: ErrorCode,
      readyBudget: number,
    ): number {
      if (availability === "unavailable") throw new LocalTranslationError(unsupported);
      if (availability === "available") return readyBudget;
      if (availability !== "downloadable" && availability !== "downloading") {
        throw new LocalTranslationError("FAILED");
      }
      if (!platform?.isUserActive()) throw new LocalTranslationError("SETUP_REQUIRED");
      onProgress("Chrome is downloading local language models. This may take a few minutes.");
      return SETUP_MS;
    }
    const options: CreateOptions = {
      signal: operation.signal,
      monitor: (monitor) =>
        monitor.addEventListener("downloadprogress", () => {
          if (active()) onProgress("Chrome is downloading local language models.");
        }),
    };
    try {
      if (signal.aborted || disposed) operation.abort();
      assertActive();
      if (!platform) throw new LocalTranslationError("UNAVAILABLE");
      const target = language(targetLanguage);
      if (!target || typeof text !== "string" || !text.trim() || text.length > 10_000) {
        throw new LocalTranslationError("INVALID_OUTPUT");
      }
      const detectionDeadline = Date.now() + DETECTION_MS;
      let downloaded = false;
      if (!detector) {
        const availability = await wait(
          () => platform.languageDetector.availability(),
          DETECTION_MS,
        );
        downloaded = availability === "downloadable" || availability === "downloading";
        const budget = creationBudget(availability, "UNAVAILABLE", detectionDeadline - Date.now());
        detector = await wait(() => platform.languageDetector.create(options), budget, destroy);
      }
      // Download time is separate from the warm detection budget.
      const detectionBudget = downloaded ? DETECTION_MS : detectionDeadline - Date.now();
      const instance = detector;
      const source = detectedLanguage(
        await wait(() => instance.detect(text, { signal: operation.signal }), detectionBudget),
      );
      assertActive();
      if (source === target) return { text, sourceLanguage: source };
      const requestedPair = { sourceLanguage: source, targetLanguage: target };
      const key = `${source}:${target}`;
      if (key !== pairKey || !translator) {
        destroy(translator);
        translator = undefined;
        pairKey = undefined;
        const availability = await wait(
          () => platform.translator.availability(requestedPair),
          DETECTION_MS,
        );
        const budget = creationBudget(availability, "UNSUPPORTED_LANGUAGE", DETECTION_MS);
        translator = await wait(
          () => platform.translator.create({ ...requestedPair, ...options }),
          budget,
          destroy,
        );
        pairKey = key;
      }
      const model = translator;
      const output = await wait(
        () => model.translate(text, { signal: operation.signal }),
        TRANSLATION_MS,
      );
      assertActive();
      if (typeof output !== "string" || !output.trim() || output.length > 20_000) {
        throw new LocalTranslationError("INVALID_OUTPUT");
      }
      return { text: output, sourceLanguage: source };
    } catch (error) {
      // A superseded operation must never destroy its successor's models.
      if (current === operation) release();
      if (error instanceof LocalTranslationError) throw error;
      if (!active()) throw new LocalTranslationError("CANCELLED");
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "NotAllowedError"
      ) {
        throw new LocalTranslationError("SETUP_REQUIRED");
      }
      throw new LocalTranslationError("FAILED");
    } finally {
      signal.removeEventListener("abort", abort);
      operation.signal.removeEventListener("abort", release);
      if (current === operation) current = undefined;
    }
  }
  return {
    translate,
    dispose(): void {
      disposed = true;
      current?.abort();
      release();
    },
  };
}

/** Browser features are detected in the panel document, never a service worker. */
export function browserLocalTranslationPlatform(): LocalTranslationPlatform | undefined {
  const browser = globalThis as unknown as {
    Translator?: LocalTranslationPlatform["translator"];
    LanguageDetector?: LocalTranslationPlatform["languageDetector"];
    navigator?: { userActivation?: { isActive?: boolean } };
  };
  if (
    typeof browser.Translator?.availability !== "function" ||
    typeof browser.Translator.create !== "function" ||
    typeof browser.LanguageDetector?.availability !== "function" ||
    typeof browser.LanguageDetector.create !== "function"
  ) {
    return undefined;
  }
  return {
    translator: browser.Translator,
    languageDetector: browser.LanguageDetector,
    isUserActive: () => browser.navigator?.userActivation?.isActive === true,
  };
}
