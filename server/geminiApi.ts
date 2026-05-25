import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { VoiceName, ReadingSpeed, EpisodeNotes, EpisodeNotesSection, GeminiGenerationUsage } from "../types";
import { extractReadableHtmlText } from "../services/documentService";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

type GeminiHandlerOptions = {
  apiKey?: string | null;
};

type AuthenticatedRequest = {
  userId: string;
  accessToken: string;
};

const getRuntimeEnvValue = (key: string) => {
  if (typeof process !== "undefined" && process.env?.[key]) {
    return process.env[key];
  }

  return undefined;
};

const DEFAULT_SUPABASE_URL = "https://ubqkvuwlojbcqqrxxnsa.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVicWt2dXdsb2piY3Fxcnh4bnNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NDYyNDUsImV4cCI6MjA5MTIyMjI0NX0.nPZUO4B-mLap27au3gE7cU6QbVm6NlGTXVKM4skRGAM";

const HIGH_FIDELITY_DIRECTIVE = `
PERFORMANCE DIRECTIVES (ULTRA-SMOOTH):
1. ACOUSTIC SHIELDING: Heavily soften all sibilants (s, t, sh). Eliminate high-frequency whistling and sharp sounds.
2. VOCAL ROUNDING: Create a warm, full-bodied voice. Eliminate digital hardness and metallic artifacts.
3. MULTILINGUAL MASTERY & AUTO-DETECTION: 
   - Automatically identify the language of the text (Swedish, English, Spanish, French, German, etc.).
   - If the text is SWEDISH: Perfect native Swedish pronunciation of Å, Ä, and Ö. Use Swedish sentence melody and natural pauses.
   - For SWEDISH specifically: pronounce soft K before e, i, y, ä, ö with the Swedish tj-sound, for example "kemi", "kyrka", "kärna", "källa", "känsla", "köpa", "köpkraft". Do not pronounce these with a hard English K.
   - For SWEDISH specifically: pronounce soft SK before e, i, y, ä, ö with the Swedish sj-sound, for example "sked", "skina", "skär", "skön". Pronounce soft G before e, i, y, ä, ö naturally in Swedish, for example "genom", "gick", "gynnat".
   - Preserve correct Swedish place names and personal names. Do not anglicize or flatten Swedish consonant sounds.
   - If the text is ENGLISH: Use a natural, native English accent. Ensure numbers and dates are read in English (e.g., "123" as "one hundred twenty-three").
   - If the text is SPANISH: Correct pronunciation of 'ñ', 'rr', and accents.
   - For ALL languages: Use the correct phonetics, stress, and intonation for that specific language. DO NOT use a Swedish accent for non-Swedish text.
   - The input may include pronunciation tags:
     <sv>...</sv> = pronounce in native Swedish.
     <en>...</en> = pronounce in natural English.
     <es>...</es> = pronounce in natural Spanish.
     <omit>...</omit> = skip completely and do not read aloud.
   - Never say the tags out loud.
   - If Swedish is the primary language, keep Swedish pronunciation all the way through and only switch briefly for explicitly tagged English fragments.
   - Ignore OCR garbage, serial numbers, catalog codes, repeated punctuation noise, and symbol fragments that are not meaningful prose.
4. NO PREAMBLE: Start reading the text immediately. No introductions like "Here is your text".
5. STYLE: Warm, clear, and engaging documentary style.
`;

const SPEED_INSTRUCTIONS: Record<ReadingSpeed, string> = {
  [ReadingSpeed.Slow]: "TEMPO: Långsamt.",
  [ReadingSpeed.Normal]: "TEMPO: Normalt.",
  [ReadingSpeed.Fast]: "TEMPO: Snabbt."
};

const NOTES_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: ["title", "summary", "sections"],
  propertyOrdering: ["title", "summary", "sections"],
  properties: {
    title: {
      type: Type.STRING,
    },
    summary: {
      type: Type.STRING,
    },
    sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["heading", "bullets"],
        propertyOrdering: ["heading", "bullets"],
        properties: {
          heading: {
            type: Type.STRING,
          },
          bullets: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
            },
          },
        },
      },
    },
  },
} as const;

type GeminiAction =
  | "tts"
  | "translate"
  | "extractImage"
  | "extractPdf"
  | "extractWebPage"
  | "extractImageStream"
  | "extractPdfStream"
  | "generateNotes";

