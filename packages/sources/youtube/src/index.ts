import { z } from "zod";

const searchSchema = z.object({ items: z.array(z.object({ id: z.object({ videoId: z.string() }), snippet: z.object({ publishedAt: z.string(), channelId: z.string(), channelTitle: z.string(), title: z.string(), description: z.string() }) })).default([]) });
const videoSchema = z.object({ items: z.array(z.object({ id: z.string(), statistics: z.object({ viewCount: z.string().optional(), likeCount: z.string().optional(), commentCount: z.string().optional() }).default({}) })).default([]) });
export type VideoResult = { id: string; publishedAt: string; channelId: string; channelTitle: string; title: string; description: string; views: number | null; likes: number | null; comments: number | null };

export class YouTubeSource {
  constructor(private readonly key = process.env.YOUTUBE_API_KEY) {}
  get available() { return Boolean(this.key); }
  async search(query: string, signal: AbortSignal): Promise<VideoResult[]> {
    if (!this.key) throw new Error("YouTube Data API is not configured");
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "snippet"); searchUrl.searchParams.set("type", "video"); searchUrl.searchParams.set("maxResults", "10"); searchUrl.searchParams.set("order", "date"); searchUrl.searchParams.set("q", query); searchUrl.searchParams.set("key", this.key);
    const response = await fetch(searchUrl, { signal });
    if (!response.ok) throw new Error(`YouTube Data API returned ${response.status}`);
    const search = searchSchema.parse(await response.json());
    if (!search.items.length) return [];
    const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    videosUrl.searchParams.set("part", "statistics"); videosUrl.searchParams.set("id", search.items.map((item) => item.id.videoId).join(",")); videosUrl.searchParams.set("key", this.key);
    const videosResponse = await fetch(videosUrl, { signal });
    const stats = videosResponse.ok ? videoSchema.parse(await videosResponse.json()).items : [];
    const byId = new Map(stats.map((item) => [item.id, item.statistics]));
    return search.items.map((item) => { const s = byId.get(item.id.videoId); return { id: item.id.videoId, ...item.snippet, views: s?.viewCount ? Number(s.viewCount) : null, likes: s?.likeCount ? Number(s.likeCount) : null, comments: s?.commentCount ? Number(s.commentCount) : null }; });
  }
}
