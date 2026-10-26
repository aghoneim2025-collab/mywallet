import { defineConfig } from 'vitest/config';
import path from 'path';

// P0.21: capture the ORIGINAL DATABASE_URL BEFORE we override it.
const originalDB = process.env.DATABASE_URL;
const TEST_DB = 'file:./db/test.db';

// P0.21: safety guard — warn if the original DATABASE_URL pointed to a
// non-test database. We override it below, so this is just a warning
// (not fatal). The actual protection is the hardcode override.
if (originalDB && !originalDB.includes('test') && !originalDB.includes('Test')) {
  console.warn('WARNING: DATABASE_URL was "' + originalDB + '" (non-test).');
  console.warn('Overriding to "' + TEST_DB + '" for tests.');
}

// Hardcode test DB — this ALWAYS wins, regardless of .env or shell env.
const env = process.env as Record<string, string>;
env.AUTH_SECRET = 'test-secret-32-chars-minimum-aaaaaaaaaaaaaaa';
env.DATABASE_URL = TEST_DB;

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
