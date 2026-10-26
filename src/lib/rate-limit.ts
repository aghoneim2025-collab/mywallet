// P0.11: simple in-memory rate limiter.
// For production, replace with @upstash/ratelimit + Redis so limits are
// shared across all worker processes / servers. In-memory is OK for
// single-instance deploys and dev.
//
// Strategy: token bucket per key. Each request consumes 1 token. Tokens
// refill at a fixed rate up to a max capacity.

import { NextRequest } from 'next/server';

interface Bucket {
  tokens: number;
  lastRefill: number; // Date.now()
}

// Map<key, Bucket>
const buckets = new Map<string, Bucket>();

// Periodically purge expired buckets to keep memory bounded.
const PURGE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let lastPurgeAt = Date.now();

interface RateLimitConfig {
  capacity: number;       // max tokens in bucket
  refillPerSecond: number; // tokens added per second
  windowSeconds: number;   // for Retry-After calculation
}

// Per-endpoint configs. Tune to taste.
const LOGIN_CONFIG: RateLimitConfig = {
  capacity: 5,            // 5 attempts
  refillPerSecond: 5 / (15 * 60), // 1 every 3 minutes (5 per 15min)
  windowSeconds: 15 * 60,
};

const REGISTER_CONFIG: RateLimitConfig = {
  capacity: 5,
  refillPerSecond: 5 / (60 * 60), // 5 per hour
  windowSeconds: 60 * 60,
};

const GLOBAL_CONFIG: RateLimitConfig = {
  capacity: 200,
  refillPerSecond: 200 / 60, // 200 per minute
  windowSeconds: 60,
};

interface RateLimitResult {
  limited: boolean;
  retryAfter: number; // seconds
  message?: string;
}

function rateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();

  // Periodic purge
  if (now - lastPurgeAt > PURGE_INTERVAL_MS) {
    for (const [k, b] of buckets) {
      if (now - b.lastRefill > 24 * 60 * 60 * 1000) buckets.delete(k);
    }
    lastPurgeAt = now;
  }

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: config.capacity, lastRefill: now };
    buckets.set(key, bucket);
  }

  // Refill
  const elapsedSeconds = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(config.capacity, bucket.tokens + elapsedSeconds * config.refillPerSecond);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    // Limited. Calculate retry-after: time until 1 token available.
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
  // Try common headers (Caddy/Cloudflare/etc).
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xReal = req.headers.get('x-real-ip');
  if (xReal) return xReal;
  return 'unknown';
}

export function rateLimitLogin(req: NextRequest, email: string): RateLimitResult {
  const ip = getClientIP(req);
  // Limit per (IP, email) — slows per-account brute force AND per-IP.
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
