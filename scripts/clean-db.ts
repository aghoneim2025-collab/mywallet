import { db } from '@/lib/db';

async function main() {
  const txCount = await db.transaction.count();
  console.log('Transactions to delete:', txCount);
  await db.transaction.deleteMany({});
  await db.budget.deleteMany({});
  await db.account.deleteMany({});
  await db.category.deleteMany({});
  await db.setting.deleteMany({});
  console.log('Cleanup done');
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