type GeminiRequestBody =
  | {
      action: "tts";
      text: string;
      voice: VoiceName;
      speed?: ReadingSpeed;
      languageHint?: string;
      episodeId?: string;
      chunkIndex?: number;
      usageCategory?: "podcast_audio" | "summary_audio";
    }
  | { action: "translate"; text: string; targetLanguage: string }
  | { action: "extractImage"; base64Data: string; mimeType: string }
  | { action: "extractPdf"; base64Data: string }
  | { action: "extractWebPage"; url: string }
  | { action: "extractImageStream"; base64Data: string; mimeType: string }
  | { action: "extractPdfStream"; base64Data: string }
  | { action: "generateNotes"; text: string };

type TtsBody = Extract<GeminiRequestBody, { action: "tts" }>;
type TranslateBody = Extract<GeminiRequestBody, { action: "translate" }>;
type ExtractImageBody = Extract<GeminiRequestBody, { action: "extractImage" }>;
type ExtractPdfBody = Extract<GeminiRequestBody, { action: "extractPdf" }>;
type ExtractWebPageBody = Extract<GeminiRequestBody, { action: "extractWebPage" }>;
type ExtractImageStreamBody = Extract<GeminiRequestBody, { action: "extractImageStream" }>;
type ExtractPdfStreamBody = Extract<GeminiRequestBody, { action: "extractPdfStream" }>;
type GenerateNotesBody = Extract<GeminiRequestBody, { action: "generateNotes" }>;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const json = (body: unknown, status: number = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const STREAM_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-cache, no-transform",
};

const getApiKey = (apiKeyOverride?: string | null) => {
  const apiKey = apiKeyOverride ?? getRuntimeEnvValue("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("Servern saknar GEMINI_API_KEY.");
  }
  return apiKey;
};

const getAiClient = (apiKeyOverride?: string | null) => {
  const apiKey = getApiKey(apiKeyOverride);
  return new GoogleGenAI({ apiKey });
};

const badRequest = (message: string) => json({ error: message }, 400);

const unauthorized = () => json({ error: "Du måste vara inloggad för att använda VoxPod." }, 401);

const validateAuthenticatedRequest = async (request: Request): Promise<AuthenticatedRequest | null> => {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    return null;
  }

  const supabaseUrl = getRuntimeEnvValue("VITE_SUPABASE_URL") || getRuntimeEnvValue("SUPABASE_URL") || DEFAULT_SUPABASE_URL;
  const supabaseAnonKey = getRuntimeEnvValue("VITE_SUPABASE_ANON_KEY") || getRuntimeEnvValue("SUPABASE_ANON_KEY") || DEFAULT_SUPABASE_ANON_KEY;
  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    return null;
  }

  return {
    userId: data.user.id,
    accessToken: token,
  };
};

const normalizeApiError = (error: unknown) => {
  console.error("Gemini API Error:", error);
  const rawMessage = error instanceof Error ? error.message : String(error ?? "");
  const message = rawMessage.toLowerCase();

  if (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("generate_content_free_tier_requests") ||
    message.includes("retrydelay") ||
    message.includes("retry in")
  ) {
    if (
      message.includes("gemini-2.5-flash-preview-tts") ||
      message.includes("gemini-2.5-flash-tts") ||
      message.includes("flash-preview-tts") ||
      message.includes("flash-tts")
    ) {
      return json({ error: "Gemini TTS free tier limit reached. Check the Rate Limit page in Google AI Studio, wait for the quota window to reset, or enable billing." }, 429);
    }

    return json({ error: "Too many requests. Wait a moment and try again." }, 429);
  }

  if (
    message.includes("consumer_suspended") ||
    message.includes("permission_denied") ||
    message.includes("resource_exhausted") ||
    message.includes("quota") ||
    message.includes("billing") ||
    message.includes("credit") ||
    message.includes("free tier")
  ) {
    return json({ error: "No credits left. You’ve reached your generation limit. Upgrade your plan or try again later." }, 402);
  }
  if (
    message.includes("401") ||
    message.includes("api_key_invalid") ||
    message.includes("api key") ||
    message.includes("not found")
  ) {
    return json({ error: "Gemini API-nyckeln saknas eller är ogiltig." }, 500);
  }
  if (message.includes("gemini rest 400") || message.includes("invalid_argument")) {
    return json({ error: "Gemini kunde inte skapa ljud från texten. Prova en kortare text eller rensa specialtecken och försök igen." }, 400);
  }
  if (message.includes("gemini rest 403")) {
    return json({ error: "Gemini-nyckeln saknar behörighet för den här modellen eller projektet." }, 403);
  }
  if (message.includes("gemini rest 500") || message.includes("gemini rest 502") || message.includes("gemini rest 503")) {
    return json({ error: "Gemini är tillfälligt otillgängligt. Försök igen om en stund." }, 502);
  }
  if (message.includes("timeout") || message.includes("deadline")) {
    return json({ error: "Generation took too long. Your podcast may still finish shortly." }, 504);
  }
  if (message.includes("pdf")) {
    return json({ error: "PDF-läsning misslyckades på serversidan. Prova en mindre eller enklare PDF." }, 500);
  }
  if (message.includes("länken") || message.includes("webbsidan")) {
    return json({ error: error instanceof Error ? error.message : "Webbimport misslyckades." }, 502);
  }
  return json({ error: "Ett oväntat serverfel uppstod." }, 500);
};

