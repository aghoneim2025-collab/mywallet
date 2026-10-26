import { defineConfig } from 'vitest/config';
import path from 'path';

// P0.20: HARD-CODED test DB — never use process.env.DATABASE_URL.
// This prevents tests from accidentally wiping production data.
const TEST_DB = 'file:./db/test.db';

// Set env vars BEFORE any imports.
const env = process.env as Record<string, string>;
env.AUTH_SECRET = 'test-secret-32-chars-minimum-aaaaaaaaaaaaaaa';
env.DATABASE_URL = TEST_DB;

// P0.20: safety guard — refuse to run if DATABASE_URL was already
// pointing to a non-test DB before we overrode it.
const originalDB = env.DATABASE_URL;
if (originalDB && !originalDB.includes('test') && !originalDB.includes('Test')) {
  console.error('FATAL: Refusing to run tests — DATABASE_URL appears to point to a non-test database.');
  console.error('DATABASE_URL was:', originalDB);
  console.error('Tests would wipe this database. Override with TEST_DATABASE_URL or unset DATABASE_URL.');
  process.exit(1);
}

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
