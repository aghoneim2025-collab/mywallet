import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuthAsync } from '@/lib/auth';
import { handleAuthError } from '@/lib/api-errors';
import {
  parseMoney, parseString, isCurrency, isAccountType, badRequest,
} from '@/lib/validate';

// GET /api/accounts - user-scoped
export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const accounts = await db.account.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    return NextResponse.json({ data: accounts });
  } catch (err: any) {
    return handleAuthError(err);
  }
}

// POST /api/accounts - user-scoped
// P0.11: validate name/type/currency/balance. Wrap default-toggle + create in $transaction.
export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuthAsync(req);
    const body = await req.json();
    const { name, type, currency, balance, color, icon, isDefault } = body || {};

    const nameResult = parseString(name, 'Name', { min: 1, max: 100 });
    if (!nameResult.ok) return badRequest(nameResult.error);

    if (!isAccountType(type)) return badRequest('Invalid account type');
    if (!isCurrency(currency)) return badRequest('Invalid currency (must be EGP, SAR, USD, EUR, or AED)');

    // P0.11: validate balance via parseMoney (allows 0 by default for accounts)
    const balResult = parseMoney(balance, { allowZero: true, allowNegative: true });
    if (!balResult.ok) return badRequest(balResult.error);

    const colorResult = parseString(color, 'Color', { required: false, max: 20 });
    if (!colorResult.ok) return badRequest(colorResult.error);
    const iconResult = parseString(icon, 'Icon', { required: false, max: 100 });
    if (!iconResult.ok) return badRequest(iconResult.error);

    // ATOMIC: toggle old default off + create new account
    const account = await db.$transaction(async (tx) => {
      if (isDefault) {
        const oldDefault = await tx.account.findFirst({ where: { isDefault: true, userId } });
        if (oldDefault) {
          await tx.account.update({ where: { id: oldDefault.id }, data: { isDefault: false } });
        }
      }
      return tx.account.create({
        data: {
          name: nameResult.value,
          type,
          currency,
          balance: balResult.value,
          color: colorResult.value || '#2563EB',
          icon: iconResult.value || 'wallet',
          isDefault: Boolean(isDefault),
          userId,
        },
      });
    });
    return NextResponse.json({ data: account });
  } catch (err: any) {
    return handleAuthError(err);
  }
}