const parseJsonBody = async (request: Request): Promise<GeminiRequestBody | null> => {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || !("action" in body)) {
      return null;
    }
    return body as GeminiRequestBody;
  } catch {
    return null;
  }
};

const validateVoice = (value: unknown): value is VoiceName =>
  typeof value === "string" && Object.values(VoiceName).includes(value as VoiceName);

const validateSpeed = (value: unknown): value is ReadingSpeed =>
  value === undefined ||
  (typeof value === "string" && Object.values(ReadingSpeed).includes(value as ReadingSpeed));

const isHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const stripCodeFences = (value: string) =>
  value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

const isNotesSection = (value: unknown): value is EpisodeNotesSection => {
  if (!value || typeof value !== "object") return false;
  const section = value as EpisodeNotesSection;
  return (
    isNonEmptyString(section.heading) &&
    Array.isArray(section.bullets) &&
    section.bullets.every(isNonEmptyString)
  );
};

const isEpisodeNotes = (value: unknown): value is EpisodeNotes => {
  if (!value || typeof value !== "object") return false;
  const notes = value as EpisodeNotes;
  return (
    isNonEmptyString(notes.title) &&
    isNonEmptyString(notes.summary) &&
    Array.isArray(notes.sections) &&
    notes.sections.every(isNotesSection)
  );
};

const parseStructuredNotes = (rawText: string): EpisodeNotes => {
  const cleaned = stripCodeFences(rawText);

  try {
    const parsed = JSON.parse(cleaned);
    if (isEpisodeNotes(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through to text fallback below.
  }

  const lines = cleaned
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const bulletLines = lines
    .map(line => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 18);

  const highlightBullets = bulletLines.slice(0, 6);
  const detailBullets = bulletLines.slice(6, 12);
  const conceptBullets = bulletLines.slice(12, 18);

  return {
    title: "Anteckningar",
    summary: lines.slice(0, 8).join(" ").slice(0, 1400) || cleaned.slice(0, 1400),
    sections: [
      {
        heading: "Viktiga punkter",
        bullets: highlightBullets.length > 0 ? highlightBullets : [cleaned.slice(0, 220)]
      },
      ...(detailBullets.length > 0
        ? [{
            heading: "Detaljer att minnas",
            bullets: detailBullets,
          }]
        : []),
      ...(conceptBullets.length > 0
        ? [{
            heading: "Begrepp och samband",
            bullets: conceptBullets,
          }]
        : [])
    ]
  };
};

type GenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          data?: string;
        };
        inline_data?: {
          data?: string;
        };
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  responseId?: string;
};

const extractGeneratedText = (response: GenerateContentResponse) =>
  response.candidates
    ?.flatMap(candidate => candidate.content?.parts ?? [])
    .map(part => part.text?.trim() ?? "")
    .find(Boolean) ?? "";

const extractGeneratedAudio = (response: GenerateContentResponse) =>
  response.candidates
    ?.flatMap(candidate => candidate.content?.parts ?? [])
    .map(part => part.inlineData?.data ?? part.inline_data?.data ?? "")
    .find(Boolean) ?? "";

const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const TTS_INPUT_USD_PER_MILLION_TOKENS = 0.5;
const TTS_OUTPUT_USD_PER_MILLION_TOKENS = 10;

