import { env } from 'cloudflare:test';

/**
 * The pool no longer isolates storage per test, so every D1-backed test starts
 * by emptying the tables the migrations created. Explicit rather than implicit,
 * and independent of whatever the pool decides to do next.
 */
export async function resetDb(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM tasks'),
    env.DB.prepare('DELETE FROM agent_runs'),
    env.DB.prepare('DELETE FROM writes'),
    env.DB.prepare('DELETE FROM checkpoints'),
    env.DB.prepare('DELETE FROM chat_threads'),
    env.DB.prepare('DELETE FROM chats'),
  ]);
}
