import { createMiddleware } from 'langchain';

/**
 * Ask Groq for one tool call at a time. Without it the model can propose a
 * search and an update in the same round, and the update would be deciding on
 * an id it has not seen yet. `modelSettings` is bound to the model alongside
 * the tools on each request, so the flag reaches the wire.
 *
 * If a model ignores the flag the taskIdGuard still refuses the premature
 * update, and the model retries once it has the search result.
 */
export const sequentialToolCalls = createMiddleware({
  name: 'sequentialToolCalls',
  wrapModelCall: (request, handler) =>
    handler({
      ...request,
      modelSettings: { ...request.modelSettings, parallel_tool_calls: false },
    }),
});
