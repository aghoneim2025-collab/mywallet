// P0.11: centralized input validation. Closes NaN/Infinity bypass + enum validation gaps.
// All API routes should use these helpers before passing values to Prisma.

import { NextResponse } from 'next/server';

// ===== Currency + enums =====
export const CURRENCIES = ['EGP', 'SAR', 'USD', 'EUR', 'AED'] as const;
export type Currency = typeof CURRENCIES[number];

export const ACCOUNT_TYPES = ['CASH', 'BANK', 'E_WALLET', 'CARD', 'SAVINGS', 'INVESTMENT', 'LOAN', 'EXTERNAL'] as const;
export type AccountType = typeof ACCOUNT_TYPES[number];

export const CATEGORY_TYPES = ['EXPENSE', 'INCOME'] as const;
// Note: 'TRANSFER' is a CategoryType enum value but reserved for the transfer route
// — POST /api/categories should NOT allow users to create TRANSFER categories.

export function isCurrency(s: unknown): s is Currency {
  return typeof s === 'string' && (CURRENCIES as readonly string[]).includes(s);
}

export function isAccountType(s: unknown): s is AccountType {
  return typeof s === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(s);
}

export function isCategoryType(s: unknown): boolean {
  return typeof s === 'string' && (CATEGORY_TYPES as readonly string[]).includes(s);
}

// ===== Number validation (prevents NaN, Infinity, etc.) =====

/**
 * Parse and validate a money amount. Returns { ok, value, error }.
 * - Rejects: null, undefined, "", "abc", NaN, Infinity, -Infinity, <=0 (unless allowZero)
 * - Accepts: 1, "1.5", 0 (if allowZero=true), 0.0001
 */
export function parseMoney(input: unknown, opts: { allowZero?: boolean; allowNegative?: boolean } = {}): { ok: true; value: number } | { ok: false; error: string } {
  if (input === null || input === undefined || input === '') {
    return { ok: false, error: 'Amount is required' };
  }
  // Don't accept booleans or objects
  if (typeof input === 'boolean' || typeof input === 'object') {
    return { ok: false, error: 'Amount must be a number' };
  }
  const n = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(n)) {
    return { ok: false, error: 'Amount must be a finite number' };
  }
  if (!opts.allowNegative && n < 0) {
    return { ok: false, error: 'Amount must be non-negative' };
  }
  if (!opts.allowZero && n === 0) {
    return { ok: false, error: 'Amount must be positive' };
  }
  // Cap at 1 trillion to prevent overflow on aggregated sums
  if (Math.abs(n) > 1e12) {
    return { ok: false, error: 'Amount is unreasonably large (max 1 trillion)' };
  }
  return { ok: true, value: n };
}

// ===== String validation =====

export function parseString(input: unknown, field: string, opts: { min?: number; max?: number; required?: boolean } = {}): { ok: true; value: string } | { ok: false; error: string } {
  const required = opts.required ?? true;
  if (input === null || input === undefined || input === '') {
    if (required) return { ok: false, error: `${field} is required` };
    return { ok: true, value: '' };
  }
  if (typeof input !== 'string') {
    return { ok: false, error: `${field} must be a string` };
  }
  const trimmed = input.trim();
  if (required && trimmed === '') {
    return { ok: false, error: `${field} cannot be empty` };
  }
  if (opts.min !== undefined && trimmed.length < opts.min) {
    return { ok: false, error: `${field} must be at least ${opts.min} chars` };
  }
  if (opts.max !== undefined && trimmed.length > opts.max) {
    return { ok: false, error: `${field} must be at most ${opts.max} chars` };
  }
  return { ok: true, value: trimmed };
}

// ===== Email validation =====

export function isValidEmail(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  // RFC 5322 simplified: local@domain.tld, no whitespace
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

// ===== Password policy =====

export const MIN_PASSWORD_LENGTH = 12;

export function validatePassword(pw: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof pw !== 'string') return { ok: false, error: 'Password must be a string' };
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (pw.length > 72) {
    // bcrypt truncates at 72 bytes silently — reject to avoid confusion
    return { ok: false, error: 'Password must be at most 72 characters (bcrypt limit)' };
  }
  // Require at least 3 of: lowercase, uppercase, digit, symbol
  const classes = [
    /[a-z]/.test(pw),
    /[A-Z]/.test(pw),
    /[0-9]/.test(pw),
    /[^a-zA-Z0-9]/.test(pw),
  ].filter(Boolean).length;
  if (classes < 3) {
    return { ok: false, error: 'Password must contain at least 3 of: lowercase, uppercase, digit, symbol' };
  }
  // Reject common weak passwords
  const weak = ['password', '12345678', 'qwerty12', 'letmein12', 'admin1234', 'welcome12'];
  if (weak.includes(pw.toLowerCase())) {
    return { ok: false, error: 'Password is too common' };
  }
  return { ok: true };
}

// ===== Helpers for route handlers =====

/** Build a 400 response with a JSON error body. */
export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Build a 429 response with Retry-After header. */
export function tooManyRequests(retryAfterSeconds: number, message?: string) {
  return NextResponse.json(
    { error: message ?? 'Too many requests. Please slow down.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}