const buildTtsUsage = (response: GenerateContentResponse): GeminiGenerationUsage | undefined => {
  const inputTokens = response.usageMetadata?.promptTokenCount;
  const outputTokens = response.usageMetadata?.candidatesTokenCount;
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") {
    return undefined;
  }

  const inputCostUsd = (inputTokens / 1_000_000) * TTS_INPUT_USD_PER_MILLION_TOKENS;
  const outputCostUsd = (outputTokens / 1_000_000) * TTS_OUTPUT_USD_PER_MILLION_TOKENS;
  return {
    provider: "Gemini",
    model: TTS_MODEL,
    inputTokens,
    outputTokens,
    totalTokens: response.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
    inputUsdPerMillionTokens: TTS_INPUT_USD_PER_MILLION_TOKENS,
    outputUsdPerMillionTokens: TTS_OUTPUT_USD_PER_MILLION_TOKENS,
    responseId: response.responseId,
    recordedAt: Date.now(),
  };
};

const logTtsUsage = async (
  auth: AuthenticatedRequest,
  body: TtsBody,
  usage: GeminiGenerationUsage
) => {
  if (!isNonEmptyString(body.episodeId) || !Number.isInteger(body.chunkIndex) || !body.usageCategory) {
    return;
  }

  const supabaseUrl = getRuntimeEnvValue("VITE_SUPABASE_URL") || getRuntimeEnvValue("SUPABASE_URL") || DEFAULT_SUPABASE_URL;
  const supabaseAnonKey = getRuntimeEnvValue("VITE_SUPABASE_ANON_KEY") || getRuntimeEnvValue("SUPABASE_ANON_KEY") || DEFAULT_SUPABASE_ANON_KEY;
  const usageClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const { error } = await usageClient.from("podcast_generation_usage").insert({
    user_id: auth.userId,
    episode_id: body.episodeId,
    chunk_index: body.chunkIndex,
    usage_category: body.usageCategory,
    provider: usage.provider,
    model: usage.model,
    response_id: usage.responseId ?? null,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    input_cost_usd: usage.inputCostUsd,
    output_cost_usd: usage.outputCostUsd,
    total_cost_usd: usage.totalCostUsd,
    pricing: {
      inputUsdPerMillionTokens: usage.inputUsdPerMillionTokens,
      outputUsdPerMillionTokens: usage.outputUsdPerMillionTokens,
    },
  });

  if (error) {
    console.error("Could not persist Gemini TTS usage:", error);
  }
};

const EDUCATIONAL_SUMMARY_MODEL = "gemini-3-flash-preview";
const SUMMARY_CHUNK_TARGET_CHARACTERS = 6200;
const SUMMARY_CHUNK_OVERLAP_CHARACTERS = 120;
const MAX_SUMMARY_CHUNKS = 8;
const MIN_SUMMARIZABLE_WORDS = 35;
const MIN_SUMMARIZABLE_LETTER_RATIO = 0.46;

const normalizeSummaryLine = (value: string) =>
  value.replace(/\s+/g, " ").trim();

