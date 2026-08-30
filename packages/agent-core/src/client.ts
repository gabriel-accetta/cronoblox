import OpenAI from "openai";

export function createOpenRouterClient(apiKey = process.env.OPENROUTER_API_KEY) {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for live agent runs. Use the visibly labeled Demo replay profile for a keyless walkthrough.");
  return new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3017",
      "X-OpenRouter-Title": "Cronoblox",
    },
  });
}
