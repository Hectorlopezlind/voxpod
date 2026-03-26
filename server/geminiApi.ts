import { GoogleGenAI, Modality } from "@google/genai";
import { VoiceName, ReadingSpeed, EpisodeNotes, EpisodeNotesSection } from "../types";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

type GeminiHandlerOptions = {
  apiKey?: string | null;
};

const HIGH_FIDELITY_DIRECTIVE = `
PERFORMANCE DIRECTIVES (ULTRA-SMOOTH):
1. ACOUSTIC SHIELDING: Heavily soften all sibilants (s, t, sh). Eliminate high-frequency whistling and sharp sounds.
2. VOCAL ROUNDING: Create a warm, full-bodied voice. Eliminate digital hardness and metallic artifacts.
3. MULTILINGUAL MASTERY & AUTO-DETECTION: 
   - Automatically identify the language of the text (Swedish, English, Spanish, French, German, etc.).
   - If the text is SWEDISH: Perfect pronunciation of Å, Ä, and Ö. Natural prosody without robotic pauses.
   - For SWEDISH specifically: use the soft "sk" sound before e, i, y, ä, ö as in "Skärholmen"; use the soft "k" sound before e, i, y, ä, ö as in "köpkraft"; use the soft "g" sound before e, i, y, ä, ö as in "gynnat".
   - Preserve correct Swedish place names and personal names. Do not anglicize or flatten Swedish consonant sounds.
   - If the text is ENGLISH: Use a natural, native English accent. Ensure numbers and dates are read in English (e.g., "123" as "one hundred twenty-three").
   - If the text is SPANISH: Correct pronunciation of 'ñ', 'rr', and accents.
   - For ALL languages: Use the correct phonetics, stress, and intonation for that specific language. DO NOT use a Swedish accent for non-Swedish text.
4. NO PREAMBLE: Start reading the text immediately. No introductions like "Here is your text".
5. STYLE: Warm, clear, and engaging documentary style.
`;

const SPEED_INSTRUCTIONS: Record<ReadingSpeed, string> = {
  [ReadingSpeed.Slow]: "TEMPO: Långsamt.",
  [ReadingSpeed.Normal]: "TEMPO: Normalt.",
  [ReadingSpeed.Fast]: "TEMPO: Snabbt."
};

type GeminiAction =
  | "tts"
  | "translate"
  | "extractImage"
  | "extractPdf"
  | "extractImageStream"
  | "extractPdfStream"
  | "generateNotes";

type GeminiRequestBody =
  | { action: "tts"; text: string; voice: VoiceName; speed?: ReadingSpeed }
  | { action: "translate"; text: string; targetLanguage: string }
  | { action: "extractImage"; base64Data: string; mimeType: string }
  | { action: "extractPdf"; base64Data: string }
  | { action: "extractImageStream"; base64Data: string; mimeType: string }
  | { action: "extractPdfStream"; base64Data: string }
  | { action: "generateNotes"; text: string };

type TtsBody = Extract<GeminiRequestBody, { action: "tts" }>;
type TranslateBody = Extract<GeminiRequestBody, { action: "translate" }>;
type ExtractImageBody = Extract<GeminiRequestBody, { action: "extractImage" }>;
type ExtractPdfBody = Extract<GeminiRequestBody, { action: "extractPdf" }>;
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
  const apiKey = apiKeyOverride ?? process.env.GEMINI_API_KEY;
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

const normalizeApiError = (error: unknown) => {
  console.error("Gemini API Error:", error);
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (
    message.includes("401") ||
    message.includes("api_key_invalid") ||
    message.includes("api key") ||
    message.includes("not found")
  ) {
    return json({ error: "Gemini API-nyckeln saknas eller är ogiltig." }, 500);
  }
  if (message.includes("429") || message.includes("quota")) {
    return json({ error: "Gemini-gränsen är nådd. Vänta en minut och försök igen." }, 429);
  }
  if (message.includes("pdf")) {
    return json({ error: "PDF-läsning misslyckades på serversidan. Prova en mindre eller enklare PDF." }, 500);
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
    .slice(0, 6);

  return {
    title: "Anteckningar",
    summary: lines.slice(0, 2).join(" ").slice(0, 280) || cleaned.slice(0, 280),
    sections: [
      {
        heading: "Viktiga punkter",
        bullets: bulletLines.length > 0 ? bulletLines : [cleaned.slice(0, 180)]
      }
    ]
  };
};

type GenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

const extractGeneratedText = (response: GenerateContentResponse) =>
  response.candidates
    ?.flatMap(candidate => candidate.content?.parts ?? [])
    .map(part => part.text?.trim() ?? "")
    .find(Boolean) ?? "";

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

const handleTts = async (body: TtsBody, options?: GeminiHandlerOptions) => {
  if (!isNonEmptyString(body.text)) return badRequest("Text saknas.");
  if (!validateVoice(body.voice)) return badRequest("Ogiltig röst.");
  if (!validateSpeed(body.speed)) return badRequest("Ogiltig uppläsningshastighet.");

  const ai = getAiClient(options?.apiKey);
  const speed = body.speed ?? ReadingSpeed.Normal;
  const systemPrompt = `${HIGH_FIDELITY_DIRECTIVE}\n${SPEED_INSTRUCTIONS[speed]}`;
  const fullPrompt = `${systemPrompt}\n\nTEXT:\n${body.text}`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: fullPrompt }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: body.voice },
        },
      },
    },
  });

  const audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audio) {
    throw new Error("Inget ljud genererades.");
  }

  return json({ audio });
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
                data: body.base64Data,
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
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analysera följande text och returnera ENDAST giltig JSON utan markdown eller kodblock.

Format:
{
  "title": "kort rubrik",
  "summary": "3-5 meningar som sammanfattar det viktigaste i texten",
  "sections": [
    {
      "heading": "Viktigaste punkterna",
      "bullets": ["punkt 1", "punkt 2", "punkt 3"]
    }
  ]
}

Regler:
- Skriv på samma språk som texten.
- Fokusera på att skapa en kort, tydlig sammanfattning av texten, inte lösa anteckningar.
- Sammanfattningen ska lyfta fram huvudidéer, slutsatser och det viktigaste innehållet först.
- Skapa exakt 1 sektion.
- Sektionen ska innehålla 3 till 5 bullets med de viktigaste punkterna, inga detaljer som inte är centrala.
- Varje bullet ska vara en hel mening eller en tydlig fras utan asterisker i texten.
- Skriv tydliga, konkreta rubriker som passar innehållet.
- Undvik generiska rubriker som "Sektion 1", "Del 1" eller "Punktlista".
- Sammanfattningen ska kännas välskriven och lätt att skumma.
- Returnera bara JSON.

TEXT:
${body.text}`,
  });

  return json({ notes: parseStructuredNotes(response.text || "") });
};

export const handleGeminiRequest = async (
  request: Request,
  options?: GeminiHandlerOptions
): Promise<Response> => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const body = await parseJsonBody(request);
  if (!body) {
    return badRequest("Ogiltig JSON-body.");
  }

  try {
    switch (body.action as GeminiAction) {
      case "tts":
        return await handleTts(body as TtsBody, options);
      case "translate":
        return await handleTranslate(body as TranslateBody, options);
      case "extractImage":
        return await handleExtractImage(body as ExtractImageBody, options);
      case "extractPdf":
        return await handleExtractPdf(body as ExtractPdfBody, options);
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
