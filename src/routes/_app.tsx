import { createFileRoute, Outlet, Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Mic, Library as LibraryIcon, Plus, Settings as SettingsIcon,
  Cpu, Fingerprint as FingerprintIcon, Radio, Menu, X,
} from "lucide-react";
import { LocalStatusPill } from "@/components/LocalStatusPill";
import { KeyboardShortcutsOverlay } from "@/components/KeyboardShortcutsOverlay";
import { useShortcuts } from "@/hooks/use-shortcuts";

export const Route = createFileRoute("/_app")({
  component: AppShell,
});

const NAV_ITEMS = [
  { to: "/library",    icon: LibraryIcon,      label: "Library" },
  { to: "/references", icon: FingerprintIcon,  label: "References" },
  { to: "/connect",    icon: Cpu,              label: "Connect" },
  { to: "/settings",   icon: SettingsIcon,     label: "Settings" },
  { to: "/live",       icon: Radio,            label: "Live" },
] as const;

function AppShell() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useShortcuts({
    onToggleOverlay: () => setShortcutsOpen((p) => !p),
  });

  // Close mobile menu on route change
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  return (
    <div className="min-h-screen">
      <header className="border-b sticky top-0 z-40 bg-background/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <Link to="/library" className="flex items-center gap-2 shrink-0">
            <Mic className="h-5 w-5 text-primary" />
            <span className="font-display font-semibold">VoxScript</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1.5">
            <LocalStatusPill />
            {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
              <Link key={to} to={to}>
                <Button
                  variant={currentPath.startsWith(to) ? "secondary" : "ghost"}
                  size="sm"
                  className="text-xs"
                >
                  <Icon className="h-3.5 w-3.5 mr-1.5" />
                  {label}
                </Button>
              </Link>
            ))}
            <Link to="/new">
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1.5" />
                New
              </Button>
            </Link>
          </nav>

          {/* Mobile hamburger */}
          <div className="flex md:hidden items-center gap-2">
            <LocalStatusPill />
            <Link to="/new">
              <Button size="sm" className="h-8 px-2.5">
                <Plus className="h-4 w-4" />
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setMobileMenuOpen((p) => !p)}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t bg-background/95 backdrop-blur-sm animate-in slide-in-from-top-2 duration-200">
            <nav className="max-w-5xl mx-auto px-4 py-3 flex flex-col gap-1">
              {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
                <Link key={to} to={to} onClick={() => setMobileMenuOpen(false)}>
                  <Button
                    variant={currentPath.startsWith(to) ? "secondary" : "ghost"}
                    size="sm"
                    className="w-full justify-start text-sm"
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    {label}
                  </Button>
                </Link>
              ))}
            </nav>
          </div>
        )}
      </header>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Outlet />
      </main>

      {/* Keyboard shortcuts overlay */}
      <KeyboardShortcutsOverlay
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
    </div>
  );
}
