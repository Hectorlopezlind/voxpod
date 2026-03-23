import { handleGeminiRequest } from "../../server/geminiApi";

type CloudflareEnv = {
  GEMINI_API_KEY?: string;
};

type CloudflarePagesContext = {
  request: Request;
  env: CloudflareEnv;
};

export const onRequest = async (context: CloudflarePagesContext) => {
  return handleGeminiRequest(context.request, {
    apiKey: context.env.GEMINI_API_KEY,
  });
};
