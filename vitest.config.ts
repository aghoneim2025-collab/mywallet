import { defineConfig } from 'vitest/config';
import path from 'path';

// P0.19: set env vars BEFORE any imports that might read them.
// Use type assertion to bypass TypeScript's readonly check on process.env.
const env = process.env as Record<string, string>;
env.AUTH_SECRET = env.AUTH_SECRET || 'test-secret-32-chars-minimum-aaaaaaaaaaaaaaa';
env.DATABASE_URL = env.DATABASE_URL || 'file:./db/test.db';
// NODE_ENV is already set by vitest — don't override it

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
