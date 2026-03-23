import { VoiceName, ReadingSpeed, EpisodeNotes } from "../types";

const GEMINI_API_ROUTE = "/api/gemini";

const handleClientError = (error: unknown) => {
  if (error instanceof Error) {
    throw error;
  }
  throw new Error("Ett oväntat nätverksfel uppstod.");
};

const postGemini = async <T>(payload: Record<string, unknown>): Promise<T> => {
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
      throw new Error(
        typeof result?.error === "string" ? result.error : "Ett serverfel uppstod."
      );
    }

    return result as T;
  } catch (error) {
    return handleClientError(error);
  }
};

export const generateTTS = async (
  text: string,
  voice: VoiceName,
  speed: ReadingSpeed = ReadingSpeed.Normal
): Promise<string> => {
  const result = await postGemini<{ audio: string }>({
    action: "tts",
    text,
    voice,
    speed,
  });

  return result.audio;
};

export const translateText = async (text: string, targetLanguage: string): Promise<string> => {
  const result = await postGemini<{ text: string }>({
    action: "translate",
    text,
    targetLanguage,
  });

  return result.text;
};

export const extractTextFromImage = async (
  base64Data: string,
  mimeType: string
): Promise<string> => {
  const result = await postGemini<{ text: string }>({
    action: "extractImage",
    base64Data,
    mimeType,
  });

  return result.text;
};

export const extractTextFromPdf = async (base64Data: string): Promise<string> => {
  const result = await postGemini<{ text: string }>({
    action: "extractPdf",
    base64Data,
  });

  return result.text;
};

export const generateNotes = async (text: string): Promise<EpisodeNotes> => {
  const result = await postGemini<{ notes: EpisodeNotes }>({
    action: "generateNotes",
    text,
  });

  return result.notes;
};
