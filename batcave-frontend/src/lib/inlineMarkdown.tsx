import type { ReactNode } from 'react';

/**
 * The smallest markdown renderer that tells the truth.
 *
 * The model writes prose with light markdown in it — `**bold**` around a task
 * title it just changed, occasionally `` `code` `` or `*emphasis*`. Rendering
 * that literally leaks asterisks into the transcript; pulling in a full
 * markdown library to fix it would drag in a parser, a sanitiser and a
 * dependency to keep patched, for three inline constructs.
 *
 * So: three constructs, nothing else. Block structure is deliberately not
 * handled — the agent's numbered lists are plain lines, and the container
 * renders with `white-space: pre-wrap`, so they already look correct. Headings,
 * tables and links do not appear in this agent's output and are left alone
 * rather than half-supported.
 *
 * Nothing here interprets HTML, so there is no injection surface: the input is
 * split on delimiters and every fragment is emitted as a React text child.
 */

/** Ordered by precedence. Code first, so `**` inside a span stays literal. */
const PATTERN = /(`[^`\n]+`|\*\*[^*\n]+\*\*|(?<![*\w])\*[^*\n]+\*(?!\w))/g;

export function renderInlineMarkdown(text: string): ReactNode[] {
  return text.split(PATTERN).map((fragment, index) => {
    if (!fragment) return null;

    if (fragment.startsWith('`') && fragment.endsWith('`') && fragment.length > 2) {
      return (
        <code key={index} className="font-mono text-mono-md text-secondary">
          {fragment.slice(1, -1)}
        </code>
      );
    }

    if (fragment.startsWith('**') && fragment.endsWith('**') && fragment.length > 4) {
      return (
        <strong key={index} className="font-semibold text-primary">
          {fragment.slice(2, -2)}
        </strong>
      );
    }

    if (fragment.startsWith('*') && fragment.endsWith('*') && fragment.length > 2) {
      return (
        <em key={index} className="italic">
          {fragment.slice(1, -1)}
        </em>
      );
    }

    return fragment;
  });
}
