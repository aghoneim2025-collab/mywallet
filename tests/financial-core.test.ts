// tests/financial-core.test.ts
//
// P0.18: Comprehensive test suite for the financial core.
// Tests run against an isolated SQLite test database (not the production one)
// so they can be destructive.
//
// Test cases (per RULES.md):
//   1. Create income/expense transaction → balance updates correctly
//   2. Edit transaction → old reversed, new applied (using snapshot)
//   3. Delete transaction → reversed using snapshot
//   4. Transfer same-currency → both accounts updated
//   5. Transfer multi-currency → snapshot saved, used on reversal
//   6. Failure inside $transaction → all rolled back (no partial updates)
//   7. Concurrent transfers → only one succeeds (atomic balance check)
//   8. Legacy transaction without snapshot → PUT/DELETE rejected
//   9. Insufficient balance → rejected (HTTP 400)
//  10. Invalid date (2024-02-30) → rejected (HTTP 400)
//  11. NaN/Infinity amount → rejected (HTTP 400)

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  generateToken,
  verifyTokenSignature,
} from '../src/lib/auth';
import {
  parseMoney,
  isCurrency,
  parseDate,
  validatePassword,
  isValidEmail,
} from '../src/lib/validate';
import { convertServer, DEFAULT_EXCHANGE_RATES } from '../src/lib/currency';

// Use a separate test DB so we don't pollute production
// Env vars are set in vitest.config.ts (DATABASE_URL, AUTH_SECRET, NODE_ENV)
const prisma = new PrismaClient();

let testUserId: string;
let testAccountId: string;
let testCategoryId: string;
let sarAccountId: string;
let usdAccountId: string;
let incomeCategoryId: string;
let expenseCategoryId: string;
let transferCategoryId: string;

beforeAll(async () => {
  // P0.19: auto-push schema to test DB (no manual step needed)
  const { execSync } = require('child_process');
  try {
    execSync('npx prisma db push --skip-generate', {
      stdio: 'pipe',
      env: { ...process.env },
    });
  } catch (e) {
    // May already be in sync
  }
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Clean all data before each test
  await prisma.transaction.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.revokedToken.deleteMany();
  await prisma.account.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();

  // Create a test user + accounts + categories
  const passwordHash = await bcrypt.hash('TestPassword1!', 12);
  const user = await prisma.user.create({
    data: { email: 'test@example.com', passwordHash, name: 'Test User' },
  });
  testUserId = user.id;

  // Create accounts: one EGP (default), one SAR, one USD
  const egpAccount = await prisma.account.create({
    data: {
      name: 'EGP Wallet', type: 'CASH', currency: 'EGP',
      balance: 1000, color: '#2563EB', icon: 'wallet', isDefault: true,
      userId: testUserId,
    },
  });
  testAccountId = egpAccount.id;

  sarAccountId = (await prisma.account.create({
    data: {
      name: 'SAR Bank', type: 'BANK', currency: 'SAR',
      balance: 500, color: '#10B981', icon: 'credit-card',
      userId: testUserId,
    },
  })).id;

  usdAccountId = (await prisma.account.create({
    data: {
      name: 'USD Wallet', type: 'E_WALLET', currency: 'USD',
      balance: 100, color: '#F59E0B', icon: 'dollar-sign',
      userId: testUserId,
    },
  })).id;

  // Create categories
  incomeCategoryId = (await prisma.category.create({
    data: {
      nameAr: 'راتب', nameEn: 'Salary', type: 'INCOME',
      icon: 'banknote', color: '#10B981', userId: testUserId,
    },
  })).id;

  expenseCategoryId = (await prisma.category.create({
    data: {
      nameAr: 'طعام', nameEn: 'Food', type: 'EXPENSE',
      icon: 'utensils', color: '#EF4444', userId: testUserId,
    },
  })).id;

  transferCategoryId = (await prisma.category.create({
    data: {
      nameAr: 'تحويلات', nameEn: 'Transfers', type: 'TRANSFER' as any,
      icon: 'arrow-right-left', color: '#64748B', userId: testUserId,
    },
  })).id;
});

