import { VoiceName, ReadingSpeed, EpisodeNotes } from "../types";

const GEMINI_API_ROUTE = "/api/gemini";

export type GeminiRetryState = {
  attempt: number;
  delayMs: number;
  message: string;
  online: boolean;
};

export type GeminiRequestOptions = {
  onRetry?: (state: GeminiRetryState) => void;
};

class GeminiRequestError extends Error {
  status?: number;
  retryable: boolean;

  constructor(message: string, options?: { status?: number; retryable?: boolean }) {
    super(message);
    this.name = "GeminiRequestError";
    this.status = options?.status;
    this.retryable = options?.retryable ?? false;
  }
}

const sleep = (ms: number) =>
  new Promise<void>(resolve => window.setTimeout(resolve, ms));

const waitForOnline = async () => {
  if (typeof navigator === "undefined" || navigator.onLine) {
    return;
  }

  await new Promise<void>(resolve => {
    const handleOnline = () => {
      window.removeEventListener("online", handleOnline);
      resolve();
    };

    window.addEventListener("online", handleOnline, { once: true });
  });
};

const getRetryDelay = (attempt: number) => {
  const baseDelay = Math.min(30_000, 1_500 * Math.pow(1.8, attempt - 1));
  return Math.round(baseDelay + Math.random() * 350);
};

const isRetryableHttpStatus = (status: number) => status === 408 || status === 425 || status === 429 || status >= 500;

const isRetryableMessage = (message: string) => {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("ogiltig") ||
    normalized.includes("saknas.") ||
    normalized.includes("saknas eller är ogiltig") ||
    normalized.includes("okänd") ||
    normalized.includes("method not allowed")
  ) {
    return false;
  }

  return true;
};

const normalizeUnknownError = (error: unknown) => {
  if (error instanceof GeminiRequestError) {
    return error;
  }

  if (error instanceof Error) {
    return new GeminiRequestError(error.message || "Ett oväntat nätverksfel uppstod.", {
      retryable: true,
    });
  }

  return new GeminiRequestError("Ett oväntat nätverksfel uppstod.", {
    retryable: true,
  });
};

const postGemini = async <T>(
  payload: Record<string, unknown>,
  options?: GeminiRequestOptions
): Promise<T> => {
  let attempt = 0;

  while (true) {
    try {
      const response = await fetch(GEMINI_API_ROUTE, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message =
          typeof result?.error === "string" ? result.error : "Ett serverfel uppstod.";
        throw new GeminiRequestError(message, {
          status: response.status,
          retryable: isRetryableHttpStatus(response.status) && isRetryableMessage(message),
        });
      }

      return result as T;
    } catch (error) {
      const normalizedError = normalizeUnknownError(error);
      if (!normalizedError.retryable) {
        throw normalizedError;
      }

      attempt += 1;
      const delayMs = getRetryDelay(attempt);
      const online = typeof navigator === "undefined" ? true : navigator.onLine;
      options?.onRetry?.({
        attempt,
        delayMs,
        message: normalizedError.message,
        online,
      });
      if (!online) {
        await waitForOnline();
      }
      await sleep(delayMs);
    }
  }
};

export const generateTTS = async (
  text: string,
  voice: VoiceName,
  speed: ReadingSpeed = ReadingSpeed.Normal,
  options?: GeminiRequestOptions
): Promise<string> => {
  const result = await postGemini<{ audio: string }>({
    action: "tts",
    text,
    voice,
    speed,
  }, options);

  return result.audio;
};

export const translateText = async (
  text: string,
  targetLanguage: string,
  options?: GeminiRequestOptions
): Promise<string> => {
  const result = await postGemini<{ text: string }>({
    action: "translate",
    text,
    targetLanguage,
  }, options);

  return result.text;
};

export const extractTextFromImage = async (
  base64Data: string,
  mimeType: string,
  options?: GeminiRequestOptions
): Promise<string> => {
  const result = await postGemini<{ text: string }>({
    action: "extractImage",
    base64Data,
    mimeType,
  }, options);

  return result.text;
};

export const extractTextFromPdf = async (
  base64Data: string,
  options?: GeminiRequestOptions
): Promise<string> => {
  const result = await postGemini<{ text: string }>({
    action: "extractPdf",
    base64Data,
  }, options);

  return result.text;
};

export const generateNotes = async (
  text: string,
  options?: GeminiRequestOptions
): Promise<EpisodeNotes> => {
  const result = await postGemini<{ notes: EpisodeNotes }>({
    action: "generateNotes",
    text,
  }, options);

  return result.notes;
};
