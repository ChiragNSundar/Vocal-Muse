// Lyric exporters — pure functions, all client-side. Each returns a Blob
// (or string) ready to download. Keeps the "Copy all" menu lean.

import type { CadenceMap } from "./lyrics-analysis";

export type Lyrics = { title: string; sections: { type: string; lines: string[] }[] };

function flatLines(lyrics: Lyrics): string[] {
  return lyrics.sections.flatMap((s) => s.lines);
}

export function toPlainText(lyrics: Lyrics): string {
  return (
    `${lyrics.title}\n\n` +
    lyrics.sections
      .map((s) => `[${s.type.toUpperCase()}]\n${s.lines.join("\n")}`)
      .join("\n\n")
  );
}

export function toGeniusMarkdown(lyrics: Lyrics): string {
  return (
    `# ${lyrics.title}\n\n` +
    lyrics.sections
      .map((s) => `**[${s.type.toUpperCase()}]**\n\n${s.lines.join("  \n")}`)
      .join("\n\n")
  );
}

/** Lightweight RTF — opens cleanly in Word/Pages/TextEdit. */
export function toRtf(lyrics: Lyrics): string {
  const esc = (t: string) =>
    t.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
  const parts: string[] = [];
  parts.push(`{\\rtf1\\ansi\\deff0`);
  parts.push(`{\\fonttbl{\\f0 Helvetica;}}`);
  parts.push(`\\fs36\\b ${esc(lyrics.title)}\\b0\\par\\par`);
  for (const s of lyrics.sections) {
    parts.push(`\\fs22\\b [${esc(s.type.toUpperCase())}]\\b0\\par`);
    parts.push(`\\fs24 ${s.lines.map((l) => esc(l)).join("\\par ")}\\par\\par`);
  }
  parts.push(`}`);
  return parts.join("");
}

/** Plain-text with bar-level timestamps derived from cadence syllables. */
export function toTimestamped(lyrics: Lyrics, cadence: CadenceMap | null, bpm = 90): string {
  const lines = flatLines(lyrics);
  // Rough estimate: assume 4 syllables ≈ one beat at the given BPM.
  const secondsPerBeat = 60 / bpm;
  let acc = 0;
  const stamped = lines.map((line, i) => {
    const bar = cadence?.bars[i];
    const syll = bar?.syllables ?? Math.max(4, Math.round(line.split(/\s+/).length * 1.3));
    const start = acc;
    acc += (syll / 4) * secondsPerBeat;
    const mm = Math.floor(start / 60).toString().padStart(2, "0");
    const ss = Math.floor(start % 60).toString().padStart(2, "0");
    const ms = Math.floor((start % 1) * 100).toString().padStart(2, "0");
    return `[${mm}:${ss}.${ms}] ${line}`;
  });
  return `${lyrics.title} · est. ${bpm} BPM\n\n${stamped.join("\n")}`;
}

/** Returns formatted HTML for the print dialog → PDF. */
export function toPrintableHtml(lyrics: Lyrics): string {
  const css = `
    @page { margin: 24mm; }
    body { font: 14px/1.6 -apple-system, system-ui, sans-serif; color: #111; }
    h1 { font-size: 28px; margin: 0 0 24px; letter-spacing: -0.01em; }
    .section { margin: 0 0 20px; page-break-inside: avoid; }
    .label { font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase;
             color: #b45309; font-weight: 700; margin-bottom: 6px; }
    p { margin: 0; white-space: pre-wrap; }
    footer { margin-top: 32px; font-size: 10px; color: #888; }
  `;
  const body = lyrics.sections
    .map(
      (s) =>
        `<div class="section"><div class="label">${escapeHtml(
          s.type,
        )}</div><p>${escapeHtml(s.lines.join("\n"))}</p></div>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    lyrics.title,
  )}</title><style>${css}</style></head><body><h1>${escapeHtml(
    lyrics.title,
  )}</h1>${body}<footer>Generated with VoxScript</footer></body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

export function downloadBlob(filename: string, content: string, mime: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function openPrintWindow(html: string) {
  if (typeof window === "undefined") return;
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  // Give the browser a tick to layout fonts before triggering print.
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* ignore */ } }, 250);
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "track";
}
