import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/bill-reminders
export async function GET() {
  const reminders = await db.billReminder.findMany({
    orderBy: { dueDate: 'asc' },
  });
  return NextResponse.json({ data: reminders });
}

// POST /api/bill-reminders
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, amount, currency, dueDate, recurring, frequency, accountId, remindDays } = body;
    if (!name || !amount || !dueDate) {
      return NextResponse.json({ error: 'name, amount, dueDate required' }, { status: 400 });
    }
    const reminder = await db.billReminder.create({
      data: {
        name, amount: Number(amount),
        currency: currency || 'EGP',
        dueDate: new Date(dueDate),
        recurring: recurring !== false,
        frequency: frequency || 'monthly',
        accountId: accountId || null,
        remindDays: remindDays || 3,
      },
    });
    return NextResponse.json({ data: reminder });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/bill-reminders?id=... (mark as paid)
export async function PUT(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const body = await req.json();
    const { paid, dueDate } = body;

    // If marking as paid and recurring, create next occurrence
    if (paid) {
      const reminder = await db.billReminder.findUnique({ where: { id } });
      if (reminder && reminder.recurring) {
        const nextDue = new Date(reminder.dueDate);
        if (reminder.frequency === 'monthly') nextDue.setMonth(nextDue.getMonth() + 1);
        else if (reminder.frequency === 'weekly') nextDue.setDate(nextDue.getDate() + 7);
        else if (reminder.frequency === 'yearly') nextDue.setFullYear(nextDue.getFullYear() + 1);

        const updated = await db.billReminder.update({
          where: { id },
          data: { paid: false, dueDate: nextDue },
        });
        return NextResponse.json({ data: updated });
      }
    }

    const updated = await db.billReminder.update({
      where: { id },
      data: {
        ...(paid !== undefined ? { paid } : {}),
        ...(dueDate !== undefined ? { dueDate: new Date(dueDate) } : {}),
      },
    });
    return NextResponse.json({ data: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/bill-reminders?id=...
export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await db.billReminder.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
