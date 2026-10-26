// P0.13/P0.14: backfill script for legacy transactions with null snapshot fields.
//
// ChatGPT found two critical issues in the original P0.13 version:
//
//   BUG 1 (math): the conversion was INVERTED.
//     rates[X] = "1 unit of X = how many EGP" (per src/lib/currency.ts:6)
//     To convert `amount` from `from` to `to`:
//       amount → EGP → to
//       = amount * rates[from] / rates[to]
//     The original script did `amount * (rates[to] / rates[from])` —
//     the inverse. E.g., 100 USD → SAR should be ~373.08, but the
//     script produced ~26.80.
//
//   BUG 2 (semantic): even with the math fixed, using CURRENT rates
//     doesn't recover the historical rate that was used when the
//     transaction was created. So backfilling multi-currency
//     transactions would store a WRONG snapshot that would then be
//     used for "idempotent" reversal → silently corrupt balances.
//
// FIX: only backfill transactions where currency === account.currency
// (no conversion was needed → snapshot = raw amount, always correct).
// For multi-currency legacy transactions, leave sourceAmount as null
// and let the API layer REJECT the reversal (see transactions/[id]/route.ts).
//
// To run: `npx tsx scripts/backfill-snapshots.ts`

import { PrismaClient } from '@prisma/client';
import { convert, type Currency } from '../src/lib/currency';

const prisma = new PrismaClient();

async function backfill() {
  console.log('=== P0.14 backfill: snapshot fields for legacy transactions ===');

  // Find all transactions with null sourceAmount
  const legacy = await prisma.transaction.findMany({
    where: { sourceAmount: null },
    include: { account: true, toAccount: true },
  });
  console.log(`Found ${legacy.length} transactions with null sourceAmount`);

  let sameCurrencyUpdated = 0;
  let multiCurrencySkipped = 0;
  let errored = 0;

  for (const t of legacy) {
    if (!t.account) {
      console.warn(`Transaction ${t.id}: account not found, skipping`);
      errored++;
      continue;
    }

    // P0.14: only backfill SAME-currency transactions.
    // For these, sourceAmount = amount (no conversion needed → always correct).
    // For MULTI-currency transactions, we cannot know the historical rate
    // → leave sourceAmount null → API layer will REJECT the reversal.
    if (t.currency === t.account.currency) {
      // Same currency → snapshot is trivially correct
      const sourceAmount = t.amount;
      const exchangeRateUsed = null;  // no conversion was needed

      // For transfers with same-currency destination
      let destAmount: number | null = null;
      if (t.toAccountId && t.toAccount) {
        if (t.currency === t.toAccount.currency) {
          destAmount = t.amount;  // same-currency transfer
        } else {
          // Cross-currency transfer — destAmount can't be safely computed
          // without historical rate. Leave null. API layer will reject.
          destAmount = null;
        }
      }

      await prisma.transaction.update({
        where: { id: t.id },
        data: { sourceAmount, destAmount, exchangeRateUsed },
      });
      sameCurrencyUpdated++;
      continue;
    }

    // Multi-currency transaction — cannot safely backfill.
    // Leave sourceAmount null. The API layer (transactions/[id]/route.ts)
    // will REJECT any attempt to PUT/DELETE this transaction, forcing
    // the user to manually reconcile or accept the current rates.
    console.warn(
      `Transaction ${t.id}: multi-currency (tx=${t.currency}, account=${t.account.currency}). ` +
      `Cannot safely backfill without historical rate. Leaving sourceAmount=null. ` +
      `API will reject PUT/DELETE — user must manually reconcile.`
    );
    multiCurrencySkipped++;
  }

  console.log(`\nBackfill complete:`);
  console.log(`  Same-currency updated: ${sameCurrencyUpdated}`);
  console.log(`  Multi-currency skipped (left null for safety): ${multiCurrencySkipped}`);
  console.log(`  Errored: ${errored}`);

  // Verify
  const remaining = await prisma.transaction.count({ where: { sourceAmount: null } });
  console.log(`  Remaining null sourceAmount: ${remaining}`);

  // Sanity check the convert() function (defensive — catches if someone
  // breaks src/lib/currency.ts in the future)
  console.log(`\nSanity check on convert():`);
  console.log(`  100 USD → SAR: ${convert(100, 'USD', 'SAR')} (expected ~373.08)`);
  console.log(`  100 SAR → USD: ${convert(100, 'SAR', 'USD')} (expected ~26.80)`);
  console.log(`  100 EGP → SAR: ${convert(100, 'EGP', 'SAR')} (expected ~7.69)`);

  await prisma.$disconnect();
}

backfill().catch(e => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