const getLineKey = (value: string) =>
  normalizeSummaryLine(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();

const isLikelyPageMarker = (line: string) =>
  /^\d{1,4}$/.test(line) ||
  /^(?:page|sida|sid\.?|p\.?)\s*\d{1,4}\b/i.test(line) ||
  /^[-–—]?\s*\d{1,4}\s*[-–—]?$/.test(line);

const isLikelyOcrFragment = (line: string) => {
  const normalized = normalizeSummaryLine(line);
  if (!normalized) return true;

  const letters = normalized.match(/\p{L}/gu)?.length ?? 0;
  const digits = normalized.match(/\d/g)?.length ?? 0;
  const symbols = normalized.replace(/[\p{L}\d\s]/gu, "").length;
  const words = normalized.split(/\s+/).filter(Boolean);

  if (isLikelyPageMarker(normalized)) return true;
  if (normalized.length <= 2) return true;
  if (words.length === 1 && normalized.length <= 4 && !/[.!?]$/.test(normalized)) return true;
  if (letters === 0 && digits > 0) return true;
  if (letters > 0 && digits + symbols > letters * 1.4 && letters < 12) return true;
  if (normalized.length >= 7 && letters / normalized.length < 0.35) return true;

  return false;
};

const removeRepeatedPhrases = (text: string) =>
  text
    .replace(/\b(.{12,90}?)\s+\1\b/giu, "$1")
    .replace(/([^\n]{20,120})(?:\n\1){1,}/giu, "$1");

const cleanOcrText = (rawText: string) => {
  const sourceLines = rawText
    .replace(/\r/g, "\n")
    .replace(/(\p{L})-\n(\p{L})/gu, "$1$2")
    .split("\n")
    .map(normalizeSummaryLine);

  const lineCounts = new Map<string, number>();
  sourceLines.forEach((line) => {
    const key = getLineKey(line);
    if (key.length >= 4) {
      lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1);
    }
  });

  const seen = new Set<string>();
  const cleanedLines = sourceLines.filter((line) => {
    if (!line) return false;
    const key = getLineKey(line);
    if (!key) return false;
    if (isLikelyOcrFragment(line)) return false;
    if ((lineCounts.get(key) ?? 0) >= 3 && line.length <= 90) return false;
    if (seen.has(key) && line.length <= 180) return false;
    seen.add(key);
    return true;
  });

  return removeRepeatedPhrases(cleanedLines.join("\n"))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const getSummarizableStats = (text: string) => {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const words = text.match(/[\p{L}\p{N}]{2,}/gu)?.length ?? 0;
  const ratio = text.length > 0 ? letters / text.length : 0;
  return { letters, words, ratio };
};

const isTextTooUnclearToSummarize = (text: string) => {
  const stats = getSummarizableStats(text);
  return stats.words < MIN_SUMMARIZABLE_WORDS || stats.ratio < MIN_SUMMARIZABLE_LETTER_RATIO;
};

const detectSummaryLanguage = (text: string) => {
  const sample = text.slice(0, 4000).toLowerCase();
  const swedishScore = (sample.match(/[åäö]/g)?.length ?? 0) * 3
    + (sample.match(/\b(och|att|det|som|för|med|inte|är|ska|kan|till|från|har)\b/g)?.length ?? 0);
  const spanishScore = (sample.match(/[ñáéíóúü]/g)?.length ?? 0) * 3
    + (sample.match(/\b(el|la|los|las|que|con|para|como|del|una|porque)\b/g)?.length ?? 0);

  if (swedishScore >= spanishScore + 2 && swedishScore >= 3) return "sv";
  if (spanishScore >= swedishScore + 2 && spanishScore >= 3) return "es";
  return "en";
};

const createUnclearTextNotes = (text: string): EpisodeNotes => {
  const language = detectSummaryLanguage(text);
  if (language === "sv") {
    return {
      title: "Texten är för otydlig",
      summary: "Texten är för otydlig för att sammanfattas på ett tillförlitligt sätt. Prova att ta en skarpare bild med bättre ljus och se till att hela sidan syns utan skuggor.",
      sections: [
        {
          heading: "Förslag",
          bullets: [
            "Ta bilden rakt ovanifrån så att raderna inte lutar.",
            "Använd bättre ljus och undvik blänk eller skuggor.",
            "Se till att texten är i fokus och att sidkanterna inte klipps bort."
          ]
        }
      ]
    };
  }

  if (language === "es") {
    return {
      title: "El texto no es suficientemente claro",
      summary: "El texto es demasiado confuso para resumirlo de forma fiable. Intenta tomar una foto más nítida, con mejor iluminación y toda la página visible.",
      sections: [
        {
          heading: "Sugerencias",
          bullets: [
            "Toma la foto desde arriba para que las líneas queden rectas.",
            "Usa mejor iluminación y evita sombras o reflejos.",
            "Asegúrate de que el texto esté enfocado y que no falten bordes de la página."
          ]
        }
      ]
    };
  }

  return {
    title: "The text is too unclear",
    summary: "The text is too unclear to summarize reliably. Try taking a sharper photo with better lighting and make sure the whole page is visible.",
    sections: [
      {
        heading: "Suggestions",
        bullets: [
          "Take the photo straight from above so the lines are not tilted.",
          "Use better lighting and avoid glare or shadows.",
          "Make sure the text is in focus and the page edges are not cut off."
        ]
      }
    ]
  };
};

const splitTextIntoChunks = (text: string) => {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) {
      chunks.push(current.trim());
      current = "";
    }
  };

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= SUMMARY_CHUNK_TARGET_CHARACTERS) {
      current = candidate;
      continue;
    }

    pushCurrent();
    if (paragraph.length <= SUMMARY_CHUNK_TARGET_CHARACTERS) {
      current = paragraph;
      continue;
    }

    for (let index = 0; index < paragraph.length; index += SUMMARY_CHUNK_TARGET_CHARACTERS) {
      chunks.push(paragraph.slice(index, index + SUMMARY_CHUNK_TARGET_CHARACTERS).trim());
    }
  }

  pushCurrent();

  return chunks.slice(0, MAX_SUMMARY_CHUNKS).map((chunk, index, allChunks) => {
    if (index === 0 || SUMMARY_CHUNK_OVERLAP_CHARACTERS <= 0) return chunk;
    const previous = allChunks[index - 1] ?? "";
    const overlap = previous.slice(-SUMMARY_CHUNK_OVERLAP_CHARACTERS).trim();
    return overlap ? `${overlap}\n\n${chunk}` : chunk;
  });
};

