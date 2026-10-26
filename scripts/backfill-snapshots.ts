// P0.13: backfill script for legacy transactions with null snapshot fields.
// Run once after deploying P0.12 to populate sourceAmount/destAmount/exchangeRateUsed
// for all pre-existing transactions.
//
// Strategy: use CURRENT exchange rates to compute the snapshot. This means
// the snapshot reflects the current rate, not the historical rate at the
// time of the original transaction. For transactions where the rate hasn't
// changed, this is correct. For transactions where the rate has changed,
// the snapshot is "best-effort" — better than nothing, but not perfect.
//
// To run: `npx tsx scripts/backfill-snapshots.ts`
//
// After running, the legacy null fallback in transactions/[id]/route.ts
// should never be hit (all transactions will have snapshots).

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Import the currency conversion + types
// (Inline here to avoid module path issues)
const DEFAULT_EXCHANGE_RATES: Record<string, number> = {
  EGP: 1,
  SAR: 13,
  USD: 48.5,
  EUR: 52,
  AED: 13.2,
};

function convert(amount: number, from: string, to: string): number {
  if (from === to) return amount;
  const fromRate = DEFAULT_EXCHANGE_RATES[from] ?? 1;
  const toRate = DEFAULT_EXCHANGE_RATES[to] ?? 1;
  return amount * (toRate / fromRate);
}

async function backfill() {
  console.log('=== P0.13 backfill: snapshot fields for legacy transactions ===');

  // Find all transactions with null sourceAmount
  const legacy = await prisma.transaction.findMany({
    where: { sourceAmount: null },
    include: { account: true, toAccount: true },
  });
  console.log(`Found ${legacy.length} transactions with null sourceAmount`);

  let updated = 0;
  let skipped = 0;
  for (const t of legacy) {
    if (!t.account) {
      console.warn(`Transaction ${t.id}: account not found, skipping`);
      skipped++;
      continue;
    }

    // Compute sourceAmount: amount converted to source account's currency
    const sourceAmount = t.currency === t.account.currency
      ? t.amount
      : convert(t.amount, t.currency, t.account.currency);

    if (!Number.isFinite(sourceAmount)) {
      console.warn(`Transaction ${t.id}: conversion produced NaN, skipping`);
      skipped++;
      continue;
    }

    const exchangeRateUsed = t.currency === t.account.currency ? null : (sourceAmount / t.amount);

    // For transfers, compute destAmount too
    let destAmount: number | null = null;
    if (t.toAccountId && t.toAccount) {
      destAmount = t.currency === t.toAccount.currency
        ? t.amount
        : convert(t.amount, t.currency, t.toAccount.currency);
      if (!Number.isFinite(destAmount)) {
        console.warn(`Transaction ${t.id} (transfer): destAmount conversion produced NaN, setting null`);
        destAmount = null;
      }
    }

    await prisma.transaction.update({
      where: { id: t.id },
      data: { sourceAmount, destAmount, exchangeRateUsed },
    });
    updated++;
  }

  console.log(`\nBackfill complete:`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);

  // Verify
  const remaining = await prisma.transaction.count({ where: { sourceAmount: null } });
  console.log(`  Remaining null sourceAmount: ${remaining}`);

  await prisma.$disconnect();
}

backfill().catch(e => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
