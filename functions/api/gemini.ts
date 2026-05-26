import { handleGeminiRequest } from "../../server/geminiApi";

type CloudflareEnv = {
  GEMINI_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
};

type CloudflarePagesContext = {
  request: Request;
  env: CloudflareEnv;
};

export const onRequest = async (context: CloudflarePagesContext) => {
  try {
    return await handleGeminiRequest(context.request, {
      apiKey: context.env.GEMINI_API_KEY,
      turnstileSecretKey: context.env.TURNSTILE_SECRET_KEY,
      turnstileSiteKey: context.env.TURNSTILE_SITE_KEY,
    });
  } catch (error) {
    console.error("Unhandled Gemini function error:", error);
    return new Response(JSON.stringify({ error: "Ett oväntat serverfel uppstod i API-funktionen." }), {
      status: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  }
};