const createEducationalSummaryPrompt = (text: string, contextLabel: string) => `You are an expert educational summarizer.

Your task is NOT to extract random sentences from the text.
Your task is to understand the content, identify the most important ideas, explain them clearly, and create useful learning notes for a human reader.

Important rules:
- Write in the same language as the source text unless the source clearly mixes languages.
- Never copy long sentences directly from the source text.
- Never include page numbers, chapter numbers, repeated headers, repeated footers, OCR artifacts, broken fragments, references, or scanning artifacts.
- Ignore repeated text and broken formatting.
- Write naturally and pedagogically, like an intelligent tutor.
- Prioritize clarity over completeness.
- Focus on meaning, concepts, and practical understanding.
- If the source text is unclear, reconstruct the likely meaning from supported context instead of copying broken text.
- Do not hallucinate facts that are not supported by the text.
- Return ONLY JSON matching the response schema.

JSON content requirements:
- "title": a short descriptive title.
- "summary": Short Overview. Write 3 to 5 clear sentences explaining the main topic.
- "sections": include these learning sections when possible:
  1. Main Concepts: explain the most important concepts in simple language.
  2. Key Takeaways: concise bullets with the most important lessons.
  3. Practical Meaning: explain why the information matters in practice.
- Do not include study questions or quiz questions.
- Use specific, meaningful bullets. Avoid vague bullets.

${contextLabel}:
${text}`;

const generateChunkSummary = async (
  ai: ReturnType<typeof getAiClient>,
  chunk: string,
  index: number,
  total: number
) => {
  const response = await ai.models.generateContent({
    model: EDUCATIONAL_SUMMARY_MODEL,
    contents: `You are preparing notes from OCR text before a final summary is written.

Do not copy long source sentences. Ignore page numbers, repeated headers/footers, OCR fragments, broken formatting, references, and duplicated lines.
Explain the meaning of this chunk clearly. Preserve important concepts, arguments, examples, names, dates, and relationships.
Write in the same language as the source text. Return concise plain text notes only.

Chunk ${index + 1} of ${total}:
${chunk}`,
  });

  return extractGeneratedText(response as GenerateContentResponse);
};

const generateFinalSummary = async (
  ai: ReturnType<typeof getAiClient>,
  sourceText: string,
  contextLabel: string
) => {
  const response = await ai.models.generateContent({
    model: EDUCATIONAL_SUMMARY_MODEL,
    contents: createEducationalSummaryPrompt(sourceText, contextLabel),
    config: {
      responseMimeType: "application/json",
      responseSchema: NOTES_RESPONSE_SCHEMA,
    },
  });

  return parseStructuredNotes(response.text || "");
};

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);

  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
};

