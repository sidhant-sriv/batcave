import { useSyncExternalStore } from 'react';

/**
 * Which of the three shells is on screen.
 *
 * The breakpoints are the layout's own, not a framework's: they are the widths
 * at which a column stops fitting, and both are also Tailwind's `xl` and `lg`
 * so a utility and this hook can never disagree about where a break happens.
 *
 *   wide    >= 1280   navigator 220 + surface + console 400
 *   medium  >= 1024   navigator collapses to the 56px icon rail, console 360
 *   narrow   < 1024   one surface at a time; navigator and console are overlays
 *
 * The console is deliberately the LAST thing to go. A layout whose premise is
 * "the agent sits beside the record it is changing" cannot answer a shortage of
 * space by removing the agent, so the navigator gives up its labels first.
 *
 * This is a media query rather than a container query because what it decides
 * is the shape of the shell itself, which has no container to be relative to.
 */

export type Layout = 'wide' | 'medium' | 'narrow';

const WIDE = '(min-width: 1280px)';
const MEDIUM = '(min-width: 1024px)';

/** Absent in some test environments; treated as the widest case. */
const supported = (): boolean => typeof window !== 'undefined' && 'matchMedia' in window;

function subscribe(onChange: () => void): () => void {
  if (!supported()) return () => {};

  const lists = [window.matchMedia(WIDE), window.matchMedia(MEDIUM)];
  for (const list of lists) list.addEventListener('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange);
  };
}

export function currentLayout(): Layout {
  if (!supported()) return 'wide';
  if (window.matchMedia(WIDE).matches) return 'wide';
  if (window.matchMedia(MEDIUM).matches) return 'medium';
  return 'narrow';
}

export function useLayout(): Layout {
  // The snapshot is a string, so it is referentially stable by construction and
  // needs no memoisation to avoid an infinite re-render.
  return useSyncExternalStore(subscribe, currentLayout, () => 'wide' as const);
}
