// Word-level diff between original bar and proposed alternate. Words that
// changed are highlighted; the END word gets an extra ring when its
// phonetic rhyme-family ALSO changed, so users see at a glance whether the
// rewrite kept the pocket end-sound or broke it.

import { rhymeFamily } from "@/lib/phonemes";

function tokenize(line: string): string[] {
  // Keep punctuation glued to words so we render readable diffs.
  return (line.match(/\S+/g) ?? []);
}

// Minimal LCS-based word diff. O(n*m) but n,m are bar-sized (<25 words).
function diffWords(a: string[], b: string[]): { type: "same" | "ins" | "del"; word: string }[] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++)
      dp[i + 1][j + 1] = a[i].toLowerCase() === b[j].toLowerCase()
        ? dp[i][j] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const out: { type: "same" | "ins" | "del"; word: string }[] = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1].toLowerCase() === b[j - 1].toLowerCase()) {
      out.unshift({ type: "same", word: b[j - 1] }); i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      out.unshift({ type: "del", word: a[i - 1] }); i--;
    } else {
      out.unshift({ type: "ins", word: b[j - 1] }); j--;
    }
  }
  while (i > 0) { out.unshift({ type: "del", word: a[--i] }); }
  while (j > 0) { out.unshift({ type: "ins", word: b[--j] }); }
  return out;
}

export function BarDiff({ original, proposed }: { original: string; proposed: string }) {
  const a = tokenize(original);
  const b = tokenize(proposed);
  const diff = diffWords(a, b);
  const endRhymeKept = rhymeFamily(original) === rhymeFamily(proposed);

  // Find last "ins" or "same" position so we can ring the end word.
  let lastKeepIdx = -1;
  for (let k = diff.length - 1; k >= 0; k--) {
    if (diff[k].type !== "del") { lastKeepIdx = k; break; }
  }

  return (
    <div className="text-base leading-relaxed flex flex-wrap gap-x-1.5 gap-y-0.5">
      {diff.map((d, k) => {
        if (d.type === "del") {
          return (
            <span key={k} className="line-through text-rose-400/60 text-sm">
              {d.word}
            </span>
          );
        }
        const isEnd = k === lastKeepIdx;
        const cls =
          d.type === "ins"
            ? "bg-emerald-500/15 text-emerald-300 rounded px-1"
            : "";
        const endRing = isEnd
          ? endRhymeKept
            ? " ring-1 ring-primary/40 rounded px-1"
            : " ring-1 ring-amber-500/60 rounded px-1"
          : "";
        return (
          <span
            key={k}
            className={cls + endRing}
            title={isEnd ? (endRhymeKept ? "End-rhyme preserved" : "End-rhyme changed — pocket may break") : undefined}
          >
            {d.word}
          </span>
        );
      })}
      {!endRhymeKept && (
        <span className="text-[10px] uppercase tracking-wider text-amber-400/80 self-center ml-1">
          rhyme shift
        </span>
      )}
    </div>
  );
}
