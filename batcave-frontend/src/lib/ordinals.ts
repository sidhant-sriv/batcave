/**
 * Ordinals for search results inside the transcript.
 *
 * These exist because of a specific thing users do: they read a numbered list
 * the agent produced and then say "mark the first one as done". For that to
 * work, the number the user sees has to be the number the model saw — which is
 * the position in the tool result array, nothing else. Never sort or filter a
 * result block before numbering it.
 */

const WORDS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
] as const;

/** Zero-padded display ordinal: index 0 renders as `01`. */
export function ordinalLabel(index: number): string {
  return String(index + 1).padStart(2, '0');
}

/**
 * The phrase to send when the user picks candidate `index`.
 *
 * Worded the way the agent's own prompt taught it to present lists, so the
 * reference resolves against the numbered list still in its context. Past the
 * tenth it falls back to the digit, which reads fine and stays unambiguous.
 */
export function ordinalPhrase(index: number): string {
  const word = WORDS[index];
  return word ? `the ${word} one` : `number ${index + 1}`;
}
