import { VoiceName, ReadingSpeed, EpisodeNotes, GeminiGenerationUsage } from "../types";
import { supabase } from "./supabaseClient";

const GEMINI_API_ROUTE = "/api/gemini";
const MAX_GEMINI_RETRY_ATTEMPTS = 4;

export type GeminiRetryState = {
  attempt: number;
  delayMs: number;
  message: string;
  online: boolean;
};

export type GeminiRequestOptions = {
  onRetry?: (state: GeminiRetryState) => void;
};

export type GeminiTtsOptions = GeminiRequestOptions & {
  languageHint?: string;
  usageContext?: {
    episodeId: string;
    chunkIndex: number;
    usageCategory: "podcast_audio" | "summary_audio";
  };
};

export type GeminiTtsResult = {
  audio: string;
  usage?: GeminiGenerationUsage;
};

type GeminiStreamPayload = {
  action: "extractImageStream";
  base64Data: string;
  mimeType: string;
} | {
  action: "extractPdfStream";
  base64Data: string;
} | {
  action: "extractWebPage";
  url: string;
};

type GeminiStreamEvent = {
  type?: "chunk" | "done";
  text?: string;
  error?: string;
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

// A 429 request has already consumed quota and retrying immediately burns scarce free-tier TTS calls.
const isRetryableHttpStatus = (status: number) => status === 408 || status === 425 || status >= 500;

const isRetryableMessage = (message: string) => {
  const normalized = message.toLowerCase();

	  if (
	    normalized.includes("ogiltig") ||
	    normalized.includes("saknas.") ||
	    normalized.includes("saknas eller är ogiltig") ||
	    normalized.includes("okänd") ||
	    normalized.includes("method not allowed") ||
	    normalized.includes("quota") ||
	    normalized.includes("free tier") ||
	    normalized.includes("generation limit") ||
	    normalized.includes("no credits") ||
	    normalized.includes("ai limit reached") ||
	    normalized.includes("billing") ||
	    normalized.includes("resource_exhausted") ||
	    normalized.includes("generate_content_free_tier_requests")
	  ) {
	    return false;
	  }

  return true;
};

const getAuthHeaders = async () => {
  const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
  const token = data.session?.access_token;
  if (!token) {
    throw new GeminiRequestError("Du måste vara inloggad för att använda VoxPod.", {
      status: 401,
      retryable: false,
    });
  }

  return {
    "content-type": "application/json",
    "authorization": `Bearer ${token}`,
  };
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
        headers: await getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message =
          typeof result?.error === "string" ? result.error : "Ett serverfel uppstod.";
        const isTtsRequest = payload.action === "tts";
        throw new GeminiRequestError(message, {
          status: response.status,
          retryable: !isTtsRequest && isRetryableHttpStatus(response.status) && isRetryableMessage(message),
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

      if (attempt >= MAX_GEMINI_RETRY_ATTEMPTS) {
        throw new GeminiRequestError(normalizedError.message, {
          status: normalizedError.status,
          retryable: false,
        });
      }
    }
  }
};

const streamGeminiText = async (
  payload: GeminiStreamPayload,
  onChunk: (textChunk: string) => void
) => {
  const response = await fetch(GEMINI_API_ROUTE, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const message =
      typeof result?.error === "string" ? result.error : "Ett serverfel uppstod.";
    throw new GeminiRequestError(message, {
      status: response.status,
      retryable: false,
    });
  }

  if (!response.body) {
    throw new GeminiRequestError("Servern returnerade ingen textström.", {
      retryable: false,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line) {
        const event = JSON.parse(line) as GeminiStreamEvent;
        if (event.error) {
          throw new GeminiRequestError(event.error, {
            retryable: false,
          });
        }
        if (event.type === "chunk" && event.text) {
          onChunk(event.text);
        }
      }

      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      break;
    }
  }

  const trailingLine = buffer.trim();
  if (trailingLine) {
    const event = JSON.parse(trailingLine) as GeminiStreamEvent;
    if (event.error) {
      throw new GeminiRequestError(event.error, {
        retryable: false,
      });
    }
    if (event.type === "chunk" && event.text) {
      onChunk(event.text);
    }
  }
};

export const generateTTS = async (
  text: string,
  voice: VoiceName,
  speed: ReadingSpeed = ReadingSpeed.Normal,
  options?: GeminiTtsOptions
): Promise<GeminiTtsResult> => {
  const result = await postGemini<GeminiTtsResult>({
    action: "tts",
    text,
    voice,
    speed,
    languageHint: options?.languageHint,
    episodeId: options?.usageContext?.episodeId,
    chunkIndex: options?.usageContext?.chunkIndex,
    usageCategory: options?.usageContext?.usageCategory,
  }, options);

  return result;
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

export const extractWebPageText = async (
  url: string,
  options?: GeminiRequestOptions
): Promise<string> => {
  const result = await postGemini<{ text: string }>({
    action: "extractWebPage",
    url,
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

export const streamTextFromImage = async (
  base64Data: string,
  mimeType: string,
  onChunk: (textChunk: string) => void
) => {
  await streamGeminiText({
    action: "extractImageStream",
    base64Data,
    mimeType,
  }, onChunk);
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

export const streamTextFromPdf = async (
  base64Data: string,
  onChunk: (textChunk: string) => void
) => {
  await streamGeminiText({
    action: "extractPdfStream",
    base64Data,
  }, onChunk);
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
