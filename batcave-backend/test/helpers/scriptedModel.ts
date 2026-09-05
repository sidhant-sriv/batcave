import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';

export interface ScriptStep {
  text?: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; id: string }>;
}

interface Shared {
  cursor: { current: number };
  bindings: Record<string, unknown>[];
}

/**
 * A model whose replies are written in advance, so a test can say exactly what
 * the loop should do. Preferred over `FakeToolCallingModel` because that one
 * derives message ids from its own step counter, and ids are how the messages
 * reducer decides whether to append or replace, which makes multi-turn
 * checkpointed tests behave in surprising ways.
 *
 * When the script runs out, the last step repeats. A final step that calls a
 * tool therefore loops until the recursion limit, which is what the round-limit
 * test wants; a final step that only replies ends the turn.
 */
export class ScriptedModel extends BaseChatModel {
  readonly script: ScriptStep[];
  readonly shared: Shared;

  constructor(script: ScriptStep[], shared?: Shared) {
    super({});
    this.script = script;
    this.shared = shared ?? { cursor: { current: 0 }, bindings: [] };
  }

  _llmType(): string {
    return 'scripted';
  }

  /** Every kwargs object the agent bound, so a test can see model settings. */
  get bindings(): Record<string, unknown>[] {
    return this.shared.bindings;
  }

  bindTools(_tools: unknown[], kwargs?: Record<string, unknown>): ScriptedModel {
    this.shared.bindings.push(kwargs ?? {});
    return new ScriptedModel(this.script, this.shared);
  }

  async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
    const index = Math.min(this.shared.cursor.current, this.script.length - 1);
    const step = this.script[index] ?? {};
    this.shared.cursor.current += 1;

    const text = step.text ?? '';
    const message = new AIMessage({
      content: text,
      tool_calls: step.toolCalls?.map((call) => ({ ...call, type: 'tool_call' as const })),
    });

    return { generations: [{ text, message }], llmOutput: {} };
  }
}
