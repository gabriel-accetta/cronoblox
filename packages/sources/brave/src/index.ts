import { z } from "zod";

const responseSchema = z.object({ web: z.object({ results: z.array(z.object({ title: z.string(), url: z.string().url(), description: z.string().default(""), age: z.string().optional() })) }).optional() });
export type SearchResult = { title: string; url: string; description: string; age?: string };

export class BraveSource {
  constructor(private readonly key = process.env.BRAVE_SEARCH_API_KEY) {}
  get available() { return Boolean(this.key); }
  async search(query: string, signal: AbortSignal): Promise<SearchResult[]> {
    if (!this.key) throw new Error("Brave Search is not configured");
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query); url.searchParams.set("count", "10"); url.searchParams.set("freshness", "py");
    const response = await fetch(url, { signal, headers: { Accept: "application/json", "X-Subscription-Token": this.key } });
    if (!response.ok) throw new Error(`Brave Search returned ${response.status}`);
    return responseSchema.parse(await response.json()).web?.results ?? [];
  }
}
