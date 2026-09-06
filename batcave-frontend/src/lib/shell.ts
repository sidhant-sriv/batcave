import { createContext, useContext } from 'react';
import type { Layout } from './layout';

/**
 * What a surface needs to know about the shell around it.
 *
 * Only two things, and both exist because of the narrow layout: a surface's own
 * header is the only sensible place for the button that opens the navigator,
 * and there is no second header to put it in without doubling the chrome on the
 * screen that can least afford it.
 *
 * Deliberately not a store: nothing here is state a surface may change except
 * by asking, which is what these two callbacks are.
 */

export interface Shell {
  layout: Layout;
  /** Narrow only. Opens the navigator sheet. */
  openNav: () => void;
  /** Brings the console back, docked or as an overlay depending on the width. */
  openConsole: () => void;
}

const FALLBACK: Shell = { layout: 'wide', openNav: () => {}, openConsole: () => {} };

export const ShellContext = createContext<Shell>(FALLBACK);

export function useShell(): Shell {
  return useContext(ShellContext);
}
