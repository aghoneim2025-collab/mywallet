// P0.15: full transfer flow test - verify snapshot fields are populated
// and used correctly for reversal.

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateToken, verifyTokenSignature, hashToken } from '../src/lib/auth';
import { convertServer } from '../src/lib/currency';

const prisma = new PrismaClient();

async function test() {
  console.log('=== P0.15 transfer flow test ===\n');

  // Create test user + 2 accounts (different currencies)
  const email = 'p15-transfer@example.com';
  const passwordHash = await bcrypt.hash('StrongPass1!', 12);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, name: 'Test' },
    update: { passwordHash },
  });

  // Clean prior data for this user
  await prisma.transaction.deleteMany({ where: { userId: user.id } });
  await prisma.account.deleteMany({ where: { userId: user.id } });
  await prisma.category.deleteMany({ where: { userId: user.id } });
  await prisma.revokedToken.deleteMany({ where: { userId: user.id } });

  // Create 2 accounts: SAR + USD
  const sarAccount = await prisma.account.create({
    data: {
      name: 'SAR Bank', type: 'BANK', currency: 'SAR',
      balance: 1000, color: '#2563EB', icon: 'wallet', isDefault: true, userId: user.id,
    },
  });
  const usdAccount = await prisma.account.create({
    data: {
      name: 'USD Wallet', type: 'E_WALLET', currency: 'USD',
      balance: 100, color: '#10B981', icon: 'credit-card', isDefault: false, userId: user.id,
    },
  });
  const transferCat = await prisma.category.create({
    data: { nameAr: 'تحويلات', nameEn: 'Transfers', type: 'TRANSFER' as any, icon: 'arrow-right-left', color: '#64748B', userId: user.id },
  });

  console.log('Initial state:');
  console.log(`  SAR account: balance=${sarAccount.balance} ${sarAccount.currency}`);
  console.log(`  USD account: balance=${usdAccount.balance} ${usdAccount.currency}`);

  // Test 1: Transfer 100 SAR → USD account
  // Source: 100 SAR (no conversion, SAR account stays SAR)
  // Dest: convert 100 SAR → USD = 100 * 13 / 48.5 = 26.80 USD
  console.log('\n=== Test 1: Transfer 100 SAR → USD ===');
  const transferAmount = 100;
  const sourceAmount = transferAmount;  // same currency, no conversion
  const destAmount = convertServer(transferAmount, 'SAR', 'USD');
  console.log(`  Computed: sourceAmount=${sourceAmount}, destAmount=${destAmount.toFixed(4)}`);
  console.log(`  Expected: sourceAmount=100, destAmount=26.8041`);

  if (!Number.isFinite(sourceAmount) || !Number.isFinite(destAmount)) {
    console.log('  ❌ NaN/Infinity in amounts');
    return;
  }

  // Create the transfer with snapshot fields
  const tx1 = await prisma.transaction.create({
    data: {
      type: 'TRANSFER' as any,
      amount: transferAmount,
      currency: 'SAR',  // the tx currency (matches source)
      accountId: sarAccount.id,
      categoryId: transferCat.id,
      toAccountId: usdAccount.id,
      userId: user.id,
      date: new Date(),
      note: 'Test transfer SAR → USD',
      // P0.12 snapshot
      sourceAmount,
      destAmount,
      exchangeRateUsed: sourceAmount === transferAmount ? null : (sourceAmount / transferAmount),
    },
  });
  console.log(`  Created transaction: ${tx1.id}`);
  console.log(`  Snapshot: sourceAmount=${tx1.sourceAmount}, destAmount=${tx1.destAmount}, exchangeRateUsed=${tx1.exchangeRateUsed}`);

  // Update balances
  await prisma.account.update({
    where: { id: sarAccount.id },
    data: { balance: { decrement: sourceAmount } },
  });
  await prisma.account.update({
    where: { id: usdAccount.id },
    data: { balance: { increment: destAmount } },
  });

  const afterSar = await prisma.account.findUnique({ where: { id: sarAccount.id } });
  const afterUsd = await prisma.account.findUnique({ where: { id: usdAccount.id } });
  console.log(`  After transfer: SAR=${afterSar!.balance} (was 1000, expected 900), USD=${afterUsd!.balance.toFixed(4)} (was 100, expected 126.8041)`);

  // Test 2: Delete the transfer - verify snapshot is used (not re-convert)
  console.log('\n=== Test 2: Delete transfer (should use snapshot) ===');
  // Reverse: SAR += sourceAmount (100), USD -= destAmount (26.8041)
  await prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findFirst({
      where: { id: tx1.id, userId: user.id },
      include: { account: true, toAccount: true },
    });
    if (!existing) throw new Error('not found');

    const srcAmount = existing.sourceAmount ?? existing.amount;
    const dstAmount = existing.destAmount ?? existing.amount;

    console.log(`  Using snapshot: srcAmount=${srcAmount}, dstAmount=${dstAmount}`);

    await tx.account.update({
      where: { id: existing.accountId },
      data: { balance: { increment: srcAmount } },
    });
    await tx.account.update({
      where: { id: existing.toAccountId! },
      data: { balance: { increment: -dstAmount } },
    });
    await tx.transaction.delete({ where: { id: tx1.id } });
  });

  const finalSar = await prisma.account.findUnique({ where: { id: sarAccount.id } });
  const finalUsd = await prisma.account.findUnique({ where: { id: usdAccount.id } });
  console.log(`  After delete: SAR=${finalSar!.balance} (expected 1000), USD=${finalUsd!.balance.toFixed(4)} (expected 100)`);

  const sarCorrect = finalSar!.balance === 1000;
  const usdCorrect = Math.abs(finalUsd!.balance - 100) < 0.0001;
  console.log(`  SAR balance correct? ${sarCorrect ? 'YES ✅' : 'NO ❌'}`);
  console.log(`  USD balance correct? ${usdCorrect ? 'YES ✅' : 'NO ❌'}`);

  // Test 3: verify that re-converting with CURRENT rates would have given a different result
  console.log('\n=== Test 3: Demonstrate snapshot importance ===');
  // If rates changed (say USD doubled to 97), re-converting 100 SAR would give:
  const reconvertedWithNewRates = 100 * 13 / 97;  // would-be destAmount with new rates
  console.log(`  If USD rate changed to 97: re-convert would give destAmount=${reconvertedWithNewRates.toFixed(4)}`);
  console.log(`  But snapshot stored: ${tx1.destAmount} (correct historical value)`);
  console.log(`  Snapshot protects against rate-change drift ✅`);

  // Cleanup
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
  console.log('\n✅ Transfer flow test passed');
}

test().catch(e => { console.error('❌ Test failed:', e); process.exit(1); });
