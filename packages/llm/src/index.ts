import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { ThesisSchema, type Evidence, type Thesis, type UserMode } from "@cronoblox/contracts";

export interface LlmUsage { input_tokens: number; output_tokens: number; estimated_cost_usd: number }
export interface AnalystLlm {
  createThesis(input: { game: Record<string, unknown>; evidence: Evidence[]; mode: UserMode; baseline: boolean }): Promise<{ thesis: Thesis; usage: LlmUsage; metadata: Record<string, unknown> }>;
}

const system = `You are the Cronoblox analyst. Assess early breakout potential without a numeric probability. Separate potential from confidence. Every claim must cite only provided evidence IDs. Missing data reduces confidence and is never negative evidence. Current snapshots do not establish historical growth. Return only the requested structured object.`;

export class OpenRouterAnalyst implements AnalystLlm {
  private readonly client: OpenAI;
  constructor(private readonly model: string, apiKey = process.env.OPENROUTER_API_KEY) {
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for live synthesis. Use the visibly labeled Demo replay profile for a keyless walkthrough.");
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3017",
        "X-OpenRouter-Title": "Cronoblox",
      },
    });
  }

  async createThesis(input: { game: Record<string, unknown>; evidence: Evidence[]; mode: UserMode; baseline: boolean }) {
    const response = await this.client.chat.completions.parse({
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ user_mode: input.mode, baseline_constraints: input.baseline ? "Use current Roblox bundle only; no research or critic." : "Synthesize all supplied evidence.", game: input.game, evidence: input.evidence }) },
      ],
      response_format: zodResponseFormat(ThesisSchema, "cronoblox_thesis"),
    });
    const thesis = response.choices[0]?.message.parsed;
    if (!thesis) throw new Error("The model returned no validated thesis.");
    const usage = { input_tokens: response.usage?.prompt_tokens ?? 0, output_tokens: response.usage?.completion_tokens ?? 0, estimated_cost_usd: 0 };
    return { thesis, usage, metadata: { response_id: response.id, model: this.model, provider: "openrouter" } };
  }
}

export class FixtureAnalyst implements AnalystLlm {
  async createThesis(input: { evidence: Evidence[]; mode: UserMode }) {
    const support = input.evidence.filter((item) => item.relationship === "supports");
    const context = input.evidence.filter((item) => item.relationship === "contextualizes");
    const thesis = ThesisSchema.parse({
      breakout_potential: "HIGH", confidence: "HIGH", recommendation: input.mode === "developer" ? "Protect retention while testing whether post-update discovery persists." : "Watch closely and advance to deeper diligence only if attention persists beyond the update window.",
      supporting_claims: [
        { id: "cl_momentum", text: "The game combines a meaningful live audience with strong normalized approval.", evidence_ids: support.slice(0, 2).map((item) => item.id) },
        { id: "cl_diversity", text: "Recent attention is distributed across multiple creators rather than one obvious source.", evidence_ids: context.slice(-2).map((item) => item.id) },
      ],
      risk_claims: [
        { id: "cl_persistence", text: "The current snapshot does not establish durable growth after the latest update.", evidence_ids: input.evidence.slice(0, 2).map((item) => item.id) },
        { id: "cl_short_window", text: "External coverage is promising but observed over a short window.", evidence_ids: context.slice(-2).map((item) => item.id) },
      ],
    });
    return { thesis, usage: { input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 }, metadata: { provider: "deterministic-fixture", clearly_labeled: true } };
  }
}
