import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTrack, regenerateLyrics, deleteTrack, rewriteBar, updateBar } from "@/lib/tracks.functions";
import { getDeviceId } from "@/lib/device-id";
import {
  countSyllables, endRhymeKey, rhymeScheme, classifyScheme,
  DEFAULT_BRIEF,
  type StyleBrief, type CadenceMap, type QualityScore,
} from "@/lib/lyrics-analysis";
import { StyleBriefForm } from "@/components/StyleBriefForm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2, RefreshCw, Copy, Trash2, ChevronDown, Sliders, Wand2, Lock, LockOpen, Check, X, History, ChevronLeft, ChevronRight, Plus, CheckSquare, Square, Download, AlertTriangle, Keyboard, Target, Undo2, Redo2, Database } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { addToStyleMemory, sampleStyleExamples, addBurnedPhrasesFromBars, loadBurnedPhrases, loadBurnedVowels } from "@/lib/style-memory";
import { recallStyleExamples, buildRecallQuery } from "@/lib/style-recall";
import { Skeleton } from "@/components/ui/skeleton";
import { QualityRadar } from "@/components/QualityRadar";
import { PocketGrid, type BarPocketItem } from "@/components/PocketGrid";
import { BarDiff } from "@/components/BarDiff";
import { analyzeRepetition } from "@/lib/track-analytics";
import {
  toPlainText, toGeniusMarkdown, toRtf, toTimestamped, toPrintableHtml,
  downloadBlob, openPrintWindow, slugify,
} from "@/lib/exports";
import { getTrack as getLocalTrack, listTracks as listLocalTracks, deleteTrack as deleteLocalTrack, putBar as putLocalBar, putBars as putLocalBars, getBlob as getLocalBlob, putTrack as putLocalTrack, isLocalOnly, getDeviceId as getLocalDeviceId, runLocalPipeline, type LocalPipelineResult, type LocalLyrics, type LocalCadence, type LocalQuality, type LocalTrack } from "@/lib/local-store";
import { loadLlmConfig } from "@/lib/llm-config";

type Lyrics = { title: string; sections: { type: string; lines: string[] }[] };

export const Route = createFileRoute("/_app/track/$id")({
  head: () => ({ meta: [{ title: "Track · VoxScript" }] }),
  component: TrackPage,
});

