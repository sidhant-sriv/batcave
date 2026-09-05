/**
 * Contrast gate.
 *
 * Parses `src/styles/tokens.css`, resolves the semantic tokens through their
 * primitives for each theme, and checks every pair the design actually claims
 * to meet. Run with `bun run check:contrast`; exits non-zero on a regression,
 * so it can sit in CI.
 *
 * The point is not to compute contrast once and write the number in a comment —
 * it is that the ramp and the roles can be edited later by someone who does not
 * know which steps were load-bearing, and find out immediately if they broke a
 * floor.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = resolve(HERE, '../src/styles/tokens.css');

/* --- OKLCH → sRGB → relative luminance --------------------------------- */

/** Inverse of the sRGB transfer function, per WCAG 2.x. */
function linearise(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function gamma(channel: number): number {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/** OKLCH to gamma-encoded sRGB, clamped to gamut. */
function oklchToSrgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const rgb: [number, number, number] = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  return rgb.map((c) => Math.min(1, Math.max(0, gamma(c)))) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

function contrast(fg: string, bg: string): number {
  const a = luminance(parseColor(fg));
  const b = luminance(parseColor(bg));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const OKLCH = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/;

function parseColor(value: string): [number, number, number] {
  const match = OKLCH.exec(value);
  if (!match) throw new Error(`Not an oklch() colour: ${value}`);
  return oklchToSrgb(Number(match[1]), Number(match[2]), Number(match[3]));
}

/* --- Token parsing ------------------------------------------------------ */

type Tokens = Map<string, string>;

/**
 * Reads one selector's declarations out of the stylesheet.
 *
 * A hand-rolled scan rather than a CSS parser: the file is ours, its shape is
 * known, and a dependency that has to be kept current is a poor trade for
 * twenty lines. It reads every block matching the selector, because the tokens
 * are split across several `:root` blocks by tier.
 */
function blocksFor(source: string, selector: string): Tokens {
  const tokens: Tokens = new Map();
  // Comments are stripped first. Declarations are found by splitting on `;`,
  // and a comment sitting above a property would otherwise be glued to the
  // front of its name — which silently skips the declaration rather than
  // failing, so it has to be removed rather than tolerated.
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRe = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');

  for (const block of css.matchAll(blockRe)) {
    for (const line of block[1]!.split(';')) {
      const [name, ...rest] = line.split(':');
      const key = name?.trim();
      if (!key?.startsWith('--')) continue;
      tokens.set(key, rest.join(':').trim());
    }
  }

  return tokens;
}

/** Follows `var(--x)` chains until an actual colour falls out. */
function resolve_(tokens: Tokens, name: string, depth = 0): string {
  if (depth > 12) throw new Error(`Cyclic token: ${name}`);

  const value = tokens.get(name);
  if (value === undefined) throw new Error(`Undefined token: ${name}`);

  const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
  return ref ? resolve_(tokens, ref[1]!, depth + 1) : value;
}

/* --- The claims -------------------------------------------------------- */

interface Check {
  fg: string;
  bg: string;
  min: number;
  why: string;
}

/**
 * Every pair the design commits to. 4.5 for anything carrying words, 3.0 for
 * boundaries and focus rings.
 *
 * Note what is deliberately absent: `--border-hairline` against any surface.
 * Hairlines are decorative dividers and are documented as never being the sole
 * indicator of anything, so holding them to 3:1 would be testing a promise the
 * system does not make.
 */
const CHECKS: Check[] = [
  { fg: '--text-primary', bg: '--surface-app', min: 4.5, why: 'body text on the app ground' },
  { fg: '--text-primary', bg: '--surface-panel', min: 4.5, why: 'body text on a panel' },
  { fg: '--text-primary', bg: '--surface-raised', min: 4.5, why: 'body text on a raised panel' },
  { fg: '--text-secondary', bg: '--surface-app', min: 4.5, why: 'secondary text' },
  { fg: '--text-muted', bg: '--surface-app', min: 4.5, why: 'muted text — the floor step' },
  { fg: '--text-muted', bg: '--surface-panel', min: 4.5, why: 'micro-labels on a panel' },
  { fg: '--text-muted', bg: '--surface-raised', min: 4.5, why: 'micro-labels on a raised panel' },

  { fg: '--border-control', bg: '--surface-app', min: 3, why: 'control boundary' },
  { fg: '--border-focus', bg: '--surface-app', min: 3, why: 'focus ring on the app ground' },
  { fg: '--border-focus', bg: '--surface-panel', min: 3, why: 'focus ring on a panel' },

  { fg: '--accent-base', bg: '--surface-app', min: 4.5, why: 'accent text' },
  { fg: '--accent-fg', bg: '--accent-base', min: 4.5, why: 'label on the primary button' },

  { fg: '--status-todo-fg', bg: '--status-todo-bg', min: 4.5, why: 'todo pill' },
  { fg: '--status-progress-fg', bg: '--status-progress-bg', min: 4.5, why: 'in_progress pill' },
  { fg: '--status-done-fg', bg: '--surface-app', min: 4.5, why: 'done pill (transparent ground)' },

  { fg: '--priority-low-fg', bg: '--surface-app', min: 3, why: 'low priority segment' },
  { fg: '--priority-med-fg', bg: '--surface-app', min: 3, why: 'medium priority segment' },
  { fg: '--priority-high-fg', bg: '--surface-app', min: 3, why: 'high priority segment' },

  { fg: '--due-overdue-fg', bg: '--due-overdue-bg', min: 4.5, why: 'overdue chip' },
  { fg: '--due-today-fg', bg: '--due-today-bg', min: 4.5, why: 'due-today chip' },
  { fg: '--due-soon-fg', bg: '--due-soon-bg', min: 4.5, why: 'due-soon chip' },
  { fg: '--due-future-fg', bg: '--surface-app', min: 4.5, why: 'future due date' },
  { fg: '--due-none-fg', bg: '--surface-app', min: 3, why: 'no due date (an em dash)' },

  { fg: '--agent-executing-fg', bg: '--surface-app', min: 4.5, why: 'EXECUTING label' },
  { fg: '--agent-tool-ok-fg', bg: '--surface-raised', min: 4.5, why: 'tool succeeded' },
  { fg: '--agent-tool-fail-fg', bg: '--agent-tool-fail-bg', min: 4.5, why: 'tool failed' },
  { fg: '--agent-awaiting-fg', bg: '--agent-awaiting-bg', min: 4.5, why: 'awaiting your choice' },
  { fg: '--agent-busy-fg', bg: '--agent-busy-bg', min: 4.5, why: 'conversation busy' },

  { fg: '--feedback-success-fg', bg: '--feedback-success-bg', min: 4.5, why: 'success' },
  { fg: '--feedback-warning-fg', bg: '--feedback-warning-bg', min: 4.5, why: 'warning' },
  { fg: '--feedback-danger-fg', bg: '--feedback-danger-bg', min: 4.5, why: 'danger' },
  { fg: '--feedback-info-fg', bg: '--feedback-info-bg', min: 4.5, why: 'info' },

  { fg: '--chatitem-untitled-fg', bg: '--surface-app', min: 3, why: 'UNTITLED chat label' },
  { fg: '--chatitem-meta-fg', bg: '--surface-app', min: 4.5, why: 'chat list metadata' },
];

/* --- Run ---------------------------------------------------------------- */

const css = readFileSync(TOKENS, 'utf8');
const base = blocksFor(css, ':root');
const day = new Map([...base, ...blocksFor(css, "[data-theme='day']")]);

let failures = 0;

for (const [theme, tokens] of [
  ['night', base],
  ['day', day],
] as const) {
  console.log(`\n${theme}`);
  console.log('─'.repeat(72));

  for (const check of CHECKS) {
    let ratio: number;
    try {
      ratio = contrast(resolve_(tokens, check.fg), resolve_(tokens, check.bg));
    } catch (error) {
      console.log(`  ERROR  ${check.fg} on ${check.bg} — ${(error as Error).message}`);
      failures += 1;
      continue;
    }

    const pass = ratio >= check.min;
    if (!pass) failures += 1;

    console.log(
      `  ${pass ? 'pass' : 'FAIL'}  ${ratio.toFixed(2).padStart(6)}:1  ` +
        `(min ${check.min})  ${check.why}`,
    );
  }
}

console.log();
if (failures > 0) {
  console.error(`${failures} contrast check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('All contrast floors met in both themes.');