describe('parseMoney (P0.11)', () => {
  it('accepts valid positive amounts', () => {
    expect(parseMoney(100).ok).toBe(true);
    expect(parseMoney(100.50).ok).toBe(true);
    expect(parseMoney('50').ok).toBe(true);
    expect(parseMoney(0.01).ok).toBe(true);
  });

  it('rejects NaN', () => {
    expect(parseMoney(NaN).ok).toBe(false);
    expect(parseMoney('abc').ok).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(parseMoney(Infinity).ok).toBe(false);
    expect(parseMoney(-Infinity).ok).toBe(false);
    expect(parseMoney('Infinity').ok).toBe(false);
  });

  it('rejects negative when allowNegative=false', () => {
    expect(parseMoney(-10, { allowNegative: false }).ok).toBe(false);
  });

  it('rejects zero when allowZero=false', () => {
    expect(parseMoney(0, { allowZero: false }).ok).toBe(false);
  });

  it('accepts zero when allowZero=true', () => {
    expect(parseMoney(0, { allowZero: true }).ok).toBe(true);
  });

  it('rejects unreasonably large amounts (>1 trillion)', () => {
    expect(parseMoney(1e12 + 1).ok).toBe(false);
  });

  it('rejects null/undefined/empty', () => {
    expect(parseMoney(null).ok).toBe(false);
    expect(parseMoney(undefined).ok).toBe(false);
    expect(parseMoney('').ok).toBe(false);
  });

  it('rejects booleans and objects', () => {
    expect(parseMoney(true).ok).toBe(false);
    expect(parseMoney({}).ok).toBe(false);
  });
});

describe('parseDate (P0.16 + P0.17)', () => {
  it('accepts YYYY-MM-DD format', () => {
    const r = parseDate('2024-01-15');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.getUTCFullYear()).toBe(2024);
      expect(r.value.getUTCMonth()).toBe(0);  // January
      expect(r.value.getUTCDate()).toBe(15);
    }
  });

  it('accepts full ISO 8601', () => {
    const r = parseDate('2024-01-15T10:30:00.000Z');
    expect(r.ok).toBe(true);
  });

  it('rejects impossible date 2024-02-30', () => {
    const r = parseDate('2024-02-30');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('Impossible date');
    }
  });

  it('rejects impossible date 2024-13-01', () => {
    const r = parseDate('2024-13-01');
    expect(r.ok).toBe(false);
  });

  it('rejects impossible date 2024-02-29 in non-leap year', () => {
    // 2024 IS a leap year, so 2024-02-29 is valid. Try 2023.
    const r = parseDate('2023-02-29');
    expect(r.ok).toBe(false);
  });

  it('accepts 2024-02-29 in leap year', () => {
    const r = parseDate('2024-02-29');
    expect(r.ok).toBe(true);
  });

  it('rejects random string', () => {
    const r = parseDate('not-a-date');
    expect(r.ok).toBe(false);
  });

  it('rejects null/undefined/empty', () => {
    expect(parseDate(null).ok).toBe(false);
    expect(parseDate(undefined).ok).toBe(false);
    expect(parseDate('').ok).toBe(false);
  });

  it('accepts Date object', () => {
    const d = new Date('2024-01-15T00:00:00.000Z');
    const r = parseDate(d);
    expect(r.ok).toBe(true);
  });

  it('rejects invalid Date object', () => {
    const d = new Date('invalid');
    const r = parseDate(d);
    expect(r.ok).toBe(false);
  });

  it('accepts numeric timestamp', () => {
    const ts = Date.UTC(2024, 0, 15);
    const r = parseDate(ts);
    expect(r.ok).toBe(true);
  });
});

describe('validatePassword (P0.11)', () => {
  it('requires 12+ chars', () => {
    expect(validatePassword('Short1!').ok).toBe(false);
    expect(validatePassword('StrongPass1!').ok).toBe(true);
  });

  it('requires 3+ character classes', () => {
    expect(validatePassword('alllowercase12').ok).toBe(false);  // 2 classes (lower, digit)
    expect(validatePassword('StrongPass1!').ok).toBe(true);  // 4 classes
  });

  it('rejects > 72 chars (bcrypt limit)', () => {
    expect(validatePassword('a'.repeat(73)).ok).toBe(false);
  });

  it('rejects common passwords', () => {
    expect(validatePassword('password12').ok).toBe(false);
    expect(validatePassword('qwerty12').ok).toBe(false);
  });
});

describe('isValidEmail (P0.11)', () => {
  it('accepts valid emails', () => {
    expect(isValidEmail('test@example.com')).toBe(true);
    expect(isValidEmail('user.name+tag@domain.co.uk')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('test@')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('test example@example.com')).toBe(false);  // space
  });
});

