import type { IncomingMessage, ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { handleGeminiRequest } from "./geminiApi";

const readRequestBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
};

const createHeaders = (headers: IncomingMessage["headers"]) => {
  const requestHeaders = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      requestHeaders.set(key, value.join(", "));
    } else if (typeof value === "string") {
      requestHeaders.set(key, value);
    }
  }

  return requestHeaders;
};

const sendResponse = async (res: ServerResponse, response: Response) => {
  res.statusCode = response.status;

  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  const payload = await response.arrayBuffer();
  res.end(Buffer.from(payload));
};

export const viteGeminiMiddleware = async (
  req: IncomingMessage,
  res: ServerResponse
) => {
  const body = req.method === "GET" || req.method === "HEAD"
    ? undefined
    : await readRequestBody(req);

  const request = new Request("http://localhost/api/gemini", {
    method: req.method,
    headers: createHeaders(req.headers),
    body,
  });

  const response = await handleGeminiRequest(request);
  await sendResponse(res, response);
};
