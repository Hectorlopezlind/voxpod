import { handleGeminiRequest } from "../server/geminiApi";

export default {
  fetch(request: Request) {
    return handleGeminiRequest(request);
  },
};
