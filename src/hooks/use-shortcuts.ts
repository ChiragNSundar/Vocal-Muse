import { useEffect, useCallback } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";

/**
 * Keyboard shortcut definitions.
 * Each shortcut maps a key combo to an action.
 */
export interface ShortcutDef {
  /** Unique id for the shortcut */
  id: string;
  /** Human-readable label shown in overlay */
  label: string;
  /** Category for grouping in the overlay */
  group: "Global" | "Studio" | "Live" | "Editor";
  /** The keyboard key (e.g. "n", "r", "/") */
  key: string;
  /** Modifier keys */
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Action to run. Return `true` to prevent default browser behavior. */
  action: () => boolean | void;
}

/** All registered shortcuts. Exported so the overlay can read them. */
export const SHORTCUTS: Omit<ShortcutDef, "action">[] = [
  { id: "new-track",     group: "Global",  key: "n",      ctrl: true, label: "New track" },
  { id: "go-library",    group: "Global",  key: "l",      ctrl: true, shift: true, label: "Go to Library" },
  { id: "go-live",       group: "Global",  key: "l",      alt: true, label: "Go to Live studio" },
  { id: "go-references", group: "Global",  key: "r",      alt: true, label: "Go to References" },
  { id: "go-connect",    group: "Global",  key: "k",      alt: true, label: "Go to Connect AI" },
  { id: "go-settings",   group: "Global",  key: ",",      ctrl: true, label: "Go to Settings" },
  { id: "show-shortcuts",group: "Global",  key: "?",      label: "Show keyboard shortcuts" },
  { id: "search-focus",  group: "Global",  key: "/",      label: "Focus search bar" },
];

/**
 * Hook: registers global keyboard shortcuts.
 * Provide `onToggleOverlay` to control the shortcuts overlay modal.
 */
export function useShortcuts(opts: {
  onToggleOverlay?: () => void;
  /** Custom shortcuts to add on top of the defaults (e.g. page-specific) */
  extra?: ShortcutDef[];
} = {}) {
  const navigate = useNavigate();

  const handler = useCallback(
    (e: KeyboardEvent) => {
      // Ignore when user is typing in an input / textarea / contenteditable
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditing =
        tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;

      // Special: "?" always works (shift+/)
      if (e.key === "?" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        opts.onToggleOverlay?.();
        return;
      }

      // Skip if editing (except Escape)
      if (isEditing && e.key !== "Escape") return;

      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const alt = e.altKey;
      const key = e.key.toLowerCase();

      // Built-in global shortcuts
      if (ctrl && !shift && !alt && key === "n") {
        e.preventDefault();
        navigate({ to: "/new" });
        return;
      }
      if (ctrl && shift && !alt && key === "l") {
        e.preventDefault();
        navigate({ to: "/library" });
        return;
      }
      if (alt && !ctrl && !shift && key === "l") {
        e.preventDefault();
        navigate({ to: "/live" });
        return;
      }
      if (alt && !ctrl && !shift && key === "r") {
        e.preventDefault();
        navigate({ to: "/references" });
        return;
      }
      if (alt && !ctrl && !shift && key === "k") {
        e.preventDefault();
        navigate({ to: "/connect" });
        return;
      }
      if (ctrl && !shift && !alt && key === ",") {
        e.preventDefault();
        navigate({ to: "/settings" });
        return;
      }

      // Run extra page-specific shortcuts
      if (opts.extra) {
        for (const s of opts.extra) {
          if (
            key === s.key.toLowerCase() &&
            !!s.ctrl === ctrl &&
            !!s.shift === shift &&
            !!s.alt === alt
          ) {
            const result = s.action();
            if (result !== false) e.preventDefault();
            return;
          }
        }
      }
    },
    [navigate, opts],
  );

  useEffect(() => {
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handler]);
}
