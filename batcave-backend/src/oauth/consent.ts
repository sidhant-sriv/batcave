import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

/**
 * The one page in this project a stranger sees before they are anyone.
 *
 * It has to say three things without a scroll: which client is asking, what it
 * will be able to do, and that approving means signing in to GitHub. Anything
 * else on the page is something to read instead of those.
 *
 * The client's name comes from its own registration, which means it is
 * attacker-controlled text. `html` escapes every interpolation, and the name is
 * interpolated rather than raw for exactly that reason — a client called
 * `<script>` is a string here, not a tag.
 *
 * Styled from the frontend's tokens rather than by importing them, because a
 * Worker cannot serve that stylesheet and one page is not worth a build step.
 */

interface ConsentPage {
  clientName: string;
  clientUri?: string;
  scopes: string[];
  nonce: string;
  /** Where to post approval: this route, carrying the same OAuth query. */
  action: string;
}

const SCOPE_TEXT: Record<string, string> = {
  tasks: 'Read and change your tasks, and set or cancel their reminders.',
};

const STYLES = `
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: oklch(0.145 0.006 60); color: oklch(0.955 0.003 60);
    font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif; font-size: 15px; line-height: 1.6;
    padding: 24px;
  }
  main { width: 100%; max-width: 420px; }
  .mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px;
    letter-spacing: 0.08em; text-transform: uppercase; }
  .wordmark { color: oklch(0.78 0.16 72); margin-bottom: 24px; }
  h1 { font-size: 20px; line-height: 1.15; font-weight: 600; margin: 0 0 12px; }
  p { margin: 0 0 16px; color: oklch(0.72 0.005 60); }
  .client { color: oklch(0.955 0.003 60); font-weight: 600; }
  ul { list-style: none; padding: 0; margin: 0 0 24px; border-top: 1px solid oklch(0.245 0.008 60); }
  li { padding: 12px 0; border-bottom: 1px solid oklch(0.245 0.008 60);
    color: oklch(0.72 0.005 60); display: flex; gap: 10px; }
  li b { color: oklch(0.955 0.003 60); font-weight: 500; }
  .actions { display: flex; gap: 8px; }
  button {
    flex: 1; min-height: 44px; border-radius: 2px; border: 0; cursor: pointer;
    font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px;
    letter-spacing: 0.08em; text-transform: uppercase;
    background: oklch(0.78 0.16 72); color: oklch(0.16 0.03 68);
  }
  button.secondary { background: transparent; color: oklch(0.72 0.005 60);
    border: 1px solid oklch(0.5 0.007 60); }
  .foot { margin: 20px 0 0; color: oklch(0.5 0.007 60); }
`;

export function renderConsentPage({
  clientName,
  clientUri,
  scopes,
  nonce,
  action,
}: ConsentPage): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connect to Batcave</title>
    <style>
      ${raw(STYLES)}
    </style>
  </head>
  <body>
    <main>
      <div class="mono wordmark">Batcave</div>

      <h1>Connect <span class="client">${clientName}</span>?</h1>
      <p>
        ${clientUri ? html`<span class="client">${clientUri}</span> is asking` : 'It is asking'} for
        access to your Batcave tasks. You will sign in with GitHub on the next screen.
      </p>

      <ul>
        ${scopes.map(
          (scope) =>
            html`<li>
              <b>${scope}</b>
              <span>${SCOPE_TEXT[scope] ?? 'Access to this part of Batcave.'}</span>
            </li>`,
        )}
      </ul>

      <form method="post" action="${action}">
        <input type="hidden" name="nonce" value="${nonce}" />
        <div class="actions">
          <button type="submit" name="decision" value="deny" class="secondary">Cancel</button>
          <button type="submit" name="decision" value="approve">Continue with GitHub</button>
        </div>
      </form>

      <p class="mono foot">Batcave is a demo. Everyone who signs in shares one task list.</p>
    </main>
  </body>
</html>`;
}
