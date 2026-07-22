import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Strip HTML to readable text; extract lyric-like lines.
// Honest scope: we fetch a URL the user provides. They are responsible for
// using sources they have the right to learn from (their own lyrics, public
// domain, Creative Commons, etc.). We don't crawl or scrape at scale.

const Input = z.object({
  url: z.string().url(),
});

function stripHtml(html: string): string {
  // Remove script/style/nav/header/footer blocks entirely
  let out = html.replace(/<(script|style|nav|header|footer|aside|noscript)[\s\S]*?<\/\1>/gi, " ");
  // Convert <br> and block-ends to newlines
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
  // Drop all remaining tags
  out = out.replace(/<[^>]+>/g, " ");
  // Decode a few common entities
  out = out
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  return out;
}

function extractTitle(html: string, fallback: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m && m[1]) return m[1].replace(/\s+/g, " ").trim().slice(0, 120);
  return fallback;
}

function extractBars(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Heuristic filter: keep short-ish lines that look like lyric bars.
  // Drop section headers like [Verse 1], boilerplate, and prose paragraphs.
  const cleaned: string[] = [];
  for (const line of lines) {
    if (line.length < 6 || line.length > 220) continue;
    if (/^\[.*\]$/.test(line)) continue; // [Verse 1]
    if (/^(verse|chorus|bridge|hook|intro|outro|pre-chorus)\b/i.test(line)) continue;
    if (/^(lyrics|copyright|©|all rights)/i.test(line)) continue;
    if (/(cookie|privacy|sign in|sign up|subscribe|advertisement)/i.test(line)) continue;
    if (line.split(" ").length < 2) continue;
    // De-dupe immediate repeats
    if (cleaned[cleaned.length - 1] === line) continue;
    cleaned.push(line);
  }
  return cleaned;
}

export const harvestFromUrl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    let res: Response;
    try {
      res = await fetch(data.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (VoxScript Lyrics Harvester)",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });
    } catch (e) {
      throw new Error(`Could not reach ${data.url}: ${(e as Error).message}`);
    }
    if (!res.ok) throw new Error(`Source returned HTTP ${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html") && !ct.includes("text")) {
      throw new Error(`Unsupported content type: ${ct || "unknown"}`);
    }
    const html = await res.text();
    const title = extractTitle(html, new URL(data.url).hostname);
    const text = stripHtml(html);
    const bars = extractBars(text);
    if (bars.length < 4) {
      throw new Error("Couldn't find lyric-like lines on that page.");
    }
    // Cap so we don't ship an entire novel back to the client.
    return {
      title,
      sourceUrl: data.url,
      bars: bars.slice(0, 200),
      totalFound: bars.length,
    };
  });
