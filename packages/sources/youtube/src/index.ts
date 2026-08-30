import { execFile } from "node:child_process";
import { z } from "zod";

export type VideoResult = {
  id: string; publishedAt: string | null; channelId: string | null; channelTitle: string;
  title: string; description: string; views: number | null; likes: number | null; comments: number | null;
};

const flatEntrySchema = z.object({
  id: z.string(), title: z.string(),
  channel: z.string().nullish(), uploader: z.string().nullish(), channel_id: z.string().nullish(),
  view_count: z.number().nullish(), description: z.string().nullish(), timestamp: z.number().nullish(),
}).passthrough();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Searches YouTube via the `yt-dlp` CLI instead of the quota-limited YouTube Data API — no key,
 * no per-key daily cap. yt-dlp reverse-engineers YouTube's own internal endpoints and needs to be
 * kept reasonably current (YouTube changes break older releases); `--flat-playlist` keeps this to
 * one fast request that returns search-result metadata without resolving each video's full detail
 * (no like/comment counts or exact publish date in this mode — title/channel/views/description are).
 */
export class YouTubeSource {
  constructor(private readonly binary = process.env.YT_DLP_PATH ?? "yt-dlp") {}

  async search(query: string, signal: AbortSignal, limit = 10): Promise<VideoResult[]> {
    const args = ["--flat-playlist", "--dump-json", "--no-warnings", "--skip-download", "--ignore-errors", `ytsearch${limit}:${query}`];
    let stdout: string;
    try {
      stdout = await this.run(args, signal);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") throw new Error("yt-dlp is not installed on this machine — install it (pip install -U yt-dlp) to enable YouTube search.");
      throw new Error(`yt-dlp search failed: ${(err.message ?? "unknown error").slice(0, 300)}`);
    }

    return stdout.split("\n").filter((line) => line.trim().startsWith("{")).map((line) => {
      const entry = flatEntrySchema.parse(JSON.parse(line));
      return {
        id: entry.id, publishedAt: null, channelId: entry.channel_id ?? null,
        channelTitle: entry.channel ?? entry.uploader ?? "Unknown channel",
        title: entry.title, description: entry.description ?? "",
        views: entry.view_count ?? null, likes: null, comments: null,
      };
    });
  }

  private run(args: string[], signal: AbortSignal, attempt = 0): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.binary, args, { signal, timeout: 25_000, maxBuffer: 1024 * 1024 * 16 }, (error, stdout) => {
        if (!error) return resolve(stdout);
        if ((error as NodeJS.ErrnoException).code === "ENOENT" || attempt >= 1) return reject(error);
        sleep(500).then(() => this.run(args, signal, attempt + 1).then(resolve, reject));
      });
    });
  }
}
