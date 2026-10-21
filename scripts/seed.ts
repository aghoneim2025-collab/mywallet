/**
 * Seed script - ينشئ الفئات الافتراضية + حساب كاش افتراضي
 * Run with: bun run /home/z/my-project/scripts/seed.ts
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const defaultCategories = [
  // ===== Expense categories =====
  { nameAr: 'مصاريف أساسية', nameEn: 'Essentials', type: 'EXPENSE', icon: 'home', color: '#EF4444', isDefault: true },
  { nameAr: 'تسوق وطعام', nameEn: 'Shopping & Food', type: 'EXPENSE', icon: 'shopping-cart', color: '#F59E0B', isDefault: true },
  { nameAr: 'مواصلات', nameEn: 'Transportation', type: 'EXPENSE', icon: 'car', color: '#3B82F6', isDefault: true },
  { nameAr: 'صحة ورعاية', nameEn: 'Health & Care', type: 'EXPENSE', icon: 'heart-pulse', color: '#EC4899', isDefault: true },
  { nameAr: 'تعليم وتطوير', nameEn: 'Education', type: 'EXPENSE', icon: 'graduation-cap', color: '#8B5CF6', isDefault: true },
  { nameAr: 'سفر وترفيه', nameEn: 'Travel & Fun', type: 'EXPENSE', icon: 'plane', color: '#06B6D4', isDefault: true },
  { nameAr: 'اشتراكات وهدايا', nameEn: 'Subscriptions & Gifts', type: 'EXPENSE', icon: 'gift', color: '#14B8A6', isDefault: true },
  // ===== Income categories =====
  { nameAr: 'راتب أساسي', nameEn: 'Salary', type: 'INCOME', icon: 'banknote', color: '#10B981', isDefault: true },
  { nameAr: 'دخل فريلانس', nameEn: 'Freelance', type: 'INCOME', icon: 'laptop', color: '#22C55E', isDefault: true },
  { nameAr: 'دخل استثماري', nameEn: 'Investment', type: 'INCOME', icon: 'trending-up', color: '#16A34A', isDefault: true },
];

async function main() {
  console.log('🟢 Seeding categories...');
  for (const cat of defaultCategories) {
    const existing = await db.category.findFirst({ where: { nameAr: cat.nameAr } });
    if (existing) {
      await db.category.update({ where: { id: existing.id }, data: cat });
    } else {
      await db.category.create({ data: cat });
    }
    console.log(`  ✓ ${cat.nameAr} / ${cat.nameEn}`);
  }

  console.log('\n🟢 Seeding default cash account...');
  const existingAcc = await db.account.findFirst({ where: { isDefault: true } });
  if (!existingAcc) {
    await db.account.create({
      data: {
        name: 'محفظتي',
        type: 'CASH',
        currency: 'EGP',
        balance: 0,
        color: '#2563EB',
        icon: 'wallet',
        isDefault: true,
      },
    });
    console.log('  ✓ Default cash account created');
  } else {
    console.log('  - Default account already exists');
  }

  console.log('\n🟢 Seeding settings...');
  const settings = [
    { key: 'language', value: 'ar' },
    { key: 'baseCurrency', value: 'EGP' },
    { key: 'onboardingComplete', value: 'false' },
  ];
  for (const s of settings) {
    const existingSet = await db.setting.findUnique({ where: { key: s.key } });
    if (existingSet) {
      await db.setting.update({ where: { id: existingSet.id }, data: { value: s.value } });
    } else {
      await db.setting.create({ data: s });
    }
  }
  console.log('  ✓ Settings seeded');

  console.log('\n✅ Seed completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
