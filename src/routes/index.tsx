import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Mic, Sparkles, Library, Radio, Brain, Target, Cpu,
  Fingerprint, Keyboard, Volume2, ArrowRight, Zap, Shield,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VoxScript — Freestyle to Lyrics, Locally" },
      {
        name: "description",
        content:
          "Upload your freestyle, mumble, or hum — VoxScript turns it into polished lyrics that match your flow. 100% local, zero cloud.",
      },
      { property: "og:title", content: "VoxScript — Freestyle to Lyrics" },
      {
        property: "og:description",
        content: "AI lyric writer that turns rough vocals into finished songs. 100% offline.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: Radio,
    title: "Live Punch-In Studio",
    body: "Real-time bar capture with metronome sync, waveform visualization, and teleprompter scrolling — like a real booth.",
    color: "text-emerald-400",
    glow: "bg-emerald-500/10",
  },
  {
    icon: Brain,
    title: "AI Ghostwriter + Style Memory",
    body: "Multi-pass cadence matching, anti-cliché burned-phrase filter, and permanent style memory that learns your voice.",
    color: "text-amber-400",
    glow: "bg-amber-500/10",
  },
  {
    icon: Fingerprint,
    title: "Cadence Fingerprints",
    body: "Extract the exact rhythmic DNA from any reference track — syllable targets, vowel palette, rime families.",
    color: "text-violet-400",
    glow: "bg-violet-500/10",
  },
  {
    icon: Target,
    title: "Pocket Grid Analysis",
    body: "See exactly how your bars fit the rhythmic pocket. Over/under syllable count per bar with visual heatmap.",
    color: "text-sky-400",
    glow: "bg-sky-500/10",
  },
  {
    icon: Shield,
    title: "100% Offline & Private",
    body: "Zero API keys, zero cloud. Runs on local LLMs (LM Studio, Ollama) and local Whisper — your audio never leaves your machine.",
    color: "text-rose-400",
    glow: "bg-rose-500/10",
  },
  {
    icon: Zap,
    title: "1-Click Reference Ingest",
    body: "Search any song on the web, view extracted lyrics, and ingest into style memory or extract fingerprints — one click.",
    color: "text-orange-400",
    glow: "bg-orange-500/10",
  },
];

const STEPS = [
  { num: "01", icon: Mic,      title: "Record the idea",   body: "Freestyle, mumble, or hum straight over the beat — no real words needed." },
  { num: "02", icon: Sparkles,  title: "AI reads the flow",  body: "We analyze cadence, syllables, pauses, end sounds, and rhyme scheme." },
  { num: "03", icon: Sparkles,  title: "Lyrics generated",   body: "Finished bars matched to your exact rhythm, cadence-scored and ranked." },
  { num: "04", icon: Library,   title: "Refine & save",     body: "Lock bars you love, rewrite the rest. Every version tracked." },
];

