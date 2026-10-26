import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError } from '@/lib/api-errors';

// P0.11 backup import hardening:
//   - Strict version check: backup.version === 3
//   - Validate ownership of every FK reference (accountId, categoryId, toAccountId)
//     before creating the transaction → closes IDOR
//   - Regenerate all primary keys (strip client-supplied IDs) — defense in depth
//   - Validate currency + type enums per row
//   - Bounded row counts (max 50000 transactions per backup)
//   - Don't leak err.message to client

const BACKUP_VERSION = 4;
const MAX_ROWS = 50000;

// GET /api/backup?action=export - user-scoped
export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const [accounts, categories, transactions, budgets] = await Promise.all([
      db.account.findMany({ where: { userId } }),
      db.category.findMany({ where: { userId } }),
      db.transaction.findMany({ where: { userId }, include: { account: true, category: true } }),
      db.budget.findMany({ where: { userId } }),
    ]);

    const backup = {
      version: BACKUP_VERSION,
      app: 'mywallet',
      exportedAt: new Date().toISOString(),
      data: {
        // P0.19 fix: export WITH ids so import can resolve FK references.
        // Previously stripped ids → import couldn't map accountId/categoryId
        // → all transactions + budgets silently skipped on restore.
        // The ids are safe to include because:
        //   (1) export is user-specific (only their own data)
        //   (2) import creates NEW records with fresh Prisma cuids, then
        //       maps old-id → new-id for FK resolution
        //   (3) the old ids are just map keys, not actual DB FK values
        accounts: accounts.map(({ id, name, type, currency, balance, color, icon, isDefault, createdAt, updatedAt }) =>
          ({ id, name, type, currency, balance, color, icon, isDefault, createdAt, updatedAt })),
        categories: categories.map(({ id, nameAr, nameEn, type, icon, color, isDefault, createdAt, updatedAt }) =>
          ({ id, nameAr, nameEn, type, icon, color, isDefault, createdAt, updatedAt })),
        // P0.19: also export snapshot fields (sourceAmount, destAmount, exchangeRateUsed)
        // so multi-currency transactions can be reversed after restore.
        transactions: transactions.map(({ id, type, amount, currency, accountId, categoryId, toAccountId, date, note, tags, transferPairId, sourceAmount, destAmount, exchangeRateUsed, createdAt, updatedAt }) =>
          ({ id, type, amount, currency, accountId, categoryId, toAccountId, date, note, tags, transferPairId, sourceAmount, destAmount, exchangeRateUsed, createdAt, updatedAt })),
        budgets: budgets.map(({ id, categoryId, month, limit, currency, createdAt, updatedAt }) =>
          ({ id, categoryId, month, limit, currency, createdAt, updatedAt })),
      },
    };

    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="mywallet-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (err: any) {
    return handleAuthError(err);
  }
}

