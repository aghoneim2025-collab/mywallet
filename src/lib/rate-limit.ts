// P0.11/P0.12: rate limiter.
//
// === KNOWN LIMITATION (multi-worker) ===
// This implementation uses an in-memory Map. In a multi-worker Next.js
// deployment (e.g., Vercel serverless, PM2 cluster), each worker has its
// OWN Map → each worker counts requests independently → effective limit
// is multiplied by the number of workers.
//
// For production with multiple workers, you MUST use a shared store:
//   - @upstash/ratelimit + @upstash/redis (edge-friendly, serverless)
//   - rate-limiter-flexible + Redis (Node-only, more control)
//   - A custom middleware backed by Postgres (works but adds DB load)
//
// To use Upstash, replace the `rateLimit()` function body with:
//   import { Ratelimit } from '@upstash/ratelimit';
//   import { Redis } from '@upstash/redis';
//   const ratelimit = new Ratelimit({
//     redis: Redis.fromEnv(),
//     limiter: Ratelimit.slidingWindow(5, '15 m'),
//     prefix: 'login',
//   });
//   const { success } = await ratelimit.limit(key);
//
// For now, this implementation works correctly for single-instance deploys
// (the current preview setup). For multi-worker deploys, the limit becomes
// N× more lenient — still provides *some* protection, just less strict.
//
// The "/api/health" endpoint can be used to verify whether the rate-limit
// cache is actually shared (returns the bucket counts in a debug mode).

import { NextRequest } from 'next/server';

interface Bucket {
  tokens: number;
  lastRefill: number;
}

// P0.12: shared cache via globalThis so hot-reloads in dev don't reset it.
// (Module-level Map is recreated on each hot reload in Next.js dev.)
const globalForRate = globalThis as unknown as {
  __rateLimitBuckets?: Map<string, Bucket>;
  __rateLimitLastPurge?: number;
};

const buckets: Map<string, Bucket> = globalForRate.__rateLimitBuckets ?? new Map();
globalForRate.__rateLimitBuckets = buckets;

let lastPurgeAt: number = globalForRate.__rateLimitLastPurge ?? Date.now();
globalForRate.__rateLimitLastPurge = lastPurgeAt;

const PURGE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

interface RateLimitConfig {
  capacity: number;
  refillPerSecond: number;
  windowSeconds: number;
}

const LOGIN_CONFIG: RateLimitConfig = {
  capacity: 5,
  refillPerSecond: 5 / (15 * 60), // 5 per 15min
  windowSeconds: 15 * 60,
};

const REGISTER_CONFIG: RateLimitConfig = {
  capacity: 5,
  refillPerSecond: 5 / (60 * 60), // 5 per hour
  windowSeconds: 60 * 60,
};

const GLOBAL_CONFIG: RateLimitConfig = {
  capacity: 200,
  refillPerSecond: 200 / 60,
  windowSeconds: 60,
};

interface RateLimitResult {
  limited: boolean;
  retryAfter: number;
  message?: string;
}

function rateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();

  if (now - lastPurgeAt > PURGE_INTERVAL_MS) {
    for (const [k, b] of buckets) {
      if (now - b.lastRefill > 24 * 60 * 60 * 1000) buckets.delete(k);
    }
    lastPurgeAt = now;
    globalForRate.__rateLimitLastPurge = lastPurgeAt;
  }

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: config.capacity, lastRefill: now };
    buckets.set(key, bucket);
  }

  const elapsedSeconds = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(config.capacity, bucket.tokens + elapsedSeconds * config.refillPerSecond);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    const retryAfter = Math.ceil((1 - bucket.tokens) / config.refillPerSecond);
    return {
      limited: true,
      retryAfter: Math.max(1, retryAfter),
      message: `Too many attempts. Try again in ${Math.max(1, retryAfter)}s.`,
    };
  }

  bucket.tokens -= 1;
  return { limited: false, retryAfter: 0 };
}

function getClientIP(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xReal = req.headers.get('x-real-ip');
  if (xReal) return xReal;
  return 'unknown';
}

export function rateLimitLogin(req: NextRequest, email: string): RateLimitResult {
  const ip = getClientIP(req);
  const key = `login:${ip}:${(email || '').toLowerCase().trim()}`;
  const result = rateLimit(key, LOGIN_CONFIG);
  if (result.limited) {
    console.warn(`Login rate limited for ${ip} / ${email}`);
  }
  return result;
}

export function rateLimitRegister(req: NextRequest): RateLimitResult {
  const ip = getClientIP(req);
  const key = `register:${ip}`;
  const result = rateLimit(key, REGISTER_CONFIG);
  if (result.limited) {
    console.warn(`Register rate limited for ${ip}`);
  }
  return result;
}

export function rateLimitGlobal(req: NextRequest): RateLimitResult {
  const ip = getClientIP(req);
  const key = `global:${ip}`;
  return rateLimit(key, GLOBAL_CONFIG);
}