function Landing() {
  return (
    <div className="min-h-screen overflow-x-hidden">
      {/* Animated gradient backdrop */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-primary/5 blur-[120px] animate-pulse" style={{ animationDuration: "8s" }} />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-violet-500/5 blur-[120px] animate-pulse" style={{ animationDuration: "12s" }} />
        <div className="absolute top-[40%] right-[20%] w-[30%] h-[30%] rounded-full bg-emerald-500/3 blur-[100px] animate-pulse" style={{ animationDuration: "10s" }} />
      </div>

      {/* Header */}
      <header className="px-4 sm:px-6 py-4 sm:py-5 flex items-center justify-between max-w-6xl mx-auto">
        <Link to="/" className="flex items-center gap-2">
          <Mic className="h-5 w-5 text-primary" />
          <span className="font-display font-semibold text-lg">VoxScript</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link to="/connect">
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Cpu className="h-4 w-4 mr-1.5" />
              Connect AI
            </Button>
          </Link>
          <Link to="/library">
            <Button variant="outline" size="sm">
              Open App
            </Button>
          </Link>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-20 sm:pb-28 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-xs text-primary font-medium mb-8 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            100% Local-First · Zero Cloud Lock-in
          </div>

          <h1 className="font-display text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight leading-[1.1]">
            Mumble the flow.
            <br />
            <span className="bg-gradient-to-r from-primary via-amber-300 to-orange-400 bg-clip-text text-transparent">
              We write the bars.
            </span>
          </h1>

          <p className="text-base sm:text-lg text-muted-foreground mt-6 sm:mt-8 max-w-2xl mx-auto leading-relaxed">
            Freestyle, mumble, or hum a melody over your beat. VoxScript reads the
            cadence — syllables, pauses, rhymes — and writes finished lyrics you
            can punch in over your original take. <strong className="text-foreground/80">Runs entirely on your machine.</strong>
          </p>

          <div className="mt-10 sm:mt-12 flex flex-col sm:flex-row gap-3 justify-center items-center">
            <Link to="/new">
              <Button size="lg" className="text-base px-8 h-12 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-shadow">
                <Mic className="h-5 w-5 mr-2" />
                Start a Track
              </Button>
            </Link>
            <Link to="/library">
              <Button size="lg" variant="outline" className="text-base px-8 h-12">
                Open Library
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>

          {/* Quick tech badges */}
          <div className="mt-10 flex flex-wrap justify-center gap-2">
            {["React 19", "TanStack Start", "Tailwind v4", "IndexedDB", "OPFS", "Web Audio API"].map((t) => (
              <Badge key={t} variant="outline" className="text-[10px] font-mono text-muted-foreground border-border/50">
                {t}
              </Badge>
            ))}
          </div>
        </section>

        {/* How It Works */}
        <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-20 sm:pb-28">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-center mb-4">How It Works</h2>
          <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
            From raw vocal take to polished lyrics in four steps.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 sm:gap-5">
            {STEPS.map(({ num, icon: Icon, title, body }) => (
              <div
                key={num}
                className="relative p-5 sm:p-6 rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm hover:border-primary/40 transition-all duration-300 group"
              >
                <span className="absolute top-4 right-4 text-4xl font-display font-bold text-muted/20 group-hover:text-primary/15 transition-colors">
                  {num}
                </span>
                <Icon className="h-5 w-5 text-primary mb-3" />
                <h3 className="font-display font-semibold text-sm">{title}</h3>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Feature Grid */}
        <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-20 sm:pb-28">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-center mb-4">Studio Features</h2>
          <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
            Everything a punch-in artist needs — no cloud subscription required.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {FEATURES.map(({ icon: Icon, title, body, color, glow }) => (
              <div
                key={title}
                className="relative p-5 sm:p-6 rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm hover:border-primary/30 transition-all duration-300 group overflow-hidden"
              >
                {/* Subtle glow behind icon */}
                <div className={`absolute top-3 left-3 w-12 h-12 rounded-full ${glow} blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                <div className="relative">
                  <Icon className={`h-6 w-6 ${color} mb-3`} />
                  <h3 className="font-display font-semibold text-sm">{title}</h3>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-20 sm:pb-28 text-center">
          <div className="p-8 sm:p-12 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-violet-500/5 backdrop-blur-sm">
            <h2 className="font-display text-2xl sm:text-3xl font-bold mb-4">
              Ready to write?
            </h2>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              No sign-up required. Just connect a local LLM and start recording.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/new">
                <Button size="lg" className="px-8 h-12 shadow-lg shadow-primary/20">
                  <Mic className="h-5 w-5 mr-2" />
                  Create Your First Track
                </Button>
              </Link>
              <Link to="/connect">
                <Button size="lg" variant="outline" className="px-8 h-12">
                  <Cpu className="h-5 w-5 mr-2" />
                  Connect Local AI
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-6 sm:py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Mic className="h-3.5 w-3.5 text-primary" />
            <span>VoxScript — open-source, local-first</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/ChiragNSundar/Vocal-Muse"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              GitHub
            </a>
            <span className="text-border">·</span>
            <span>Inspired by VoxSketch AI</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