function Meter({ label, value, max, suffix, tone }: {
  label: string; value: number; max: number; suffix?: string;
  tone: "good" | "warn" | "bad" | "info";
}) {
  const pct = Math.max(0, Math.min(1, value / max));
  const bar =
    tone === "good" ? "bg-emerald-500"
    : tone === "warn" ? "bg-amber-500"
    : tone === "bad" ? "bg-rose-500"
    : "bg-primary";
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}{suffix ?? ""}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${bar}`} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

// Local-only per-track state. Lives in localStorage.
// - locked: bars protected from rewrite
// - proposal: pending rewrite alternates + which one is currently shown
// - history: append-only list of prior bar texts (newest first), so accepted
//   rewrites and manual edits can be reverted bar-by-bar without a full regen.
export type BarVersion = { text: string; ts: number; source: "original" | "rewrite" | "manual" };
type BarProposal = { original: string; proposals: string[]; selectedIdx: number };
type BarLocalState = {
  locked: Record<number, boolean>;
  proposal: Record<number, BarProposal | undefined>;
  history: Record<number, BarVersion[]>;
};
function loadLocal(trackId: string): BarLocalState {
  if (typeof localStorage === "undefined") return { locked: {}, proposal: {}, history: {} };
  try {
    const raw = localStorage.getItem(`voxscript:track-local:${trackId}`);
    if (!raw) return { locked: {}, proposal: {}, history: {} };
    const parsed = JSON.parse(raw);
    // Back-compat: old shape stored proposal as { original, proposed }.
    const proposal: Record<number, BarProposal | undefined> = {};
    for (const [k, v] of Object.entries(parsed.proposal ?? {})) {
      const p = v as { original?: string; proposed?: string; proposals?: string[]; selectedIdx?: number } | undefined;
      if (!p) continue;
      if (Array.isArray(p.proposals)) {
        proposal[Number(k)] = { original: p.original ?? "", proposals: p.proposals, selectedIdx: p.selectedIdx ?? 0 };
      } else if (p.proposed) {
        proposal[Number(k)] = { original: p.original ?? "", proposals: [p.proposed], selectedIdx: 0 };
      }
    }
    return { locked: parsed.locked ?? {}, proposal, history: parsed.history ?? {} };
  } catch { return { locked: {}, proposal: {}, history: {} }; }
}
function saveLocal(trackId: string, state: BarLocalState) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(`voxscript:track-local:${trackId}`, JSON.stringify(state)); } catch { /* quota */ }
}



// Undo/redo. A bar-scoped action captures the slice of local state for one
// bar plus the server text before/after, so we can re-apply or invert without
// re-running any pipeline. Stacks live in memory only (intentional — refresh
// is its own kind of reset).
type BarSlice = { proposal?: BarProposal; history: BarVersion[]; locked: boolean };
type UndoAction = {
  label: string;
  barIndex: number;
  serverBefore: string;
  serverAfter: string;
  sliceBefore: BarSlice;
  sliceAfter: BarSlice;
};
function getSlice(s: BarLocalState, i: number): BarSlice {
  return { proposal: s.proposal[i], history: s.history[i] ?? [], locked: !!s.locked[i] };
}
function applySlice(s: BarLocalState, i: number, slice: BarSlice): BarLocalState {
  const proposal = { ...s.proposal };
  if (slice.proposal) proposal[i] = slice.proposal; else delete proposal[i];
  const history = { ...s.history, [i]: slice.history };
  const locked = { ...s.locked };
  if (slice.locked) locked[i] = true; else delete locked[i];
  return { proposal, history, locked };
}


type BulkOpts = { keepEndSound: boolean; swapMetaphor: boolean; raiseDensity: boolean; custom: string; count: number };
type BulkPersist = { selectMode: boolean; selectedBars: number[]; bulkOpts: BulkOpts };
const DEFAULT_BULK_OPTS: BulkOpts = { keepEndSound: true, swapMetaphor: false, raiseDensity: false, custom: "", count: 2 };
function bulkKey(trackId: string) { return `voxscript:track-bulk:${trackId}`; }
function loadBulk(trackId: string): BulkPersist {
  if (typeof localStorage === "undefined") return { selectMode: false, selectedBars: [], bulkOpts: DEFAULT_BULK_OPTS };
  try {
    const raw = localStorage.getItem(bulkKey(trackId));
    if (!raw) return { selectMode: false, selectedBars: [], bulkOpts: DEFAULT_BULK_OPTS };
    const p = JSON.parse(raw) as Partial<BulkPersist>;
    return {
      selectMode: !!p.selectMode,
      selectedBars: Array.isArray(p.selectedBars) ? p.selectedBars.filter((n) => typeof n === "number") : [],
      bulkOpts: { ...DEFAULT_BULK_OPTS, ...(p.bulkOpts ?? {}) },
    };
  } catch { return { selectMode: false, selectedBars: [], bulkOpts: DEFAULT_BULK_OPTS }; }
}
function saveBulk(trackId: string, state: BulkPersist) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(bulkKey(trackId), JSON.stringify(state)); } catch { /* quota */ }
}

function TrackPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchTrack = useServerFn(getTrack);
  const regenFn = useServerFn(regenerateLyrics);
  const deleteFn = useServerFn(deleteTrack);
  const rewriteFn = useServerFn(rewriteBar);
  const updateFn = useServerFn(updateBar);
  const [busy, setBusy] = useState(false);
  const [editingBrief, setEditingBrief] = useState(false);
  const [briefDraft, setBriefDraft] = useState<StyleBrief>(DEFAULT_BRIEF);
  const [local, setLocal] = useState<BarLocalState>(() => loadLocal(id));
  const [isLocalTrack, setIsLocalTrack] = useState(false);
  const [localTrackData, setLocalTrackData] = useState<LocalTrack | null>(null);
  const [rewritingIdx, setRewritingIdx] = useState<number | null>(null);
  const initialBulk = useMemo(() => loadBulk(id), [id]);
  const [selectMode, setSelectMode] = useState<boolean>(initialBulk.selectMode);
  const [selectedBars, setSelectedBars] = useState<Set<number>>(() => new Set(initialBulk.selectedBars));
  const [bulkPending, setBulkPending] = useState<Set<number>>(() => new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkOpts, setBulkOpts] = useState<BulkOpts>(initialBulk.bulkOpts);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);
  const UNDO_MAX = 100;
  const pushAction = useCallback((act: UndoAction) => {
    setUndoStack((s) => [...s, act].slice(-UNDO_MAX));
    setRedoStack([]);
  }, []);

  useEffect(() => { saveLocal(id, local); }, [id, local]);
  useEffect(() => {
    saveBulk(id, { selectMode, selectedBars: Array.from(selectedBars), bulkOpts });
  }, [id, selectMode, selectedBars, bulkOpts]);

  // Load track from local store first, then fall back to server
  const { data, isLoading, error } = useQuery({
    queryKey: ["track", id],
    queryFn: async () => {
      // First check local store
      const localTrack = await getLocalTrack(id);
      if (localTrack) {
        setIsLocalTrack(true);
        setLocalTrackData(localTrack);
        return null; // Don't use server data
      }
      // Fall back to server
      setIsLocalTrack(false);
      return fetchTrack({ data: { deviceId: getDeviceId(), id } });
    },
    refetchInterval: (q) => {
      const t = q.state.data as { status?: string } | undefined;
      return t && t.status !== "done" && t.status !== "error" ? 2500 : false;
    },
  });

  // Use local track data if available
  const trackData = isLocalTrack ? localTrackData : data;
  const lyrics = useMemo(() => {
    if (!trackData) return null;
    if (isLocalTrack && trackData.lyrics) {
      return JSON.parse(trackData.lyrics);
    }
    return (trackData as any).lyrics ?? null;
  }, [trackData, isLocalTrack]);
  const cadence = useMemo(() => {
    if (!trackData) return null;
    if (isLocalTrack && trackData.cadenceMap) {
      return JSON.parse(trackData.cadenceMap);
    }
    return (trackData as any).cadence ?? null;
  }, [trackData, isLocalTrack]);
  const quality = useMemo(() => {
    if (!trackData) return null;
    if (isLocalTrack && trackData.quality) {
      return JSON.parse(trackData.quality);
    }
    return (trackData as any).quality ?? null;
  }, [trackData, isLocalTrack]);
  const styleBrief = useMemo(() => {
    if (!trackData) return null;
    if (isLocalTrack && trackData.styleBrief) {
      return JSON.parse(trackData.styleBrief);
    }
    return (trackData as any).styleBrief ?? null;
  }, [trackData, isLocalTrack]);
  const isProcessing = trackData ? (trackData.status !== "done" && trackData.status !== "error") : true;

  const flatLines = useMemo(() => lyrics ? lyrics.sections.flatMap((s) => s.lines) : [], [lyrics]);
  const barPocketItems = useMemo<BarPocketItem[]>(() => {
    if (!flatLines.length) return [];
    return flatLines.map((line, idx) => ({
      index: idx,
      text: line,
      syllables: countSyllables(line),
      endSound: endRhymeKey(line),
    }));
  }, [flatLines]);
  const scheme = useMemo(() => classifyScheme(rhymeScheme(flatLines)), [flatLines]);
  const warnings = useMemo(() => analyzeRepetition(flatLines), [flatLines]);
  const badBarSet = useMemo(() => {
    const s = new Set<number>();
    for (const w of warnings) for (const i of w.badBarIndices) s.add(i);
    return s;
  }, [warnings]);
  const [focusedBar, setFocusedBar] = useState<number | null>(null);
  const focusedBarRef = useRef<number | null>(null);
  useEffect(() => { focusedBarRef.current = focusedBar; }, [focusedBar]);

  // Auto-harvest into style memory when the track scores Drake-tier.
  useEffect(() => {
    if (!lyrics || !data || data.status !== "done") return;
    const score = quality?.drakeScore ?? 0;
    if (score >= 8.0) {
      const bars = lyrics.sections.flatMap((s) => s.lines);
      const vibe = (cadence as (CadenceMap & { detectedVibe?: string }) | null)?.detectedVibe;
      addToStyleMemory({
        title: lyrics.title,
        drakeScore: score,
        vibe,
        genre: styleBrief?.genre,
        attitude: styleBrief?.attitude,
        bars,
      });
      addBurnedPhrasesFromBars(bars);
    }
  }, [data?.status, id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || (!data && !isLocalTrack)) {
    return (
      <div className="max-w-3xl mx-auto space-y-6" aria-busy="true" aria-label="Loading track">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2 flex-1">
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
          <div className="flex gap-2 shrink-0">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-9" />
          </div>
        </div>
        <Card className="p-4"><Skeleton className="h-12 w-full" /></Card>
        <Card className="p-4 space-y-3">
          <Skeleton className="h-3 w-32" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-1.5 w-full" />
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-6 space-y-4">
          <Skeleton className="h-5 w-24" />
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-6" style={{ width: `${60 + ((i * 13) % 35)}%` }} />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const regenerate = async (override?: StyleBrief) => {
    setBusy(true);
    try {
      const effectiveBrief = override ?? styleBrief ?? undefined;
      if (isLocalTrack) {
        // Run local pipeline for regeneration
        const config = loadLlmConfig();
        const transcript = localTrackData?.transcript || "";
        if (!transcript) throw new Error("No transcript available for local regeneration");
        const result = await runLocalPipeline(config, transcript, effectiveBrief);
        // Update local track with new result
        const updatedTrack: LocalTrack = {
          id: localTrackData!.id || id,
          deviceId: localTrackData!.deviceId || getLocalDeviceId(),
          title: localTrackData!.title || "Untitled",
          status: "done",
          bpm: localTrackData?.bpm,
          beatsPerBar: localTrackData?.beatsPerBar,
          createdAt: localTrackData?.createdAt || Date.now(),
          updatedAt: Date.now(),
          transcript: localTrackData?.transcript,
          briefJson: JSON.stringify(effectiveBrief ?? {}),
          audioKey: localTrackData?.audioKey,
          lyrics: JSON.stringify(result.lyrics),
          cadenceMap: JSON.stringify(result.cadence),
          quality: JSON.stringify(result.quality),
          styleBrief: JSON.stringify(effectiveBrief ?? {}),
        };
        await putLocalTrack(updatedTrack);
        qc.invalidateQueries({ queryKey: ["track", id] });
        qc.invalidateQueries({ queryKey: ["tracks", "local"] });
        toast.success("Rewriting with the new brief…");
        setEditingBrief(false);
        return;
      }
      const transcript = (data as { raw_transcript?: string } | undefined)?.raw_transcript;
      const query = buildRecallQuery({
        transcript: transcript || undefined,
        topic: effectiveBrief?.topic,
        attitude: effectiveBrief?.attitude,
        customSlang: effectiveBrief?.customSlang,
        genre: effectiveBrief?.genre,
      });
      const recalled = query
        ? await recallStyleExamples(query, { count: 3, filter: { genre: effectiveBrief?.genre } })
        : [];
      const styleExamples = recalled.length ? recalled : sampleStyleExamples(3, { genre: effectiveBrief?.genre });
      const burnedPhrases = loadBurnedPhrases().slice(0, 40);
      const burnedVowels = loadBurnedVowels().slice(0, 30);
      await regenFn({
        data: { deviceId: getDeviceId(), trackId: id, styleBrief: override ?? styleBrief ?? undefined, styleExamples, burnedPhrases, burnedVowels },
      });
      qc.invalidateQueries({ queryKey: ["track", id] });
      toast.success("Rewriting with the new brief…");
      setEditingBrief(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!confirm("Delete this track?")) return;
    try {
      if (isLocalTrack) {
        await deleteLocalTrack(id);
        qc.invalidateQueries({ queryKey: ["tracks", "local"] });
      } else {
        await deleteFn({ data: { deviceId: getDeviceId(), id } });
        qc.invalidateQueries({ queryKey: ["tracks"] });
      }
      navigate({ to: "/library" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const copyAll = async () => {
    if (!lyrics) return;
    await navigator.clipboard.writeText(toPlainText(lyrics));
    toast.success("Copied to clipboard");
  };

  const exportAs = (format: "txt" | "md" | "rtf" | "timestamped" | "pdf") => {
    if (!lyrics) return;
    const slug = slugify(lyrics.title);
    if (format === "txt") downloadBlob(`${slug}.txt`, toPlainText(lyrics), "text/plain");
    else if (format === "md") downloadBlob(`${slug}.md`, toGeniusMarkdown(lyrics), "text/markdown");
    else if (format === "rtf") downloadBlob(`${slug}.rtf`, toRtf(lyrics), "application/rtf");
    else if (format === "timestamped") downloadBlob(`${slug}.timestamped.txt`, toTimestamped(lyrics, cadence, 90), "text/plain");
    else if (format === "pdf") openPrintWindow(toPrintableHtml(lyrics));
    toast.success(format === "pdf" ? "Opening print dialog…" : "Downloaded");
  };

  const rewriteWeakestAxis = () => {
    if (!quality?.councilByRole) return;
    const weakest = Object.entries(quality.councilByRole).sort((a, b) => a[1] - b[1])[0];
    if (!weakest) return;
    const [role] = weakest;
    const directive: Record<string, string> = {
      pocket: "Lock the cadence harder — every bar must hit syllable target ±0 and stress where the mumble stressed. Kill any bar that jaw-breaks.",
      wordplay: "Push wordplay: 2-3 syllable end-rhymes, internal rhymes inside every bar, at least two double-entendres in the verse.",
      authenticity: "Strip every cliché and AI-tell. Make it sound like a real human artist with a specific voice — concrete brands/places/objects, not abstractions.",
    };
    const augmented: StyleBrief = {
      ...DEFAULT_BRIEF,
      ...(styleBrief ?? {}),
      structuralRules: [(styleBrief?.structuralRules ?? "").trim(), directive[role] ?? ""].filter(Boolean).join("\n"),
    };
    toast.message(`Rewriting to lift "${role}" axis…`);
    regenerate(augmented);
  };


  const runBarRewrite = async (
    barIndex: number,
    original: string,
    opts: { keepEndSound: boolean; swapMetaphor: boolean; raiseDensity: boolean; custom: string; count: number },
    mode: "replace" | "append" = "replace",
  ) => {
    setRewritingIdx(barIndex);
    try {
      let proposals: string[];
      if (isLocalTrack) {
        // Local rewrite using local pipeline
        const config = loadLlmConfig();
        const transcript = trackData?.transcript || "";
        const brief = trackData?.styleBrief || undefined;
        const result = await runLocalPipeline(config, transcript, brief);
        // For simplicity, use the rewritten lyrics as proposals
        // In a real implementation, we'd have a more targeted rewrite
        proposals = result.lyrics.sections.flatMap((s) => s.lines).slice(barIndex, barIndex + opts.count);
      } else {
        const r = await rewriteFn({
          data: {
            deviceId: getDeviceId(),
            trackId: id,
            barIndex,
            count: opts.count,
            options: { keepEndSound: opts.keepEndSound, swapMetaphor: opts.swapMetaphor, raiseDensity: opts.raiseDensity, custom: opts.custom },
            burnedPhrases: loadBurnedPhrases().slice(0, 40),
            burnedVowels: loadBurnedVowels().slice(0, 30),
          },
        });
        proposals = (r.proposals && r.proposals.length ? r.proposals : [r.proposal]).filter(Boolean) as string[];
      }
      setLocal((s) => {
        const existing = s.proposal[barIndex];
        const merged = mode === "append" && existing
          ? Array.from(new Set([...existing.proposals, ...proposals]))
          : proposals;
        return {
          ...s,
          proposal: {
            ...s.proposal,
            [barIndex]: { original, proposals: merged, selectedIdx: mode === "append" && existing ? existing.proposals.length : 0 },
          },
        };
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rewrite failed");
    } finally {
      setRewritingIdx(null);
    }
  };

  const selectAlternate = (barIndex: number, delta: number) => {
    setLocal((s) => {
      const p = s.proposal[barIndex];
      if (!p || !p.proposals.length) return s;
      const next = (p.selectedIdx + delta + p.proposals.length) % p.proposals.length;
      return { ...s, proposal: { ...s.proposal, [barIndex]: { ...p, selectedIdx: next } } };
    });
  };

  const acceptProposal = async (barIndex: number, originalLine: string) => {
    const before = local;
    const p = before.proposal[barIndex];
    if (!p) return;
    const chosen = p.proposals[p.selectedIdx];
    if (!chosen) return;
    try {
      if (isLocalTrack) {
        // Update local track - use parsed lyrics state
        if (!lyrics) return;
        // Find the section and line index
          let lineIdx = 0;
          let found = false;
          for (const section of lyrics.sections) {
            for (let i = 0; i < section.lines.length; i++) {
              if (lineIdx === barIndex) {
                section.lines[i] = chosen;
                found = true;
                break;
              }
              lineIdx++;
            }
            if (found) break;
          }
          const updatedTrack: LocalTrack = {
            id: localTrackData!.id || id,
            deviceId: localTrackData!.deviceId || getLocalDeviceId(),
            title: localTrackData!.title || "Untitled",
            status: "done",
            bpm: localTrackData?.bpm,
            beatsPerBar: localTrackData?.beatsPerBar,
            createdAt: localTrackData?.createdAt || Date.now(),
            updatedAt: Date.now(),
            transcript: localTrackData?.transcript,
            briefJson: localTrackData?.briefJson,
            audioKey: localTrackData?.audioKey,
            lyrics: JSON.stringify(lyrics),
            cadenceMap: localTrackData?.cadenceMap,
            quality: localTrackData?.quality,
            styleBrief: localTrackData?.styleBrief,
          };
          await putLocalTrack(updatedTrack);
      } else {
        await updateFn({ data: { deviceId: getDeviceId(), trackId: id, barIndex, text: chosen } });
      }
      const sliceBefore = getSlice(before, barIndex);
      const nextProp = { ...before.proposal };
      delete nextProp[barIndex];
      const prevHist = before.history[barIndex] ?? [];
      const newest = prevHist[0];
      const entry: BarVersion = { text: originalLine, ts: Date.now(), source: newest ? "rewrite" : "original" };
      const nextHist = newest && newest.text === originalLine ? prevHist : [entry, ...prevHist].slice(0, 12);
      const nextState: BarLocalState = { ...before, proposal: nextProp, history: { ...before.history, [barIndex]: nextHist } };
      setLocal(nextState);
      pushAction({
        label: "Accept rewrite", barIndex,
        serverBefore: originalLine, serverAfter: chosen,
        sliceBefore, sliceAfter: getSlice(nextState, barIndex),
      });
      addBurnedPhrasesFromBars([chosen]);
      qc.invalidateQueries({ queryKey: ["track", id] });
      toast.success("Bar updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const restoreVersion = async (barIndex: number, version: BarVersion, currentLine: string) => {
    try {
      if (isLocalTrack) {
        if (!lyrics) return;
        let lineIdx = 0;
        let found = false;
          for (const section of lyrics.sections) {
            for (let i = 0; i < section.lines.length; i++) {
              if (lineIdx === barIndex) {
                section.lines[i] = version.text;
                found = true;
                break;
              }
              lineIdx++;
            }
            if (found) break;
          }
          const updatedTrack: LocalTrack = {
            id: localTrackData!.id || id,
            deviceId: localTrackData!.deviceId || getLocalDeviceId(),
            title: localTrackData!.title || "Untitled",
            status: "done",
            bpm: localTrackData?.bpm,
            beatsPerBar: localTrackData?.beatsPerBar,
            createdAt: localTrackData?.createdAt || Date.now(),
            updatedAt: Date.now(),
            transcript: localTrackData?.transcript,
            briefJson: localTrackData?.briefJson,
            audioKey: localTrackData?.audioKey,
            lyrics: JSON.stringify(lyrics),
            cadenceMap: localTrackData?.cadenceMap,
            quality: localTrackData?.quality,
            styleBrief: localTrackData?.styleBrief,
          };
          await putLocalTrack(updatedTrack);
      } else {
        await updateFn({ data: { deviceId: getDeviceId(), trackId: id, barIndex, text: version.text } });
      }
      const before = local;
      const sliceBefore = getSlice(before, barIndex);
      const prevHist = before.history[barIndex] ?? [];
      const entry: BarVersion = { text: currentLine, ts: Date.now(), source: "rewrite" };
      const nextHist = [entry, ...prevHist.filter((v) => v.ts !== version.ts)].slice(0, 12);
      const nextState: BarLocalState = { ...before, history: { ...before.history, [barIndex]: nextHist } };
      setLocal(nextState);
      pushAction({
        label: "Restore version", barIndex,
        serverBefore: currentLine, serverAfter: version.text,
        sliceBefore, sliceAfter: getSlice(nextState, barIndex),
      });
      qc.invalidateQueries({ queryKey: ["track", id] });
      toast.success("Restored earlier version");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
    }
  };

  const revertProposal = (barIndex: number) => {
    const before = local;
    if (!before.proposal[barIndex]) return;
    const sliceBefore = getSlice(before, barIndex);
    const nextProp = { ...before.proposal };
    delete nextProp[barIndex];
    const nextState: BarLocalState = { ...before, proposal: nextProp };
    setLocal(nextState);
    pushAction({
      label: "Discard alternate", barIndex,
      serverBefore: "", serverAfter: "",
      sliceBefore, sliceAfter: getSlice(nextState, barIndex),
    });
  };

  const doUndo = useCallback(async () => {
    const act = undoStack[undoStack.length - 1];
    if (!act) return;
    try {
      if (act.serverBefore !== act.serverAfter) {
        if (isLocalTrack) {
          if (!lyrics) return;
          let lineIdx = 0;
          let found = false;
          for (const section of lyrics.sections) {
            for (let i = 0; i < section.lines.length; i++) {
              if (lineIdx === act.barIndex) {
                section.lines[i] = act.serverBefore;
                found = true;
                break;
              }
              lineIdx++;
            }
            if (found) break;
          }
          const updatedTrack: LocalTrack = {
            id: localTrackData!.id || id,
            deviceId: localTrackData!.deviceId || getLocalDeviceId(),
            title: localTrackData!.title || "Untitled",
            status: "done",
            bpm: localTrackData?.bpm,
            beatsPerBar: localTrackData?.beatsPerBar,
            createdAt: localTrackData?.createdAt || Date.now(),
            updatedAt: Date.now(),
            transcript: localTrackData?.transcript,
            briefJson: localTrackData?.briefJson,
            audioKey: localTrackData?.audioKey,
            lyrics: JSON.stringify(lyrics),
            cadenceMap: localTrackData?.cadenceMap,
            quality: localTrackData?.quality,
            styleBrief: localTrackData?.styleBrief,
          };
          await putLocalTrack(updatedTrack);
        } else {
          await updateFn({ data: { deviceId: getDeviceId(), trackId: id, barIndex: act.barIndex, text: act.serverBefore } });
        }
        qc.invalidateQueries({ queryKey: ["track", id] });
      }
      setLocal((s) => applySlice(s, act.barIndex, act.sliceBefore));
      setUndoStack((s) => s.slice(0, -1));
      setRedoStack((s) => [...s, act]);
      toast.success(`Undid: ${act.label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Undo failed");
    }
  }, [undoStack, id, qc, updateFn, isLocalTrack, localTrackData]);

  const doRedo = useCallback(async () => {
    const act = redoStack[redoStack.length - 1];
    if (!act) return;
    try {
      if (act.serverBefore !== act.serverAfter) {
        if (isLocalTrack) {
          if (!lyrics) return;
          let lineIdx = 0;
          let found = false;
          for (const section of lyrics.sections) {
            for (let i = 0; i < section.lines.length; i++) {
              if (lineIdx === act.barIndex) {
                section.lines[i] = act.serverAfter;
                found = true;
                break;
              }
              lineIdx++;
            }
            if (found) break;
          }
          const updatedTrack: LocalTrack = {
            id: localTrackData!.id || id,
            deviceId: localTrackData!.deviceId || getLocalDeviceId(),
            title: localTrackData!.title || "Untitled",
            status: localTrackData?.status || "done",
            bpm: localTrackData?.bpm,
            beatsPerBar: localTrackData?.beatsPerBar,
            createdAt: localTrackData?.createdAt || Date.now(),
            updatedAt: Date.now(),
            transcript: localTrackData?.transcript,
            briefJson: localTrackData?.briefJson,
            audioKey: localTrackData?.audioKey,
            lyrics: JSON.stringify(lyrics),
            cadenceMap: localTrackData?.cadenceMap,
            quality: localTrackData?.quality,
            styleBrief: localTrackData?.styleBrief,
          };
          await putLocalTrack(updatedTrack);
        } else {
          await updateFn({ data: { deviceId: getDeviceId(), trackId: id, barIndex: act.barIndex, text: act.serverAfter } });
        }
        qc.invalidateQueries({ queryKey: ["track", id] });
      }
      setLocal((s) => applySlice(s, act.barIndex, act.sliceAfter));
      setRedoStack((s) => s.slice(0, -1));
      setUndoStack((s) => [...s, act].slice(-UNDO_MAX));
      toast.success(`Redid: ${act.label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Redo failed");
    }
  }, [redoStack, id, qc, updateFn, isLocalTrack, localTrackData]);



  const toggleLock = (barIndex: number) => {
    setLocal((s) => ({ ...s, locked: { ...s.locked, [barIndex]: !s.locked[barIndex] } }));
  };


  const toggleBarSelected = (barIndex: number) => {
    setSelectedBars((s) => {
      const n = new Set(s);
      if (n.has(barIndex)) n.delete(barIndex); else n.add(barIndex);
      return n;
    });
  };

  const selectAllBars = () => {
    setSelectedBars(new Set(flatLines.map((_, i) => i).filter((i) => !local.locked[i] && flatLines[i]?.trim())));
  };
  const clearSelection = () => setSelectedBars(new Set());

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedBars(new Set());
  };

  const runBulkRewrite = async () => {
    const targets = Array.from(selectedBars).filter((i) => !local.locked[i] && flatLines[i]?.trim()).sort((a, b) => a - b);
    if (!targets.length) { toast.error("No eligible bars selected"); return; }
    setBulkRunning(true);
    setBulkPending(new Set(targets));
    const burnedPhrases = loadBurnedPhrases().slice(0, 40);
    const burnedVowels = loadBurnedVowels().slice(0, 30);
    let ok = 0, fail = 0;
    // Bounded concurrency so we don't fan out 30+ requests in parallel.
    const CONC = 4;
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= targets.length) return;
        const barIndex = targets[i];
        const original = flatLines[barIndex] ?? "";
        try {
          const r = await rewriteFn({
            data: {
              deviceId: getDeviceId(),
              trackId: id,
              barIndex,
              count: bulkOpts.count,
              options: { keepEndSound: bulkOpts.keepEndSound, swapMetaphor: bulkOpts.swapMetaphor, raiseDensity: bulkOpts.raiseDensity, custom: bulkOpts.custom },
              burnedPhrases,
              burnedVowels,
            },
          });
          const proposals = (r.proposals && r.proposals.length ? r.proposals : [r.proposal]).filter(Boolean) as string[];
          if (!proposals.length) { fail++; }
          else {
            ok++;
            setLocal((s) => ({
              ...s,
              proposal: {
                ...s.proposal,
                [barIndex]: { original, proposals, selectedIdx: 0 },
              },
            }));
          }
        } catch {
          fail++;
        } finally {
          setBulkPending((s) => { const n = new Set(s); n.delete(barIndex); return n; });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, targets.length) }, worker));
    setBulkRunning(false);
    setBulkPending(new Set());
    toast.success(`Generated alternates for ${ok} bar${ok === 1 ? "" : "s"}${fail ? ` · ${fail} failed` : ""}. Review and accept inline.`);
  };

  const bulkAcceptAll = async () => {
    const pendingBars = Object.keys(local.proposal).map(Number).filter((i) => selectedBars.has(i));
    if (!pendingBars.length) { toast.error("Nothing to accept"); return; }
    for (const i of pendingBars) {
      const original = flatLines[i] ?? "";
      await acceptProposal(i, original);
    }
  };

  const bulkDiscardAll = () => {
    for (const i of selectedBars) revertProposal(i);
  };


  // Keyboard shortcuts. Ignored when typing in inputs/textareas. The
  // focused-bar arrow keys give power users hands-on-keyboard navigation.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      // Undo / redo. Handle BEFORE the modifier-key bail-out below.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) doRedo(); else doUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        doRedo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Toggle bulk-rewrite mode
      if (e.key === "b" || e.key === "B") { e.preventDefault(); setSelectMode((s) => !s); return; }
      if (e.key === "Escape" && selectMode) { e.preventDefault(); exitSelectMode(); return; }

      // Focused-bar navigation
      const lineCount = flatLines.length;
      if (!lineCount) return;
      const cur = focusedBarRef.current;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setFocusedBar((c) => (c === null ? 0 : Math.min(lineCount - 1, c + 1)));
        return;
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setFocusedBar((c) => (c === null ? 0 : Math.max(0, c - 1)));
        return;
      }
      if (cur === null) return;

      if ((e.key === "s" || e.key === "S") && selectMode) {
        e.preventDefault();
        toggleBarSelected(cur);
        return;
      }

      const prop = local.proposal[cur];
      if (prop) {
        if (e.key === "ArrowLeft") { e.preventDefault(); selectAlternate(cur, -1); return; }
        if (e.key === "ArrowRight") { e.preventDefault(); selectAlternate(cur, 1); return; }
        if (e.key === "a" || e.key === "A" || e.key === "Enter") {
          e.preventDefault();
          acceptProposal(cur, flatLines[cur] ?? "");
          return;
        }
        if (e.key === "d" || e.key === "D") { e.preventDefault(); revertProposal(cur); return; }
      }
      if (e.key === "r" || e.key === "R") {
        if (local.locked[cur]) return;
        e.preventDefault();
        runBarRewrite(cur, flatLines[cur] ?? "", { ...bulkOpts, count: bulkOpts.count }, "replace");
      }
      if (e.key === "l" || e.key === "L") { e.preventDefault(); toggleLock(cur); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatLines, local, selectMode, bulkOpts, doUndo, doRedo]);

  let cursor = 0;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-semibold truncate">
              {lyrics?.title || data.title || "Untitled"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isProcessing
                ? data.status === "transcribing" ? "Mapping cadence…" : "Writing & editing lyrics…"
                : data.status === "error" ? "Something went wrong" : `Lyrics ready · scheme ${scheme}`}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline" size="sm"
              onClick={() => regenerate()}
              disabled={busy || isProcessing || !data.raw_transcript}
            >
              <RefreshCw className="h-4 w-4 mr-1.5" /> Regenerate
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {data.audio_url && (
          <Card className="p-4">
            <audio controls src={data.audio_url} className="w-full" />
          </Card>
        )}

        {quality && (
          <Card className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
              Ghostwriter scorecard
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Meter
                label="Cadence match"
                value={Math.round(quality.cadenceMatch * 100)}
                max={100} suffix="%"
                tone={quality.cadenceMatch >= 0.8 ? "good" : quality.cadenceMatch >= 0.6 ? "warn" : "bad"}
              />
              <Meter
                label="Rhyme density"
                value={quality.rhymeDensity}
                max={4}
                tone={quality.rhymeDensity >= 1.5 ? "good" : "info"}
              />
              <Meter
                label="Clichés caught"
                value={quality.clicheCount}
                max={Math.max(5, quality.clicheCount)}
                tone={quality.clicheCount === 0 ? "good" : quality.clicheCount <= 2 ? "warn" : "bad"}
              />
              <Meter
                label="Vibe consistency"
                value={quality.vibeConsistency}
                max={5} suffix="/5"
                tone={quality.vibeConsistency >= 4 ? "good" : "warn"}
              />
            </div>
            {quality.councilByRole && (
              <div className="mt-4 pt-4 border-t border-border flex flex-col md:flex-row md:items-center gap-4">
                <div className="shrink-0 flex justify-center">
                  <QualityRadar scores={quality.councilByRole} size={170} />
                </div>
                <div className="flex-1 space-y-2 text-xs">
                  <div className="uppercase tracking-wider text-muted-foreground">Critic council</div>
                  {(() => {
                    const sorted = Object.entries(quality.councilByRole).sort((a, b) => a[1] - b[1]);
                    const [weakRole, weakScore] = sorted[0];
                    return (
                      <>
                        <p className="text-foreground">
                          Weakest axis: <b className="capitalize">{weakRole}</b> ({weakScore.toFixed(1)}/10).
                          Strongest: <b className="capitalize">{sorted[sorted.length - 1][0]}</b> ({sorted[sorted.length - 1][1].toFixed(1)}/10).
                        </p>
                        <Button
                          size="sm" variant="outline"
                          onClick={rewriteWeakestAxis}
                          disabled={busy || isProcessing}
                        >
                          <Target className="h-3.5 w-3.5 mr-1.5" />
                          Rewrite to lift {weakRole}
                        </Button>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </Card>
        )}

        <Collapsible open={editingBrief} onOpenChange={(o) => {
          setEditingBrief(o);
          if (o) setBriefDraft({ ...DEFAULT_BRIEF, ...(styleBrief ?? {}) });
        }}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between p-3 rounded-md border border-border hover:border-primary/50 transition-colors text-sm">
              <span className="flex items-center gap-2 font-display font-semibold">
                <Sliders className="h-4 w-4 text-primary" />
                Style brief
                <span className="text-xs font-normal text-muted-foreground">
                  {styleBrief ? "— edit & rewrite" : "— none set"}
                </span>
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            <StyleBriefForm value={briefDraft} onChange={setBriefDraft} />
            <div className="flex justify-end">
              <Button onClick={() => regenerate(briefDraft)} disabled={busy || isProcessing}>
                <RefreshCw className="h-4 w-4 mr-1.5" /> Rewrite with this brief
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {data.status === "error" && (
          <Card className="p-4 border-destructive/40 bg-destructive/5 text-sm text-destructive">
            {data.error || "Unknown error"}
          </Card>
        )}

        {isProcessing && (
          <Card className="p-10 text-center">
            <Loader2 className="h-6 w-6 text-primary mx-auto mb-3 animate-spin" />
            <div className="text-sm text-muted-foreground">
              Hang tight — this updates automatically.
            </div>
          </Card>
        )}

        {lyrics && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-display font-semibold">Lyrics</h2>
                {warnings.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        <AlertTriangle className="h-3 w-3" />
                        {warnings.length} repetition warning{warnings.length === 1 ? "" : "s"}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs max-w-xs">
                      <ul className="space-y-1">
                        {warnings.map((w, i) => <li key={i}>• {w.message}</li>)}
                      </ul>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost" size="icon"
                      onClick={doUndo}
                      disabled={undoStack.length === 0}
                      aria-label="Undo"
                    >
                      <Undo2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {undoStack.length ? `Undo: ${undoStack[undoStack.length - 1].label}` : "Nothing to undo"}
                    <span className="ml-2 opacity-60">⌘/Ctrl+Z</span>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost" size="icon"
                      onClick={doRedo}
                      disabled={redoStack.length === 0}
                      aria-label="Redo"
                    >
                      <Redo2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {redoStack.length ? `Redo: ${redoStack[redoStack.length - 1].label}` : "Nothing to redo"}
                    <span className="ml-2 opacity-60">⌘/Ctrl+Shift+Z</span>
                  </TooltipContent>
                </Tooltip>
                <Button
                  variant={selectMode ? "default" : "ghost"}
                  size="sm"
                  onClick={() => { if (selectMode) exitSelectMode(); else setSelectMode(true); }}
                  title="Toggle bulk rewrite (B)"
                >
                  <CheckSquare className="h-4 w-4 mr-1.5" />
                  {selectMode ? "Done" : "Bulk rewrite"}
                </Button>
                <Button variant="ghost" size="sm" onClick={copyAll} title="Copy plain text">
                  <Copy className="h-4 w-4 mr-1.5" /> Copy
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <Download className="h-4 w-4 mr-1.5" /> Export
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="text-xs uppercase tracking-wider">Export as</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => exportAs("pdf")}>PDF (print sheet)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportAs("rtf")}>RTF (Word / Pages)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportAs("md")}>Markdown (Genius-style)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportAs("timestamped")}>Plain text w/ timestamps</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportAs("txt")}>Plain text</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" title="Keyboard shortcuts">
                      <Keyboard className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    <DropdownMenuLabel className="text-xs uppercase tracking-wider">Shortcuts</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1.5 text-xs space-y-1">
                      <div className="flex justify-between"><span>Navigate bars</span><kbd className="text-[10px] bg-muted px-1.5 rounded">↑ ↓ / j k</kbd></div>
                      <div className="flex justify-between"><span>Rewrite focused bar</span><kbd className="text-[10px] bg-muted px-1.5 rounded">R</kbd></div>
                      <div className="flex justify-between"><span>Lock / unlock</span><kbd className="text-[10px] bg-muted px-1.5 rounded">L</kbd></div>
                      <div className="flex justify-between"><span>Cycle alternates</span><kbd className="text-[10px] bg-muted px-1.5 rounded">← →</kbd></div>
                      <div className="flex justify-between"><span>Accept alternate</span><kbd className="text-[10px] bg-muted px-1.5 rounded">A / Enter</kbd></div>
                      <div className="flex justify-between"><span>Discard alternate</span><kbd className="text-[10px] bg-muted px-1.5 rounded">D</kbd></div>
                      <div className="flex justify-between"><span>Bulk mode</span><kbd className="text-[10px] bg-muted px-1.5 rounded">B</kbd></div>
                      <div className="flex justify-between"><span>Toggle selection</span><kbd className="text-[10px] bg-muted px-1.5 rounded">S</kbd></div>
                      <div className="flex justify-between"><span>Undo</span><kbd className="text-[10px] bg-muted px-1.5 rounded">⌘/Ctrl+Z</kbd></div>
                      <div className="flex justify-between"><span>Redo</span><kbd className="text-[10px] bg-muted px-1.5 rounded">⌘/Ctrl+⇧+Z</kbd></div>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            {selectMode && (
              <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground border-b border-border pb-2">
                <span>
                  {selectedBars.size} bar{selectedBars.size === 1 ? "" : "s"} selected
                  {" · "}locked bars are skipped
                </span>
                <div className="flex gap-2">
                  <button onClick={selectAllBars} className="hover:text-foreground underline-offset-2 hover:underline">Select all</button>
                  <button onClick={clearSelection} className="hover:text-foreground underline-offset-2 hover:underline">Clear</button>
                </div>
              </div>
            )}
            <div className="space-y-6">
              {lyrics.sections.map((s, i) => (
                <div key={i}>
                  <div className="text-xs uppercase tracking-wider text-primary mb-2">
                    {s.type}
                  </div>
                  <div className="font-display text-lg leading-relaxed space-y-1">
                    {s.lines.map((line, li) => {
                      const idx = cursor++;
                      const bar = cadence?.bars[idx];
                      const got = countSyllables(line);
                      const gotEnd = endRhymeKey(line);
                      const ok = bar ? Math.abs(bar.syllables - got) <= 1 : true;
                      const locked = !!local.locked[idx];
                      const proposal = local.proposal[idx];
                      const history = local.history[idx] ?? [];
                      return (
                        <BarRow
                          key={li}
                          line={line}
                          bar={bar}
                          got={got}
                          gotEnd={gotEnd}
                          ok={ok}
                          locked={locked}
                          proposal={proposal}
                          history={history}
                          rewriting={rewritingIdx === idx || bulkPending.has(idx)}
                          selectMode={selectMode}
                          selected={selectedBars.has(idx)}
                          focused={focusedBar === idx}
                          repeatWarn={badBarSet.has(idx)}
                          onFocus={() => setFocusedBar(idx)}
                          onToggleSelect={() => toggleBarSelected(idx)}
                          onRewrite={(opts) => runBarRewrite(idx, line, opts, "replace")}
                          onMoreAlternates={(opts) => runBarRewrite(idx, line, opts, "append")}
                          onSelectAlternate={(delta) => selectAlternate(idx, delta)}
                          onAccept={() => acceptProposal(idx, line)}
                          onRevert={() => revertProposal(idx)}
                          onToggleLock={() => toggleLock(idx)}
                          onRestore={(v) => restoreVersion(idx, v, line)}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {selectMode && (
          <div className="sticky bottom-4 z-20">
            <Card className="p-3 shadow-lg border-primary/40 bg-background/95 backdrop-blur">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="text-sm font-display font-semibold shrink-0">
                  Bulk rewrite
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    {selectedBars.size} selected
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs flex-wrap">
                  <label className="flex items-center gap-1.5">
                    <Checkbox checked={bulkOpts.keepEndSound} onCheckedChange={(v) => setBulkOpts((o) => ({ ...o, keepEndSound: !!v }))} />
                    Keep end-sound
                  </label>
                  <label className="flex items-center gap-1.5">
                    <Checkbox checked={bulkOpts.swapMetaphor} onCheckedChange={(v) => setBulkOpts((o) => ({ ...o, swapMetaphor: !!v }))} />
                    Swap image
                  </label>
                  <label className="flex items-center gap-1.5">
                    <Checkbox checked={bulkOpts.raiseDensity} onCheckedChange={(v) => setBulkOpts((o) => ({ ...o, raiseDensity: !!v }))} />
                    Push density
                  </label>
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Alts</span>
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setBulkOpts((o) => ({ ...o, count: n }))}
                        className={`h-6 w-6 text-xs rounded border ${bulkOpts.count === n ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                      >{n}</button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1.5 ml-auto">
                  <Button size="sm" variant="ghost" onClick={bulkDiscardAll} disabled={bulkRunning}>
                    <X className="h-3.5 w-3.5 mr-1" /> Discard all
                  </Button>
                  <Button size="sm" variant="outline" onClick={bulkAcceptAll} disabled={bulkRunning}>
                    <Check className="h-3.5 w-3.5 mr-1" /> Accept all
                  </Button>
                  <Button size="sm" onClick={runBulkRewrite} disabled={bulkRunning || selectedBars.size === 0}>
                    {bulkRunning
                      ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      : <Wand2 className="h-3.5 w-3.5 mr-1" />}
                    Rewrite {selectedBars.size || ""}
                  </Button>
                </div>
              </div>
              <Textarea
                value={bulkOpts.custom}
                onChange={(e) => setBulkOpts((o) => ({ ...o, custom: e.target.value }))}
                placeholder="Optional direction applied to every selected bar (e.g. 'darker imagery', 'callback to the hook')"
                className="mt-2 h-12 text-xs"
              />
            </Card>
          </div>
        )}

        {data.raw_transcript && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                <ChevronDown className="h-4 w-4" />
                View raw transcript
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Card className="p-4 mt-2 text-sm text-muted-foreground whitespace-pre-line">
                {data.raw_transcript}
              </Card>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </TooltipProvider>
  );
}

type RewriteOpts = { keepEndSound: boolean; swapMetaphor: boolean; raiseDensity: boolean; custom: string; count: number };

function BarRow({
  line, bar, got, gotEnd, ok, locked, proposal, history, rewriting,
  selectMode = false, selected: barSelected = false, focused = false, repeatWarn = false,
  onToggleSelect, onFocus,
  onRewrite, onMoreAlternates, onSelectAlternate, onAccept, onRevert, onToggleLock, onRestore,
}: {
  line: string;
  bar: CadenceMap["bars"][number] | undefined;
  got: number;
  gotEnd: string;
  ok: boolean;
  locked: boolean;
  proposal: { original: string; proposals: string[]; selectedIdx: number } | undefined;
  history: BarVersion[];
  rewriting: boolean;
  selectMode?: boolean;
  selected?: boolean;
  focused?: boolean;
  repeatWarn?: boolean;
  onToggleSelect?: () => void;
  onFocus?: () => void;
  onRewrite: (opts: RewriteOpts) => void;
  onMoreAlternates: (opts: RewriteOpts) => void;
  onSelectAlternate: (delta: number) => void;
  onAccept: () => void;
  onRevert: () => void;
  onToggleLock: () => void;
  onRestore: (v: BarVersion) => void;
}) {
  const [open, setOpen] = useState(false);
  const [keepEndSound, setKeepEndSound] = useState(true);
  const [swapMetaphor, setSwapMetaphor] = useState(false);
  const [raiseDensity, setRaiseDensity] = useState(false);
  const [count, setCount] = useState(3);
  const [custom, setCustom] = useState("");
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focused && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focused]);

  const opts: RewriteOpts = { keepEndSound, swapMetaphor, raiseDensity, custom, count };
  const total = proposal?.proposals.length ?? 0;
  const selectedAlt = proposal?.proposals[proposal.selectedIdx] ?? "";
  const canSelect = selectMode && !locked && !!line.trim();

  return (
    <div
      ref={rowRef}
      className={`group rounded ${focused ? "outline outline-2 outline-primary/60 outline-offset-2" : ""}`}
      onClick={onFocus}
    >
      <div className="flex items-start gap-1">
        {selectMode && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (canSelect) onToggleSelect?.(); }}
            disabled={!canSelect}
            title={locked ? "Locked — unlock to include" : barSelected ? "Deselect" : "Select"}
            className="mt-1 mr-1 text-muted-foreground hover:text-primary disabled:opacity-30 shrink-0"
          >
            {barSelected
              ? <CheckSquare className="h-4 w-4 text-primary" />
              : <Square className="h-4 w-4" />}
          </button>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={`flex-1 px-1 -mx-1 rounded ${!ok ? "bg-amber-500/10" : ""} ${repeatWarn ? "border-b border-dashed border-amber-500/50" : ""} ${locked ? "border-l-2 border-primary/60 pl-2" : ""} ${barSelected ? "ring-1 ring-primary/40" : ""}`}>
              {line || <span className="text-muted-foreground italic">(silence)</span>}
            </div>
          </TooltipTrigger>
          {bar && (
            <TooltipContent side="right" className="text-xs">
              <div>Target: <b>{bar.syllables}</b> syll · end <b>"{bar.endSound}"</b></div>
              <div>Got: <b>{got}</b> syll · end <b>"{gotEnd}"</b></div>
              <div className="text-muted-foreground mt-1">Mumble: "{bar.text}"</div>
              {repeatWarn && <div className="text-amber-400 mt-1">⚠ part of a repetition streak</div>}
            </TooltipContent>
          )}
        </Tooltip>

        <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex shrink-0">
          <button
            onClick={onToggleLock}
            title={locked ? "Unlock (allow rewrite)" : "Lock (protect from rewrites)"}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
          </button>

          {history.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  title={`${history.length} prior version${history.length === 1 ? "" : "s"}`}
                  className="p-1 text-muted-foreground hover:text-foreground relative"
                >
                  <History className="h-3.5 w-3.5" />
                  <span className="absolute -top-0.5 -right-0.5 text-[9px] font-mono bg-primary/80 text-primary-foreground rounded-full h-3 min-w-3 px-0.5 leading-3 flex items-center justify-center">
                    {history.length}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel className="text-xs uppercase tracking-wider">Bar history</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {history.map((v) => (
                  <DropdownMenuItem
                    key={v.ts}
                    onClick={() => onRestore(v)}
                    className="flex flex-col items-start gap-0.5 cursor-pointer"
                  >
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      {v.source} · {new Date(v.ts).toLocaleTimeString()}
                    </div>
                    <div className="text-sm truncate w-full">{v.text}</div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                disabled={locked || rewriting}
                title={locked ? "Locked" : "Rewrite this bar"}
                className="p-1 text-muted-foreground hover:text-primary disabled:opacity-30"
              >
                {rewriting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-4 space-y-3" align="end">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rewrite this bar</div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={keepEndSound} onCheckedChange={(v) => setKeepEndSound(!!v)} />
                  Keep end-sound ({bar?.endSound ?? "?"})
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={swapMetaphor} onCheckedChange={(v) => setSwapMetaphor(!!v)} />
                  Swap metaphor / image
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={raiseDensity} onCheckedChange={(v) => setRaiseDensity(!!v)} />
                  Push rhyme density
                </label>
              </div>
              <div>
                <Label className="text-xs">Alternates</Label>
                <div className="flex gap-1 mt-1">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setCount(n)}
                      className={`flex-1 h-7 text-xs rounded border ${count === n ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs">Custom direction (optional)</Label>
                <Textarea
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="e.g. make it more menacing, add a callback to the hook"
                  className="mt-1 h-16 text-sm"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => { onRewrite(opts); setOpen(false); }}
                >
                  <Wand2 className="h-3.5 w-3.5 mr-1.5" /> Rewrite
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {proposal && (
        <div className="mt-1 mb-2 ml-2 pl-3 border-l-2 border-primary/60 bg-primary/5 rounded-r-md py-2 pr-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] uppercase tracking-wider text-primary/80">
              Alternate {proposal.selectedIdx + 1} of {total}
            </div>
            {total > 1 && (
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => onSelectAlternate(-1)}
                  className="p-0.5 text-primary/70 hover:text-primary"
                  title="Previous alternate"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onSelectAlternate(1)}
                  className="p-0.5 text-primary/70 hover:text-primary"
                  title="Next alternate"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
          <BarDiff original={proposal?.original ?? line} proposed={selectedAlt} />
          <div className="flex gap-1 mt-2 flex-wrap">
            <Button size="sm" variant="default" onClick={onAccept}>
              <Check className="h-3.5 w-3.5 mr-1" /> Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onMoreAlternates(opts)}
              disabled={rewriting || total >= 8}
            >
              {rewriting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              More
            </Button>
            <Button size="sm" variant="ghost" onClick={onRevert}>
              <X className="h-3.5 w-3.5 mr-1" /> Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
