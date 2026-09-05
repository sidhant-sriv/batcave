import { MessagesValue, StateSchema } from '@langchain/langgraph';

/**
 * The conversation itself, and the only thing this agent keeps between turns.
 * `createAgent` supplies this channel whether or not it is declared, so what
 * this buys is visibility: the state the checkpointer persists is spelled out
 * in the repo rather than inferred from the framework.
 *
 * It has to stay `MessagesValue`. Fields declared here are spread *over* the
 * built-in ones, so a hand-written reducer would replace the default rather
 * than sit beside it, and the default is `messagesStateReducer`: it appends,
 * and it replaces an existing message that has the same id. Both halves are
 * load-bearing. The chat route sends the user's turn under a stable id so that
 * a retry after a dead worker overwrites the message in place instead of
 * asking it a second time, and `turnAfter` finds that same id to work out what
 * this turn produced.
 *
 * Add fields alongside `messages` to carry more between turns. Anything added
 * here is checkpointed per thread, so keep it small and serialisable.
 */
export const agentState = new StateSchema({
  messages: MessagesValue,
});
