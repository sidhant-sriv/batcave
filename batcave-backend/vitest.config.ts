import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * Tests run inside workerd against a real local D1, so the SQL, the D1 driver
 * quirks and the checkpointer schema are all exercised for real. Migrations are
 * read here and applied by the setup file, which runs outside each test's
 * isolated storage stack, so every test starts from a migrated but empty
 * database.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // The pool ships its own workerd, which is older than the project's
          // compatibility date. Pinned to the newest that binary accepts so the
          // tests run at all; wrangler.jsonc keeps the production date.
          compatibilityDate: '2026-08-22',
          bindings: {
            TEST_MIGRATIONS: migrations,
            GROQ_API_KEY: 'test-key-not-used',
            // The OAuth flow is exercised with a stubbed GitHub, so these only
            // have to exist and be stable.
            GITHUB_CLIENT_ID: 'test-github-client',
            GITHUB_CLIENT_SECRET: 'test-github-secret',
            COOKIE_ENCRYPTION_KEY: 'test-cookie-key-0123456789abcdef',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/applyMigrations.ts'],
    },
  };
});
