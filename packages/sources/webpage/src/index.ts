import { htmlToText } from "html-to-text";

export interface ReadablePage { url: string; title: string | null; text: string; truncated: boolean }

const MAX_CHARS = 6000;

export class WebPageSource {
  async fetchReadable(url: string, signal: AbortSignal, maxChars = MAX_CHARS): Promise<ReadablePage> {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error("Not a valid URL"); }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Only http(s) URLs can be fetched");

    const response = await fetch(parsed, { signal, redirect: "follow", headers: { "user-agent": "Cronoblox/0.1 research-agent" } });
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const isHtml = contentType.includes("html");
    const isJson = contentType === "application/json" || contentType.endsWith("+json");
    if (!isHtml && !contentType.startsWith("text/") && !isJson) throw new Error(`Unsupported content-type: ${contentType || "unknown"}`);

    const html = await response.text();
    const titleMatch = isHtml ? html.match(/<title[^>]*>([^<]*)<\/title>/i) : null;
    const text = isHtml ? htmlToText(html, {
      wordwrap: false,
      selectors: [
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "img", format: "skip" },
        { selector: "a", options: { ignoreHref: true } },
      ],
    }).replace(/\n{3,}/g, "\n\n").trim() : html.trim();

    const truncated = text.length > maxChars;
    return { url: parsed.toString(), title: titleMatch?.[1]?.trim() || null, text: truncated ? text.slice(0, maxChars) : text, truncated };
  }
}
