/**
 * Decision session utilities.
 *
 * - confirmBulkOverride(): prompts before overwriting existing decisions.
 * - Session auto-save to sessionStorage so a VA doesn't lose work on refresh.
 *
 * Key format: `adprune_decisions_${module}_${fileSlug}`
 * `fileSlug` is derived from the uploaded file name so re-uploading the same
 * file surfaces the saved session, while a new file starts fresh.
 */

export type DecisionsMap = Record<string | number, string>;

export interface SavedSession {
  decisions: DecisionsMap;
  timestamp: number;
  bleederCount: number;
  fileName: string;
}

const KEY_PREFIX = "adprune_decisions_";

function slugify(name: string): string {
  return (name || "session").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
}

export function getSessionKey(moduleType: string, fileName: string): string {
  return `${KEY_PREFIX}${moduleType}_${slugify(fileName)}`;
}

export function loadSavedSession(moduleType: string, fileName: string): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(getSessionKey(moduleType, fileName));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSession;
    if (!parsed?.decisions || typeof parsed.decisions !== "object") return null;
    if (Object.keys(parsed.decisions).length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(
  moduleType: string,
  fileName: string,
  decisions: DecisionsMap,
  bleederCount: number,
): void {
  try {
    const payload: SavedSession = {
      decisions,
      timestamp: Date.now(),
      bleederCount,
      fileName,
    };
    sessionStorage.setItem(getSessionKey(moduleType, fileName), JSON.stringify(payload));
  } catch {
    // Storage full / disabled — ignore silently.
  }
}

export function clearSession(moduleType: string, fileName: string): void {
  try {
    sessionStorage.removeItem(getSessionKey(moduleType, fileName));
  } catch {
    // ignore
  }
}

/**
 * Ask for confirmation if the bulk action would overwrite existing, different decisions.
 * Returns true when the caller should proceed with the action.
 */
export function confirmBulkOverride(
  newDecision: string,
  rowKeys: Array<string | number>,
  decisions: DecisionsMap,
): boolean {
  const conflicts = rowKeys.filter((k) => {
    const existing = decisions[k];
    return existing && existing !== newDecision;
  });
  if (conflicts.length === 0) return true;
  return window.confirm(
    `Apply "${newDecision}" to all ${rowKeys.length} rows? This will override ${conflicts.length} existing decision(s).`,
  );
}

export function formatSavedAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return new Date(timestamp).toLocaleString();
}
