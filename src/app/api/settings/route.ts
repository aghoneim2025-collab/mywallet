import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/settings  -> returns all settings as key/value
export async function GET() {
  try {
    const settings = await db.setting.findMany();
    const result: Record<string, string> = {};
    settings.forEach(s => (result[s.key] = s.value));
    return NextResponse.json({ data: result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/settings - upsert setting(s) by key
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json(); // { key, value } or { settings: {...} }
    const items: { key: string; value: string }[] = Array.isArray(body)
      ? body
      : body.settings
        ? Object.entries(body.settings).map(([k, v]) => ({ key: k, value: String(v) }))
        : [{ key: body.key, value: String(body.value) }];

    const results = [];
    for (const item of items) {
      const existing = await db.setting.findUnique({ where: { key: item.key } });
      if (existing) {
        const u = await db.setting.update({
          where: { id: existing.id },
          data: { value: item.value },
        });
        results.push(u);
      } else {
        const c = await db.setting.create({ data: item });
        results.push(c);
      }
    }
    return NextResponse.json({ data: results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