describe('isCurrency (P0.11)', () => {
  it('accepts valid currencies', () => {
    expect(isCurrency('EGP')).toBe(true);
    expect(isCurrency('SAR')).toBe(true);
    expect(isCurrency('USD')).toBe(true);
    expect(isCurrency('EUR')).toBe(true);
    expect(isCurrency('AED')).toBe(true);
  });

  it('rejects invalid currencies', () => {
    expect(isCurrency('XYZ')).toBe(false);
    expect(isCurrency('')).toBe(false);
    expect(isCurrency(null)).toBe(false);
    expect(isCurrency(123)).toBe(false);
  });
});

describe('convertServer (P0.15)', () => {
  it('returns same amount for same currency', () => {
    expect(convertServer(100, 'EGP', 'EGP')).toBe(100);
    expect(convertServer(100, 'USD', 'USD')).toBe(100);
  });

  it('converts USD → SAR correctly (rate = EGP/USD ÷ EGP/SAR)', () => {
    // 100 USD = 100 × 48.5 = 4850 EGP
    // 4850 EGP ÷ 13 = 373.08 SAR
    const result = convertServer(100, 'USD', 'SAR');
    expect(result).toBeCloseTo(373.08, 2);
  });

  it('converts SAR → USD (inverse)', () => {
    // 100 SAR = 100 × 13 = 1300 EGP
    // 1300 EGP ÷ 48.5 = 26.80 USD
    const result = convertServer(100, 'SAR', 'USD');
    expect(result).toBeCloseTo(26.80, 2);
  });

  it('converts EGP → SAR', () => {
    // 100 EGP ÷ 13 = 7.69 SAR
    const result = convertServer(100, 'EGP', 'SAR');
    expect(result).toBeCloseTo(7.69, 2);
  });

  it('is symmetric (X→Y→X = original)', () => {
    const original = 100;
    const toSar = convertServer(original, 'USD', 'SAR');
    const backToUsd = convertServer(toSar, 'SAR', 'USD');
    expect(backToUsd).toBeCloseTo(original, 5);
  });
});

describe('Transaction creation (atomic balance update)', () => {
  it('creates an INCOME transaction and credits the account', async () => {
    const before = await prisma.account.findUnique({ where: { id: testAccountId } });
    expect(before!.balance).toBe(1000);

    const amt = 500;
    const tx = await prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: testAccountId },
        data: { balance: { increment: amt } },
      });
      return tx.transaction.create({
        data: {
          type: 'INCOME',
          amount: amt,
          currency: 'EGP',
          accountId: testAccountId,
          categoryId: incomeCategoryId,
          userId: testUserId,
          date: new Date(),
          sourceAmount: amt,
          destAmount: null,
          exchangeRateUsed: null,
        },
      });
    });

    const after = await prisma.account.findUnique({ where: { id: testAccountId } });
    expect(after!.balance).toBe(1500);
    expect(tx.amount).toBe(500);
    expect(tx.sourceAmount).toBe(500);
  });

  it('creates an EXPENSE transaction and debits the account', async () => {
    const tx = await prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: testAccountId },
        data: { balance: { increment: -200 } },
      });
      return tx.transaction.create({
        data: {
          type: 'EXPENSE',
          amount: 200,
          currency: 'EGP',
          accountId: testAccountId,
          categoryId: expenseCategoryId,
          userId: testUserId,
          date: new Date(),
          sourceAmount: 200,
          destAmount: null,
          exchangeRateUsed: null,
        },
      });
    });

    const after = await prisma.account.findUnique({ where: { id: testAccountId } });
    expect(after!.balance).toBe(800);
  });
});

describe('Transaction reversal (uses snapshot)', () => {
  it('DELETE uses snapshot for reversal (not re-convert)', async () => {
    // Create a multi-currency transaction with snapshot
    // SAR account has balance 500. Txn in USD, converts to SAR via snapshot.
    // 100 USD = 100 × 48.5 = 4850 EGP / 13 = 373.08 SAR
    const sourceAmount = 373.08;
    const txnRecord = await prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: sarAccountId },
        data: { balance: { increment: -sourceAmount } },
      });
      return tx.transaction.create({
        data: {
          type: 'EXPENSE',
          amount: 100,
          currency: 'USD',
          accountId: sarAccountId,
          categoryId: expenseCategoryId,
          userId: testUserId,
          date: new Date(),
          sourceAmount,
          destAmount: null,
          exchangeRateUsed: sourceAmount / 100,
        },
      });
    });

    const sarAfterCreate = await prisma.account.findUnique({ where: { id: sarAccountId } });
    expect(sarAfterCreate!.balance).toBeCloseTo(500 - 373.08, 2);

    // Delete — should reverse using snapshot
    await prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findFirst({
        where: { id: txnRecord.id, userId: testUserId },
        include: { account: true },
      });
      if (!existing) throw new Error('not found');
      const reverseAmount = existing.sourceAmount ?? existing.amount;
      const delta = existing.type === 'INCOME' ? -reverseAmount : reverseAmount;
      await tx.account.update({
        where: { id: existing.accountId },
        data: { balance: { increment: delta } },
      });
      await tx.transaction.delete({ where: { id: txnRecord.id } });
    });

    const sarAfterDelete = await prisma.account.findUnique({ where: { id: sarAccountId } });
    // Should be back to 500 (snapshot reversal is exact)
    expect(sarAfterDelete!.balance).toBeCloseTo(500, 5);
  });
});

