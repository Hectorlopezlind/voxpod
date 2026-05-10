import { GoogleGenAI, Modality, Type } from "@google/genai";
import { VoiceName, ReadingSpeed, EpisodeNotes, EpisodeNotesSection } from "../types";
import { extractReadableHtmlText } from "../services/documentService";

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
  | { action: "tts"; text: string; voice: VoiceName; speed?: ReadingSpeed; languageHint?: string }
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
    .slice(0, 10);

  const highlightBullets = bulletLines.slice(0, 5);
  const detailBullets = bulletLines.slice(5, 10);

  return {
    title: "Anteckningar",
    summary: lines.slice(0, 5).join(" ").slice(0, 640) || cleaned.slice(0, 640),
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
        : [])
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

const handleTts = async (body: TtsBody, options?: GeminiHandlerOptions) => {
  if (!isNonEmptyString(body.text)) return badRequest("Text saknas.");
  if (!validateVoice(body.voice)) return badRequest("Ogiltig röst.");
  if (!validateSpeed(body.speed)) return badRequest("Ogiltig uppläsningshastighet.");

  const ai = getAiClient(options?.apiKey);
  const speed = body.speed ?? ReadingSpeed.Normal;
  const languageHint = isNonEmptyString(body.languageHint)
    ? `PRIMARY NARRATION LANGUAGE: ${body.languageHint}. Treat this as the main pronunciation anchor unless a tagged fragment explicitly switches language.`
    : "";
  const systemPrompt = `${HIGH_FIDELITY_DIRECTIVE}\n${languageHint}\n${SPEED_INSTRUCTIONS[speed]}`;
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
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analysera följande text och skriv kunskapstäta studieanteckningar. Returnera ENDAST JSON som matchar schemat.

Regler:
- Skriv på samma språk som källtexten.
- Skriv för en elev som vill repetera innehållet snabbt men utan att viktig information går förlorad.
- Sammanfattningen ska vara 6 till 10 meningar och kunna stå på egna ben.
- Sammanfattningen ska fånga huvudidéer, slutsatser, samband, varför innehållet är viktigt och vad man bör minnas.
- Skapa 3 till 5 sektioner när materialet räcker till det. Använd färre bara om texten faktiskt är smal.
- Varje sektion ska innehålla 4 till 6 bullets med konkret information.
- Varje bullet ska bära fakta, resonemang, definitioner, exempel, steg, jämförelser, orsaker eller konsekvenser. Undvik vaga bullets.
- Bevara namn, årtal, siffror, centrala begrepp och viktiga skillnader när sådant finns i texten.
- Om texten beskriver en process eller utveckling, återge ordningen tydligt.
- Om texten innehåller tydliga delteman eller rubriker, använd dem eller förbättrade versioner av dem.
- Rubriker ska vara informativa och lätta att skumma. Undvik generiska rubriker som "Sektion 1", "Del 1" eller "Punktlista".
- Repetera inte samma information i flera bullets om det går att undvika, men offra inte viktig kunskap för att bli kort.
- Ingen markdown. Inga kodblock. Bara JSON.

TEXT:
${body.text}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: NOTES_RESPONSE_SCHEMA,
    },
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
