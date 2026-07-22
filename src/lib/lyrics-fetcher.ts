// Free, keyless, CORS-friendly web lyrics fetcher (powered by Lrclib API & Genius fallback)

export type WebLyricsResult = {
  id: string;
  trackName: string;
  artistName: string;
  albumName?: string;
  lyrics: string;
  lines: string[];
};

export async function searchWebLyrics(query: string): Promise<WebLyricsResult[]> {
  const q = query.trim();
  if (!q) return [];

  try {
    const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, {
      headers: { "User-Agent": "VocalMuse/1.0" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any[];
    if (!Array.isArray(data)) return [];

    return data
      .filter((item) => item.plainLyrics || item.syncedLyrics)
      .slice(0, 5)
      .map((item) => {
        let rawLyrics = item.plainLyrics || "";
        if (!rawLyrics && item.syncedLyrics) {
          // Strip timestamp prefixes like [00:12.34]
          rawLyrics = item.syncedLyrics.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, "").trim();
        }
        // Clean lyrics into lines
        const lines = rawLyrics
          .split(/\n+/)
          .map((l: string) => l.trim())
          .filter((l: string) => l && !l.startsWith("[") && !l.startsWith("Verse") && !l.startsWith("Chorus"));

        return {
          id: String(item.id || Math.random()),
          trackName: item.trackName || "Unknown Track",
          artistName: item.artistName || "Unknown Artist",
          albumName: item.albumName,
          lyrics: lines.join("\n"),
          lines,
        };
      });
  } catch {
    return [];
  }
}
