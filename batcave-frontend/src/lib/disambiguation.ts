import type { AgentAction, ChatTurn, CompactTask } from '@/api/types';

/**
 * Deriving "the agent is asking you to choose" from a turn.
 *
 * The agent's prompt tells it that when several tasks match, it must stop, list
 * the candidates, and ask which one — rather than guess. That is the right
 * behaviour, but it arrives as prose: there is no `awaiting_choice` flag on the
 * wire, so the shape of the turn is all there is to read.
 *
 * The rule below is a heuristic and is documented as one. It errs toward *not*
 * claiming a disambiguation: a false negative renders a normal result block,
 * which is merely less helpful, whereas a false positive would present a
 * selection UI for a question that was not a choice.
 *
 * Pure, so it is testable without a network or a model.
 */

export interface Disambiguation {
  /** The agent's question, verbatim. */
  prompt: string;
  /** Candidates in the order the model saw them — the ordinals depend on it. */
  candidates: CompactTask[];
}

const SEARCH = 'search_tasks';
const MUTATIONS = new Set(['create_task', 'update_task']);

export function disambiguationOf(turn: ChatTurn): Disambiguation | null {
  const { reply, actions } = turn;

  // A question is the whole premise. Without one, the agent was reporting, not
  // asking, and a numbered list is just a list.
  const prompt = reply?.trim();
  if (!prompt || !prompt.endsWith('?')) return null;

  // If anything was written, the agent resolved the ambiguity and acted. Any
  // trailing question is a follow-up, not a blocked choice.
  if (actions.some((action) => MUTATIONS.has(action.tool))) return null;

  const search = lastSuccessfulSearch(actions);
  if (!search) return null;

  // One candidate is not a choice; zero is a "nothing matched" reply.
  const candidates = search.tasks ?? [];
  if (candidates.length < 2) return null;

  return { prompt, candidates };
}

function lastSuccessfulSearch(actions: AgentAction[]): AgentAction | null {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index]!;
    if (action.tool === SEARCH && action.ok) return action;
  }
  return null;
}
