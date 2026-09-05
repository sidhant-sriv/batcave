import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import type { Env as WorkerEnv } from '../src/types/task';

/**
 * `cloudflare:test` types its `env` as `Cloudflare.Env`, the namespace
 * `wrangler types` would generate. Declared here instead, so the bindings the
 * tests use are the same ones the Worker declares, plus the migrations the
 * setup file needs.
 */
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
