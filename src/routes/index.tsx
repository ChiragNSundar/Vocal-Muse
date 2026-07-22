import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Mic, Sparkles, Library } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VoxScript — Freestyle to Lyrics" },
      {
        name: "description",
        content:
          "Upload your freestyle, mumble, or hum — VoxScript turns it into polished lyrics that match your flow.",
      },
      { property: "og:title", content: "VoxScript — Freestyle to Lyrics" },
      {
        property: "og:description",
        content: "AI lyric writer that turns rough vocals into finished songs.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto">
        <Link to="/" className="flex items-center gap-2">
          <Mic className="h-5 w-5 text-primary" />
          <span className="font-display font-semibold text-lg">VoxScript</span>
        </Link>
        <Link to="/library">
          <Button variant="ghost" size="sm">
            Open app
          </Button>
        </Link>
      </header>

      <main className="px-6">
        <section className="max-w-3xl mx-auto pt-20 pb-24 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-card text-xs text-muted-foreground mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Built for punch-in artists
          </div>
          <h1 className="font-display text-5xl md:text-6xl font-semibold tracking-tight">
            Mumble the flow.{" "}
            <span className="text-primary">We write the bars.</span>
          </h1>
          <p className="text-lg text-muted-foreground mt-6 max-w-xl mx-auto">
            Freestyle, mumble, or hum a melody over your beat. VoxScript reads the
            cadence — syllables, pauses, rhymes — and writes finished lyrics you
            can punch in over your original take.
          </p>
          <div className="mt-10 flex gap-3 justify-center">
            <Link to="/new">
              <Button size="lg">Start a track</Button>
            </Link>
          </div>
        </section>

        <section className="max-w-5xl mx-auto pb-24 grid md:grid-cols-4 gap-5">
          {[
            { icon: Mic, title: "1. Record the idea", body: "Freestyle or mumble straight over the beat — no words needed." },
            { icon: Sparkles, title: "2. AI reads the flow", body: "We analyze cadence, syllables, pauses, and rhyme scheme." },
            { icon: Sparkles, title: "3. Lyrics generated", body: "Finished bars matched to your exact rhythm, ready to punch in." },
            { icon: Library, title: "4. Refine & save", body: "Every session saved. Regenerate, tweak, and lay the vocal." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="p-6 rounded-xl border bg-card">
              <Icon className="h-5 w-5 text-primary mb-3" />
              <h3 className="font-display font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground mt-1">{body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
