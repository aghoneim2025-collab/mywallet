/**
 * Recalculate all account balances from transactions
 * Excludes "تحويلات" category entries (old Money Manager Transfer-Out)
 * These should be treated as transfers, not expenses
 *
 * For each old "تحويلات" transaction:
 * - Reverse the expense on the source account (add back the amount)
 * - Try to credit the destination account if mentioned in the note
 */
import { db } from '@/lib/db';
import { convert, type Currency } from '@/lib/currency';

async function main() {
  console.log('🔄 Recalculating account balances...');

  // Get all transactions
  const allTxs = await db.transaction.findMany({
    include: { account: true, category: true },
  });
  console.log(`  Found ${allTxs.length} total transactions`);

  // Get all accounts
  const accounts = await db.account.findMany();
  console.log(`  Found ${accounts.length} accounts`);

  // For each account, calculate the correct balance
  for (const acc of accounts) {
    let balance = 0;

    for (const tx of allTxs) {
      if (tx.accountId !== acc.id) continue;

      const isTransfer =
        tx.type === 'TRANSFER' ||
        tx.category?.nameAr === 'تحويلات' ||
        tx.category?.nameEn === 'Transfers';

      if (isTransfer) {
        // For transfers: the source account should NOT be debited
        // Skip this transaction for balance calculation
        continue;
      }

      // Convert amount to account currency
      let amount = tx.amount;
      if (tx.currency !== acc.currency) {
        amount = convert(tx.amount, tx.currency as Currency, acc.currency as Currency);
      }

      if (tx.type === 'INCOME') {
        balance += amount;
      } else if (tx.type === 'EXPENSE') {
        balance -= amount;
      }
      // TRANSFER type handled separately (new transfer API creates proper entries)
      if (tx.type === 'TRANSFER' as any) {
        // New-style transfers: source is debited, destination is credited
        // This is already handled by the transfer API
        // For old data, the source was already debited, so we skip
        // For new data (type=TRANSFER), we need to handle it
        balance -= amount; // debit source
      }
    }

    // Handle new-style transfers (type=TRANSFER with toAccountId)
    const newTransfers = allTxs.filter(
      t => t.type === 'TRANSFER' as any && t.toAccountId === acc.id
    );
    for (const tx of newTransfers) {
      let amount = tx.amount;
      if (tx.currency !== acc.currency) {
        amount = convert(tx.amount, tx.currency as Currency, acc.currency as Currency);
      }
      balance += amount; // credit destination
    }

    const oldBalance = acc.balance;
    console.log(`  ${acc.name}: ${oldBalance.toFixed(2)} → ${balance.toFixed(2)} ${acc.currency}`);

    // Update the account balance
    await db.account.update({
      where: { id: acc.id },
      data: { balance },
    });
  }

  console.log('\n✅ Account balances recalculated!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
