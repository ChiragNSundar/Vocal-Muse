/**
 * Bar Version History — stores every edit of every bar in localStorage.
 *
 * Used by the BarTimeline component to show version dots and allow restore.
 */

export interface BarVersion {
  /** Version number (1, 2, 3, ...) */
  version: number;
  /** The bar text at this version */
  text: string;
  /** ISO timestamp */
  timestamp: string;
  /** How this version was created */
  source: "original" | "ai-rewrite" | "manual-edit" | "ghost-accept" | "restored";
}

const STORE_KEY = "voxscript:bar-history";

function loadAll(): Record<string, BarVersion[]> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAll(store: Record<string, BarVersion[]>) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

/**
 * Record a new version of a bar.
 * @param barId Unique ID for the bar (e.g. trackId + barIndex)
 * @param text The new text content
 * @param source How this version was created
 */
export function recordBarVersion(
  barId: string,
  text: string,
  source: BarVersion["source"] = "manual-edit",
): BarVersion {
  const store = loadAll();
  const existing = store[barId] || [];

  // Don't record if text is identical to latest version
  if (existing.length > 0 && existing[existing.length - 1].text === text) {
    return existing[existing.length - 1];
  }

  const version: BarVersion = {
    version: existing.length + 1,
    text,
    timestamp: new Date().toISOString(),
    source,
  };

  store[barId] = [...existing, version];
  saveAll(store);
  return version;
}

/**
 * Get all versions of a bar.
 */
export function getBarHistory(barId: string): BarVersion[] {
  return loadAll()[barId] || [];
}

/**
 * Get the latest version of a bar.
 */
export function getLatestBarVersion(barId: string): BarVersion | null {
  const versions = getBarHistory(barId);
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

/**
 * Clear history for a specific bar.
 */
export function clearBarHistory(barId: string) {
  const store = loadAll();
  delete store[barId];
  saveAll(store);
}

/**
 * Clear all bar history (e.g. for a track delete).
 */
export function clearAllBarHistory() {
  localStorage.removeItem(STORE_KEY);
}