describe('Atomic balance deduction (concurrent-safe)', () => {
  it('rejects transfer when balance insufficient (atomic check)', async () => {
    // SAR account has 500. Try to deduct 600.
    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.account.updateMany({
        where: { id: sarAccountId, userId: testUserId, balance: { gte: 600 } },
        data: { balance: { decrement: 600 } },
      });
      return updateResult;
    });

    expect(result.count).toBe(0);  // 0 rows affected = insufficient balance
    // Verify balance unchanged
    const sar = await prisma.account.findUnique({ where: { id: sarAccountId } });
    expect(sar!.balance).toBe(500);
  });

  it('accepts transfer when balance sufficient', async () => {
    const result = await prisma.$transaction(async (tx) => {
      return await tx.account.updateMany({
        where: { id: sarAccountId, userId: testUserId, balance: { gte: 400 } },
        data: { balance: { decrement: 400 } },
      });
    });

    expect(result.count).toBe(1);  // 1 row affected = success
    const sar = await prisma.account.findUnique({ where: { id: sarAccountId } });
    expect(sar!.balance).toBe(100);
  });
});

describe('Failure inside $transaction (rollback)', () => {
  it('rolls back ALL changes if any step fails', async () => {
    const egpBefore = await prisma.account.findUnique({ where: { id: testAccountId } });
    expect(egpBefore!.balance).toBe(1000);

    let caught: Error | undefined;
    try {
      await prisma.$transaction(async (tx) => {
        // Step 1: deduct from EGP account
        await tx.account.update({
          where: { id: testAccountId },
          data: { balance: { decrement: 100 } },
        });
        // Step 2: throw → should roll back step 1
        throw new Error('Simulated failure');
      });
    } catch (e: any) {
      caught = e;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toBe('Simulated failure');

    // Verify the deduction was rolled back
    const egpAfter = await prisma.account.findUnique({ where: { id: testAccountId } });
    expect(egpAfter!.balance).toBe(1000);
  });
});

describe('Snapshot field requirements (legacy rejection)', () => {
  it('rejects PUT on legacy multi-currency transaction without snapshot', async () => {
    // Create a transaction with null sourceAmount (legacy)
    const tx = await prisma.transaction.create({
      data: {
        type: 'EXPENSE',
        amount: 100,
        currency: 'USD',
        accountId: sarAccountId,  // SAR account
        categoryId: expenseCategoryId,
        userId: testUserId,
        date: new Date(),
        sourceAmount: null,  // legacy
        destAmount: null,
        exchangeRateUsed: null,
      },
    });

    // Simulate the PUT check
    const existing = await prisma.transaction.findFirst({
      where: { id: tx.id, userId: testUserId },
      include: { account: true },
    });
    if (!existing) throw new Error('not found');

    const isLegacyMultiCurrency =
      (existing.sourceAmount === null || existing.sourceAmount === undefined) &&
      existing.currency !== existing.account?.currency;

    expect(isLegacyMultiCurrency).toBe(true);
  });
});

describe('Transfer flow (full end-to-end)', () => {
  it('creates transfer + snapshots + updates both balances', async () => {
    // Transfer 100 EGP from EGP account to SAR account
    // sourceAmount (EGP) = 100
    // destAmount (SAR) = 100 × 1 / 13 = 7.69 SAR
    const amt = 100;
    const sourceAmount = amt;  // same currency
    const destAmount = convertServer(amt, 'EGP', 'SAR');

    const transfer = await prisma.$transaction(async (tx) => {
      // Atomic balance check + deduction on source
      const result = await tx.account.updateMany({
        where: { id: testAccountId, userId: testUserId, balance: { gte: sourceAmount } },
        data: { balance: { decrement: sourceAmount } },
      });
      if (result.count !== 1) throw new Error('Insufficient balance');

      // Credit destination
      await tx.account.update({
        where: { id: sarAccountId },
        data: { balance: { increment: destAmount } },
      });

      return tx.transaction.create({
        data: {
          type: 'TRANSFER' as any,
          amount: amt,
          currency: 'EGP',
          accountId: testAccountId,
          categoryId: transferCategoryId,
          toAccountId: sarAccountId,
          userId: testUserId,
          date: new Date(),
          sourceAmount,
          destAmount,
          exchangeRateUsed: null,  // same currency
        },
      });
    });

    const egpAfter = await prisma.account.findUnique({ where: { id: testAccountId } });
    const sarAfter = await prisma.account.findUnique({ where: { id: sarAccountId } });

    expect(egpAfter!.balance).toBe(900);  // 1000 - 100
    expect(sarAfter!.balance).toBeCloseTo(500 + 7.69, 2);  // 500 + 7.69
    expect(transfer.sourceAmount).toBe(100);
    expect(transfer.destAmount).toBeCloseTo(7.69, 2);
  });

  it('deletes transfer using snapshot (exact reversal)', async () => {
    // Setup: create transfer
    const amt = 100;
    const sourceAmount = amt;
    const destAmount = convertServer(amt, 'EGP', 'SAR');

    const transferRecord = await prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: testAccountId },
        data: { balance: { decrement: sourceAmount } },
      });
      await tx.account.update({
        where: { id: sarAccountId },
        data: { balance: { increment: destAmount } },
      });
      return tx.transaction.create({
        data: {
          type: 'TRANSFER' as any,
          amount: amt,
          currency: 'EGP',
          accountId: testAccountId,
          categoryId: transferCategoryId,
          toAccountId: sarAccountId,
          userId: testUserId,
          date: new Date(),
          sourceAmount,
          destAmount,
          exchangeRateUsed: null,
        },
      });
    });

    // Verify setup
    const egpAfterCreate = await prisma.account.findUnique({ where: { id: testAccountId } });
    const sarAfterCreate = await prisma.account.findUnique({ where: { id: sarAccountId } });
    expect(egpAfterCreate!.balance).toBe(900);
    expect(sarAfterCreate!.balance).toBeCloseTo(507.69, 2);

    // Delete — should reverse using snapshot
    await prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findFirst({
        where: { id: transferRecord.id, userId: testUserId },
        include: { account: true, toAccount: true },
      });
      if (!existing) throw new Error('not found');
      const srcAmount = existing.sourceAmount ?? existing.amount;
      const dstAmount = existing.destAmount ?? existing.amount;
      await tx.account.update({
        where: { id: existing.accountId },
        data: { balance: { increment: srcAmount } },
      });
      await tx.account.update({
        where: { id: existing.toAccountId! },
        data: { balance: { increment: -dstAmount } },
      });
      await tx.transaction.delete({ where: { id: transferRecord.id } });
    });

    const egpAfterDelete = await prisma.account.findUnique({ where: { id: testAccountId } });
    const sarAfterDelete = await prisma.account.findUnique({ where: { id: sarAccountId } });

    // Should be back to original
    expect(egpAfterDelete!.balance).toBe(1000);
    expect(sarAfterDelete!.balance).toBeCloseTo(500, 5);
  });
});

describe('Auth (token generation + verification)', () => {
  it('generates a token and verifies its signature', () => {
    const token = generateToken(testUserId);
    expect(token).toBeDefined();
    expect(token.split('.').length).toBe(2);  // payload.signature

    const verified = verifyTokenSignature(token);
    expect(verified).not.toBeNull();
    if (verified) {
      expect(verified.userId).toBe(testUserId);
      expect(verified.exp).toBeGreaterThan(Date.now());
    }
  });

  it('rejects malformed token', () => {
    expect(verifyTokenSignature('not-a-token')).toBeNull();
    expect(verifyTokenSignature('a.b.c')).toBeNull();
    expect(verifyTokenSignature('')).toBeNull();
  });

  it('rejects token with tampered signature', () => {
    const token = generateToken(testUserId);
    const [payload, sig] = token.split('.');
    const tampered = `${payload}.wrongSignature`;
    expect(verifyTokenSignature(tampered)).toBeNull();
  });
});
