import { useCallback, useSyncExternalStore } from 'react';

/**
 * Local preferences: theme and row density.
 *
 * Both live in `localStorage` because there is no auth and therefore nowhere
 * server-side to hang a per-user setting. When auth arrives these become the
 * first two fields of a preferences record; until then the storage key is
 * namespaced so that move is a migration rather than an archaeology exercise.
 *
 * The theme is written straight onto `<html data-theme>`, matching the inline
 * script in index.html that stamps it before first paint.
 */

export type Theme = 'night' | 'day';
export type Density = 'dense' | 'comfy';

const THEME_KEY = 'batcave.theme';
const DENSITY_KEY = 'batcave.density';

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read<T extends string>(key: string, valid: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return valid.includes(stored as T) ? (stored as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A private-mode quota error must not take the interaction down with it.
  }
}

/* --- Theme --------------------------------------------------------------- */

const THEMES = ['night', 'day'] as const;

export function getTheme(): Theme {
  // The DOM is the source of truth, because the inline bootstrap script already
  // resolved the system preference before React mounted. Re-deriving it here
  // would disagree with what is on screen.
  const stamped = document.documentElement.dataset.theme;
  return stamped === 'day' || stamped === 'night' ? stamped : read(THEME_KEY, THEMES, 'night');
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  write(THEME_KEY, theme);
  emit();
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, getTheme, () => 'night' as const);
  const toggle = useCallback((next: Theme) => setTheme(next), []);
  return [theme, toggle];
}

/* --- Density ------------------------------------------------------------- */

const DENSITIES = ['dense', 'comfy'] as const;

export function getDensity(): Density {
  return read(DENSITY_KEY, DENSITIES, 'dense');
}

export function setDensity(density: Density): void {
  write(DENSITY_KEY, density);
  emit();
}

export function useDensity(): [Density, (density: Density) => void] {
  const density = useSyncExternalStore(subscribe, getDensity, () => 'dense' as const);
  const update = useCallback((next: Density) => setDensity(next), []);
  return [density, update];
}

/* --- Console dock -------------------------------------------------------- */

/**
 * Whether the console is docked beside the surface.
 *
 * Persisted, and defaulting to open: the console being present is the shell's
 * premise, not an opt-in. It is remembered because someone who closes it has
 * decided they want the width for the table, and re-opening it on every reload
 * would be arguing with them.
 *
 * This governs only the docked pane. On a phone the console is an overlay, and
 * an overlay that restored itself over the task list on load would hide the
 * thing the user opened the app to see.
 */

const CONSOLE_KEY = 'batcave.console';
const CONSOLE_STATES = ['open', 'closed'] as const;

export function getConsoleOpen(): boolean {
  return read(CONSOLE_KEY, CONSOLE_STATES, 'open') === 'open';
}

export function setConsoleOpen(open: boolean): void {
  write(CONSOLE_KEY, open ? 'open' : 'closed');
  emit();
}

export function useConsoleOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(subscribe, getConsoleOpen, () => true);
  const update = useCallback((next: boolean) => setConsoleOpen(next), []);
  return [open, update];
}

/* --- Console width ------------------------------------------------------- */

/**
 * How wide the docked console is, in pixels.
 *
 * A number rather than a t-shirt size, because the split between the record and
 * the agent is the one proportion in this layout nobody else can pick for you:
 * it depends on the table you keep open and the window you keep it in. `null`
 * means never dragged, which is what lets the breakpoint defaults still apply
 * instead of freezing one width into storage on first load.
 *
 * The bounds are the layout's, not a taste. Below CONSOLE_W_MIN the composer
 * and the tool chips start wrapping; past CONSOLE_W_MAX the console is reading
 * as the surface rather than beside it; and SURFACE_W_MIN keeps a table's worth
 * of room for the thing the console exists to sit next to. `--surface-w-min` in
 * tokens.css mirrors that last number so CSS can hold the same line when the
 * window shrinks under a console that was already dragged wide.
 */

const CONSOLE_W_KEY = 'batcave.console.w';

export const CONSOLE_W_MIN = 320;
export const CONSOLE_W_MAX = 720;
const SURFACE_W_MIN = 480;

/** Per breakpoint, and the same numbers as `--console-w` / `--console-w-md`. */
export const CONSOLE_W_DEFAULT = 400;
export const CONSOLE_W_DEFAULT_MD = 360;

export function clampConsoleWidth(width: number, viewport: number): number {
  // In a window too small to honour both bounds the minimum wins: a console
  // narrower than its own composer is broken, a crowded surface is only tight.
  const max = Math.max(CONSOLE_W_MIN, Math.min(CONSOLE_W_MAX, viewport - SURFACE_W_MIN));
  return Math.round(Math.min(max, Math.max(CONSOLE_W_MIN, width)));
}

export function getConsoleWidth(): number | null {
  try {
    const stored = Number(localStorage.getItem(CONSOLE_W_KEY));
    // A missing key reads as 0, and 0 is not a width anyone dragged to.
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  } catch {
    return null;
  }
}

/** `null` forgets the drag, which is how the pane goes back to its default. */
export function setConsoleWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(CONSOLE_W_KEY);
    else localStorage.setItem(CONSOLE_W_KEY, String(Math.round(width)));
  } catch {
    // A private-mode quota error must not take the interaction down with it.
  }
  emit();
}

export function useConsoleWidth(): [number | null, (width: number | null) => void] {
  const width = useSyncExternalStore(subscribe, getConsoleWidth, () => null);
  const update = useCallback((next: number | null) => setConsoleWidth(next), []);
  return [width, update];
}
