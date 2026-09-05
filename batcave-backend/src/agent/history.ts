import type { BaseMessage } from '@langchain/core/messages';
import { D1Saver } from './checkpointer';
import { turnsOf, type ChatTurn } from './format';

/**
 * A thread as the checkpointer holds it, newest checkpoint only, which is the
 * one that carries the whole message list.
 *
 * Read through the saver rather than through `buildAgent` on purpose: listing
 * history is a single D1 query and needs no model, no tools and no Groq key.
 *
 * `null` means there is no checkpoint under that thread id, either because the
 * conversation never existed or because nothing was ever committed to it.
 */
export async function threadHistory(
  db: D1Database,
  threadId: string,
): Promise<ChatTurn[] | null> {
  const tuple = await new D1Saver(db).getTuple({
    configurable: { thread_id: threadId, checkpoint_ns: '' },
  });
  if (!tuple) return null;

  const messages = tuple.checkpoint.channel_values?.messages as BaseMessage[] | undefined;
  return turnsOf(messages);
}