const callGeminiRest = async (
  model: string,
  body: Record<string, unknown>,
  options?: GeminiHandlerOptions
) => {
  const apiKey = getApiKey(options?.apiKey);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Gemini REST ${response.status}: ${responseText}`);
  }

  try {
    return JSON.parse(responseText) as GenerateContentResponse;
  } catch {
    throw new Error("Gemini REST returnerade ogiltig JSON.");
  }
};

const extractPdfTextFromBase64 = async (
  base64Data: string,
  options?: GeminiHandlerOptions
) => {
  const response = await callGeminiRest(
    "gemini-2.5-flash",
    {
      contents: [
        {
          parts: [
            {
              text:
                "Extrahera all text från detta dokument. Hantera olika sidorienteringar och layouter. Städa upp sidhuvuden, sidfötter och sidnummer så att resultatet blir en flytande text lämplig för en ljudbok eller podd. Returnera ENDAST texten."
            },
            {
              inline_data: {
                mime_type: "application/pdf",
                data: base64Data,
              }
            }
          ]
        }
      ]
    },
    options
  );

  const text = extractGeneratedText(response);
  if (!text) {
    throw new Error("PDF-filen gav ingen extraherbar text.");
  }

  return text;
};

const handleTts = async (body: TtsBody, auth: AuthenticatedRequest, options?: GeminiHandlerOptions) => {
  if (!isNonEmptyString(body.text)) return badRequest("Text saknas.");
  if (!validateVoice(body.voice)) return badRequest("Ogiltig röst.");
  if (!validateSpeed(body.speed)) return badRequest("Ogiltig uppläsningshastighet.");

  const speed = body.speed ?? ReadingSpeed.Normal;
  const languageHint = isNonEmptyString(body.languageHint)
    ? `PRIMARY NARRATION LANGUAGE: ${body.languageHint}. Treat this as the main pronunciation anchor unless a tagged fragment explicitly switches language.`
    : "";
  const systemPrompt = `${HIGH_FIDELITY_DIRECTIVE}\n${languageHint}\n${SPEED_INSTRUCTIONS[speed]}`;
  const fullPrompt = `${systemPrompt}\n\nTEXT:\n${body.text}`;

  const response = await callGeminiRest(TTS_MODEL, {
    contents: [
      {
        parts: [{ text: fullPrompt }],
      },
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: body.voice },
        },
      },
    },
  }, options);

  const audio = extractGeneratedAudio(response);
  if (!audio) {
    throw new Error("Inget ljud genererades.");
  }

  const usage = buildTtsUsage(response);
  if (usage) {
    await logTtsUsage(auth, body, usage);
  }

  return json({ audio, usage });
};

const handleTranslate = async (body: TranslateBody, options?: GeminiHandlerOptions) => {
  if (!isNonEmptyString(body.text)) return badRequest("Text saknas.");
  if (!isNonEmptyString(body.targetLanguage)) return badRequest("Målspråk saknas.");

  const ai = getAiClient(options?.apiKey);
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Translate to ${body.targetLanguage}. Return ONLY text.\n\nTEXT:\n${body.text}`,
  });

  return json({ text: response.text || "" });
};

const handleExtractImage = async (body: ExtractImageBody, options?: GeminiHandlerOptions) => {
  if (!isNonEmptyString(body.base64Data)) return badRequest("Bilddata saknas.");
  if (!isNonEmptyString(body.mimeType)) return badRequest("Bildens MIME-typ saknas.");

  const ai = getAiClient(options?.apiKey);
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          { inlineData: { data: body.base64Data, mimeType: body.mimeType } },
          {
            text:
              "Läs all text i bilden noggrant. Om texten är roterad, vänd eller ligger sidledes, korrigera detta mentalt och extrahera texten i rätt ordning. Behåll styckesindelningen och formateringen så gott det går. Returnera ENDAST den extraherade texten."
          }
        ]
      }
    ],
  });

  return json({ text: response.text || "" });
};

const streamGeminiText = async (
  requestFactory: (ai: GoogleGenAI) => Promise<AsyncIterable<{ text?: string }>>,
  options?: GeminiHandlerOptions
) => {
  const ai = getAiClient(options?.apiKey);
  const encoder = new TextEncoder();
  const stream = await requestFactory(ai);

  return new Response(new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = chunk.text;
          if (!text) continue;
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "chunk", text })}\n`));
        }

        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "done" })}\n`));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    }
  }), {
    headers: STREAM_HEADERS,
  });
};

const handleExtractImageStream = async (body: ExtractImageStreamBody, options?: GeminiHandlerOptions) => {
  if (!isNonEmptyString(body.base64Data)) return badRequest("Bilddata saknas.");
  if (!isNonEmptyString(body.mimeType)) return badRequest("Bildens MIME-typ saknas.");

  return streamGeminiText(async (ai) => (
    ai.models.generateContentStream({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { inlineData: { data: body.base64Data, mimeType: body.mimeType } },
            {
              text:
                "Läs all text i bilden noggrant. Om texten är roterad, vänd eller ligger sidledes, korrigera detta mentalt och extrahera texten i rätt ordning. Behåll styckesindelningen och formateringen så gott det går. Returnera ENDAST den extraherade texten."
            }
          ]
        }
      ],
    })
  ), options);
};

const handleExtractPdf = async (body: ExtractPdfBody, options?: GeminiHandlerOptions) => {
  if (!isNonEmptyString(body.base64Data)) return badRequest("PDF-data saknas.");
  const text = await extractPdfTextFromBase64(body.base64Data, options);
  return json({ text });
};

