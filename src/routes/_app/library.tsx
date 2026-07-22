import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTracks } from "@/lib/tracks.functions";
import { getDeviceId } from "@/lib/device-id";
import { listTracks as listLocalTracks, isLocalOnly, getDeviceId as getLocalDeviceId } from "@/lib/local-store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Mic, Plus, Database } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_app/library")({
  head: () => ({ meta: [{ title: "Your library · VoxScript" }] }),
  component: LibraryPage,
});

function LibraryPage() {
  const fetchTracks = useServerFn(listTracks);
  const localMode = isLocalOnly();
  const { data, isLoading } = useQuery({
    queryKey: ["tracks", localMode ? "local" : "cloud"],
    queryFn: async () => {
      if (localMode) {
        return listLocalTracks(getLocalDeviceId());
      }
      return fetchTracks({ data: { deviceId: getDeviceId() } });
    },
    refetchInterval: (q) => {
      const rows = q.state.data as { status: string }[] | undefined;
      return rows?.some((r) => r.status !== "done" && r.status !== "error") ? 3000 : false;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold">Your tracks</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every freestyle you've turned into lyrics.
          </p>
        </div>
        <Link to="/new">
          <Button>
            <Plus className="h-4 w-4 mr-1.5" /> New track
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid gap-3" aria-busy="true" aria-label="Loading tracks">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            </Card>
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <Card className="p-12 text-center">
          <Mic className="h-8 w-8 text-primary mx-auto mb-3" />
          <h3 className="font-display text-lg font-semibold">No tracks yet</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-5">
            Upload or record a freestyle to get started.
          </p>
          <Link to="/new">
            <Button>Create your first track</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-3">
          {data.map((t) => (
            <Link key={t.id} to="/track/$id" params={{ id: t.id }} className="block">
              <Card className="p-4 hover:border-primary/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-display font-semibold truncate">{t.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                      {localMode ? (
                        <>
                          <Database className="h-3 w-3" />
                          {formatDistanceToNow(new Date('createdAt' in t ? t.createdAt : t.created_at), { addSuffix: true })}
                        </>
                      ) : (
                        formatDistanceToNow(new Date('created_at' in t ? t.created_at : t.createdAt), { addSuffix: true })
                      )}
                    </div>
                  </div>
                  <StatusPill status={t.status} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    done: { label: "Ready", cls: "bg-primary/15 text-primary" },
    processing: { label: "Processing", cls: "bg-muted text-muted-foreground" },
    transcribing: { label: "Transcribing", cls: "bg-muted text-muted-foreground" },
    writing: { label: "Writing lyrics", cls: "bg-muted text-muted-foreground" },
    error: { label: "Failed", cls: "bg-destructive/15 text-destructive" },
  };
  const m = map[status] ?? map.processing;
  return <span className={`text-xs px-2 py-1 rounded-full ${m.cls}`}>{m.label}</span>;
}