// POST /api/backup?action=import - user-scoped, ATOMIC, with IDOR defense
export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
    }

    const text = await file.text();
    let backup;
    try {
      backup = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON file' }, { status: 400 });
    }

    // P0.11: strict version check (was: truthy check that accepted v1, v999, "foo", etc.)
    // P0.20: reject v3 explicitly with a message explaining why.
    // v3 backups don't include IDs → import silently skips all transactions.
    if (typeof backup?.version !== 'number') {
      return NextResponse.json(
        { error: 'Invalid backup file: missing or non-numeric version field.' },
        { status: 400 },
      );
    }
    if (backup.version !== BACKUP_VERSION) {
      if (backup.version === 3) {
        return NextResponse.json(
          { error: 'Backup version 3 is no longer supported (it lacks transaction IDs, causing silent data loss on restore). Please export a fresh backup from the current app version to get version ' + BACKUP_VERSION + '.' },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: `Unsupported backup version ${backup.version} (expected ${BACKUP_VERSION}).` },
        { status: 400 },
      );
    }
    if (!backup?.data || typeof backup.data !== 'object') {
      return NextResponse.json({ error: 'Invalid backup format - missing data' }, { status: 400 });
    }

    const { accounts = [], categories = [], transactions = [], budgets = [] } = backup.data;

    // P0.20: validate data structure BEFORE deleting user's existing data.
    // If arrays aren't arrays, or required fields are missing, we reject
    // the import BEFORE touching the user's current data.
    if (!Array.isArray(accounts) || !Array.isArray(categories) || !Array.isArray(transactions) || !Array.isArray(budgets)) {
      return NextResponse.json({ error: 'Invalid backup format: data.accounts/categories/transactions/budgets must be arrays.' }, { status: 400 });
    }
    // Verify transactions have the required FK fields (accountId, categoryId)
    for (const t of transactions) {
      if (!t.accountId || !t.categoryId) {
        return NextResponse.json(
          { error: 'Backup contains transactions missing accountId or categoryId. This looks like a v3 backup. Please export a fresh backup.' },
          { status: 400 },
        );
      }
    }
    // Verify budgets have categoryId
    for (const b of budgets) {
      if (!b.categoryId) {
        return NextResponse.json(
          { error: 'Backup contains budgets missing categoryId. Please export a fresh backup.' },
          { status: 400 },
        );
      }
    }

    // P0.11: row count limits
    if (transactions.length > MAX_ROWS || accounts.length > 1000 || categories.length > 1000 || budgets.length > 1000) {
      return NextResponse.json({ error: `Backup exceeds row limits (max ${MAX_ROWS} transactions, 1000 each for accounts/categories/budgets)` }, { status: 400 });
    }

    // ATOMIC: delete old + restore new (with regenerated IDs + FK ownership validation)
    const result = await db.$transaction(async (tx) => {
      await tx.transaction.deleteMany({ where: { userId } });
      await tx.budget.deleteMany({ where: { userId } });
      await tx.account.deleteMany({ where: { userId } });
      await tx.category.deleteMany({ where: { userId } });

      let catCount = 0, accCount = 0, txCount = 0, budCount = 0;

      // Insert categories with FRESH IDs (Prisma auto-generates cuid).
      // Map old ID → new ID so transactions can resolve categoryId.
      const categoryIdMap = new Map<string, string>();
      for (const c of categories) {
        // Validate category type enum (allow EXPENSE, INCOME, TRANSFER for legacy)
        if (!['EXPENSE', 'INCOME', 'TRANSFER'].includes(c.type)) {
          throw new Error(`Invalid category type: ${c.type}`);
        }
        const created = await tx.category.create({
          data: {
            nameAr: String(c.nameAr || '').slice(0, 200),
            nameEn: String(c.nameEn || '').slice(0, 200),
            type: c.type,
            icon: String(c.icon || 'tag').slice(0, 100),
            color: String(c.color || '#10B981').slice(0, 20),
            isDefault: Boolean(c.isDefault),
            userId,
          },
        });
        if (c.id) categoryIdMap.set(c.id, created.id);
        catCount++;
      }

      const accountIdMap = new Map<string, string>();
      const VALID_ACCOUNT_TYPES = new Set(['CASH', 'BANK', 'E_WALLET', 'CARD', 'SAVINGS', 'INVESTMENT', 'LOAN', 'EXTERNAL']);
      const VALID_CURRENCIES = new Set(['EGP', 'SAR', 'USD', 'EUR', 'AED']);
      for (const a of accounts) {
        if (!VALID_ACCOUNT_TYPES.has(a.type)) {
          throw new Error(`Invalid account type: ${a.type}`);
        }
        if (!VALID_CURRENCIES.has(a.currency)) {
          throw new Error(`Invalid currency: ${a.currency}`);
        }
        // P0.11: validate balance is finite (no NaN/Infinity)
        const bal = Number(a.balance);
        if (!Number.isFinite(bal)) {
          throw new Error('Account balance must be a finite number');
        }
        const created = await tx.account.create({
          data: {
            name: String(a.name || '').slice(0, 200),
            type: a.type,
            currency: a.currency,
            balance: bal,
            color: String(a.color || '#2563EB').slice(0, 20),
            icon: String(a.icon || 'wallet').slice(0, 100),
            isDefault: Boolean(a.isDefault),
            userId,
          },
        });
        if (a.id) accountIdMap.set(a.id, created.id);
        accCount++;
      }

      // P0.11: IDOR defense — for each imported transaction, verify the FK
      // references resolve to accounts/categories OWNED BY THIS USER
      // (which they now are, because we just inserted them above).
      // If an old ID doesn't appear in our map → reject that row (skipped).
      for (const t of transactions) {
        // Resolve the foreign keys through our idMap.
        // If the source ID is missing → cross-user reference attempt → skip.
        const newAccountId = t.accountId ? accountIdMap.get(t.accountId) : undefined;
        const newCategoryId = t.categoryId ? categoryIdMap.get(t.categoryId) : undefined;
        const newToAccountId = t.toAccountId ? accountIdMap.get(t.toAccountId) : undefined;

        if (!newAccountId || !newCategoryId) {
          // P0.11: skip rows whose FK references can't be resolved to the user's own data.
          // This blocks the IDOR attack where a malicious backup references another user's account.
          continue;
        }

        // Validate transaction type + currency
        if (!['EXPENSE', 'INCOME', 'TRANSFER'].includes(t.type)) {
          continue;
        }
        if (!VALID_CURRENCIES.has(t.currency)) {
          continue;
        }

        const amt = Number(t.amount);
        if (!Number.isFinite(amt)) {
          continue;
        }

        await tx.transaction.create({
          data: {
            type: t.type,
            amount: amt,
            currency: t.currency,
            accountId: newAccountId,
            categoryId: newCategoryId,
            toAccountId: newToAccountId || null,
            date: new Date(t.date),
            note: t.note ? String(t.note).slice(0, 500) : null,
            tags: t.tags ? String(t.tags).slice(0, 200) : null,
            transferPairId: t.transferPairId ? String(t.transferPairId).slice(0, 50) : null,
            // P0.19: restore snapshot fields so multi-currency reversal works
            sourceAmount: t.sourceAmount !== undefined && t.sourceAmount !== null ? Number(t.sourceAmount) : null,
            destAmount: t.destAmount !== undefined && t.destAmount !== null ? Number(t.destAmount) : null,
            exchangeRateUsed: t.exchangeRateUsed !== undefined && t.exchangeRateUsed !== null ? Number(t.exchangeRateUsed) : null,
            userId,
          },
        });
        txCount++;
      }

      for (const b of budgets) {
        const newCategoryId = b.categoryId ? categoryIdMap.get(b.categoryId) : undefined;
        if (!newCategoryId) continue;
        if (!VALID_CURRENCIES.has(b.currency)) continue;
        if (!/^\d{4}-\d{2}$/.test(b.month)) continue;
        const lim = Number(b.limit);
        if (!Number.isFinite(lim) || lim < 0) continue;

        await tx.budget.create({
          data: {
            categoryId: newCategoryId,
            month: b.month,
            limit: lim,
            currency: b.currency,
            userId,
          },
        });
        budCount++;
      }

      return { accounts: accCount, categories: catCount, transactions: txCount, budgets: budCount };
    });

    return NextResponse.json({ success: true, imported: result });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