const handleExtractWebPage = async (body: ExtractWebPageBody, options?: GeminiHandlerOptions) => {
  if (!isNonEmptyString(body.url) || !isHttpUrl(body.url)) {
    return badRequest("Ogiltig länk.");
  }

  let response: Response;
  try {
    response = await fetch(body.url, {
      redirect: "follow",
      headers: {
        "accept": "text/html,application/pdf;q=0.9,*/*;q=0.8",
        "accept-language": "sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7",
        "user-agent": "Mozilla/5.0 (compatible; VoxPod/1.0; +https://voxpod.app)",
      },
    });
  } catch {
    throw new Error("Länken kunde inte laddas.");
  }

  if (!response.ok) {
    throw new Error(`Länken kunde inte laddas (${response.status}).`);
  }

  const finalUrl = response.url || body.url;
  const contentType = response.headers.get("content-type") ?? "";
  if (/application\/pdf/i.test(contentType) || /\.pdf(?:$|[?#])/i.test(finalUrl)) {
    const text = await extractPdfTextFromBase64(
      arrayBufferToBase64(await response.arrayBuffer()),
      options
    );
    return json({ text });
  }

  const text = extractReadableHtmlText(await response.text());
  if (!text) {
    throw new Error("Webbsidan gav ingen läsbar text.");
  }

  return json({ text });
};

const handleExtractPdfStream = async (body: ExtractPdfStreamBody, options?: GeminiHandlerOptions) => {
  if (!isNonEmptyString(body.base64Data)) return badRequest("PDF-data saknas.");

  return streamGeminiText(async (ai) => (
    ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: [
        {
          parts: [
            {
              text:
                "Extrahera all text från detta dokument. Hantera olika sidorienteringar och layouter. Städa upp sidhuvuden, sidfötter och sidnummer så att resultatet blir en flytande text lämplig för en ljudbok eller podd. Returnera ENDAST texten."
            },
            {
              inlineData: {
                mimeType: "application/pdf",
                data: body.base64Data,
              }
            }
          ]
        }
      ]
    })
  ), options);
};

const handleGenerateNotes = async (body: GenerateNotesBody, options?: GeminiHandlerOptions) => {
  if (!isNonEmptyString(body.text)) return badRequest("Text saknas.");

  const ai = getAiClient(options?.apiKey);
  const cleanedText = cleanOcrText(body.text);

  if (isTextTooUnclearToSummarize(cleanedText)) {
    return json({ notes: createUnclearTextNotes(cleanedText || body.text) });
  }

  const chunks = splitTextIntoChunks(cleanedText);
  if (chunks.length <= 1) {
    const notes = await generateFinalSummary(ai, cleanedText, "SOURCE TEXT");
    return json({ notes });
  }

  const chunkSummaries: string[] = [];
  for (let index = 0; index < chunks.length; index++) {
    const chunkSummary = await generateChunkSummary(ai, chunks[index], index, chunks.length);
    if (chunkSummary) {
      chunkSummaries.push(`Chunk ${index + 1}:\n${chunkSummary}`);
    }
  }

  const finalSource = chunkSummaries.length > 0
    ? chunkSummaries.join("\n\n")
    : cleanedText;
  const notes = await generateFinalSummary(ai, finalSource, "CHUNK SUMMARIES FROM THE SOURCE TEXT");
  return json({ notes });
};

export const handleGeminiRequest = async (
  request: Request,
  options?: GeminiHandlerOptions
): Promise<Response> => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const authenticatedRequest = await validateAuthenticatedRequest(request);
  if (!authenticatedRequest) {
    return unauthorized();
  }

  const body = await parseJsonBody(request);
  if (!body) {
    return badRequest("Ogiltig JSON-body.");
  }

  try {
    switch (body.action as GeminiAction) {
      case "tts":
        return await handleTts(body as TtsBody, authenticatedRequest, options);
      case "translate":
        return await handleTranslate(body as TranslateBody, options);
      case "extractImage":
        return await handleExtractImage(body as ExtractImageBody, options);
      case "extractPdf":
        return await handleExtractPdf(body as ExtractPdfBody, options);
      case "extractWebPage":
        return await handleExtractWebPage(body as ExtractWebPageBody, options);
      case "extractImageStream":
        return await handleExtractImageStream(body as ExtractImageStreamBody, options);
      case "extractPdfStream":
        return await handleExtractPdfStream(body as ExtractPdfStreamBody, options);
      case "generateNotes":
        return await handleGenerateNotes(body as GenerateNotesBody, options);
      default:
        return badRequest("Okänd Gemini-action.");
    }
  } catch (error) {
    return normalizeApiError(error);
  }
};
