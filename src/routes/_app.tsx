import { createFileRoute, Outlet, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Mic, Library as LibraryIcon, Plus, Settings as SettingsIcon, Cpu, Fingerprint as FingerprintIcon, Radio } from "lucide-react";
import { LocalStatusPill } from "@/components/LocalStatusPill";

export const Route = createFileRoute("/_app")({
  component: AppShell,
});

function AppShell() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-3">
          <Link to="/library" className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-primary" />
            <span className="font-display font-semibold">VoxScript</span>
          </Link>
          <nav className="flex items-center gap-2">
            <LocalStatusPill />
            <Link to="/library">
              <Button variant="ghost" size="sm">
                <LibraryIcon className="h-4 w-4 mr-1.5" />
                Library
              </Button>
            </Link>
            <Link to="/references">
              <Button variant="ghost" size="sm">
                <FingerprintIcon className="h-4 w-4 mr-1.5" />
                References
              </Button>
            </Link>
            <Link to="/connect">
              <Button variant="ghost" size="sm">
                <Cpu className="h-4 w-4 mr-1.5" />
                Connect
              </Button>
            </Link>
            <Link to="/settings">
              <Button variant="ghost" size="sm">
                <SettingsIcon className="h-4 w-4 mr-1.5" />
                Settings
              </Button>
            </Link>
            <Link to="/live">
              <Button variant="ghost" size="sm">
                <Radio className="h-4 w-4 mr-1.5" />
                Live
              </Button>
            </Link>
            <Link to="/new">
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1.5" />
                New
              </Button>
            </Link>
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
