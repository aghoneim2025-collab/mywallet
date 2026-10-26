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

// ===== Date validation =====
// P0.16: parse and validate date strings. Handles both:
//   - YYYY-MM-DD (date-only, common in date picker UIs)
//   - Full ISO 8601 timestamps (e.g., 2024-01-15T10:30:00.000Z)
// Rejects anything else with a 400 (was: silently producing Invalid Date → 500).
//
// P0.17: also verifies that the parsed date's components match the input
// string. JavaScript's Date constructor normalizes impossible dates
// (e.g., 2024-02-30 → March 1, 2024). We now reject those.
export function parseDate(input: unknown): { ok: true; value: Date } | { ok: false; error: string } {
  if (input === null || input === undefined || input === '') {
    return { ok: false, error: 'Date is required' };
  }
  if (input instanceof Date) {
    if (isNaN(input.getTime())) return { ok: false, error: 'Invalid Date object' };
    return { ok: true, value: input };
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, error: 'Invalid date number' };
    const d = new Date(input);
    if (isNaN(d.getTime())) return { ok: false, error: 'Invalid date number' };
    return { ok: true, value: d };
  }
  if (typeof input !== 'string') {
    return { ok: false, error: 'Date must be a string or number' };
  }

  const dateStr = input.trim();
  if (!dateStr) return { ok: false, error: 'Date is required' };

  // Pattern 1: YYYY-MM-DD (date-only) → parse as UTC midnight
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    if (isNaN(d.getTime())) return { ok: false, error: `Invalid date: ${dateStr}` };
    // P0.17: verify roundtrip — JavaScript normalizes impossible dates
    // (e.g., 2024-02-30 → March 1, 2024). Reject those.
    const [y, m, day] = dateStr.split('-').map(Number);
    if (d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== m || d.getUTCDate() !== day) {
      return { ok: false, error: `Impossible date: ${dateStr} (normalized to ${d.toISOString().slice(0, 10)})` };
    }
    return { ok: true, value: d };
  }
  // Pattern 2: full ISO 8601 — pass through + roundtrip check
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(dateStr)) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return { ok: false, error: `Invalid ISO date: ${dateStr}` };
    // P0.17: roundtrip check for the date portion
    const datePart = dateStr.slice(0, 10);  // YYYY-MM-DD
    const [y, m, day] = datePart.split('-').map(Number);
    if (d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== m || d.getUTCDate() !== day) {
      return { ok: false, error: `Impossible date in ISO: ${dateStr}` };
    }
    return { ok: true, value: d };
  }
  return { ok: false, error: `Unrecognized date format: ${dateStr}. Use YYYY-MM-DD or full ISO 8601.` };
}
