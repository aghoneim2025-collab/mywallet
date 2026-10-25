'use client';
import { useEffect, useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tag, TrendingUp, TrendingDown, Search, ChevronRight } from 'lucide-react';
import { useT } from '@/hooks/use-t';
import { useSettings } from '@/lib/store';
import { api } from '@/lib/api';
import { formatMoney, convert, compactNumber, type Currency } from '@/lib/currency';
import { getIcon } from '@/lib/icons';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type RangeKey = 'today' | 'week' | 'month' | 'year';

interface Category {
  id: string; nameAr: string; nameEn: string; type: string; icon: string; color: string;
}
interface TxItem {
  id: string; type: string; amount: number; currency: string; date: string; note: string | null;
  category: Category; account: { id: string; name: string; color: string; icon: string };
}

export function CategoriesScreen() {
  const { t, lang } = useT();
  const baseCurrency = useSettings(s => s.baseCurrency);
  const [items, setItems] = useState<TxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>('month');
  const [search, setSearch] = useState('');
  const [detailCatId, setDetailCatId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString();
      const r = await api<{ data: TxItem[] }>(`/api/transactions?limit=9999&to=${today}`);
      setItems(r.data);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Date range filter
  const dateRange = useMemo(() => {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    let start: string;
    switch (range) {
      case 'today': start = end; break;
      case 'week':
        const w = new Date(now); w.setDate(w.getDate() - 7);
        start = w.toISOString().slice(0, 10); break;
      case 'month':
        start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`; break;
      case 'year':
        start = `${now.getFullYear()}-01-01`; break;
    }
    return { start, end };
  }, [range]);

  // Filter + group by category
  const categoryTotals = useMemo(() => {
    const map = new Map<string, { category: Category; total: number; count: number }>();
    items.forEach(tx => {
      if (tx.type === 'TRANSFER' || tx.category.nameAr === 'تحويلات' || tx.category.nameEn === 'Transfers') return; // Skip transfers
      const txDate = new Date(tx.date).toISOString().slice(0, 10);
      if (txDate < dateRange.start || txDate > dateRange.end) return;
      if (search) {
        const q = search.toLowerCase();
        const name = (lang === 'ar' ? tx.category.nameAr : tx.category.nameEn).toLowerCase();
        if (!name.includes(q)) return;
      }
      const cid = tx.category.id;
      if (!map.has(cid)) map.set(cid, { category: tx.category, total: 0, count: 0 });
      const entry = map.get(cid)!;
      entry.total += convert(tx.amount, tx.currency as Currency, baseCurrency);
      entry.count += 1;
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [items, dateRange, search, baseCurrency, lang]);

  const totalExpense = categoryTotals
    .filter(c => c.category.type === 'EXPENSE' || c.category.type === 'TRANSFER')
    .reduce((s, c) => s + c.total, 0);
  const totalIncome = categoryTotals
    .filter(c => c.category.type === 'INCOME')
    .reduce((s, c) => s + c.total, 0);

  const fmt = (n: number) => formatMoney(n, baseCurrency, lang);

  const rangeLabels: Record<RangeKey, string> = {
    today: lang === 'ar' ? 'اليوم' : 'Today',
    week: lang === 'ar' ? 'الأسبوع' : 'Week',
    month: lang === 'ar' ? 'الشهر' : 'Month',
    year: lang === 'ar' ? 'السنة' : 'Year',
  };

  if (loading) {
    return <div className="p-4 space-y-3">
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
    </div>;
  }

  return (
    <div className="p-4 space-y-4 pb-4">
      <header>
        <h1 className="text-2xl font-bold">{lang === 'ar' ? 'الفئات' : 'Categories'}</h1>
        <p className="text-xs text-slate-500">{categoryTotals.length} {lang === 'ar' ? 'فئة' : 'categories'}</p>
      </header>

      {/* Range filter */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
        {(Object.keys(rangeLabels) as RangeKey[]).map(k => (
          <button
            key={k}
            onClick={() => setRange(k)}
            className={cn(
              'flex-1 py-1.5 rounded text-xs font-medium transition',
              range === k ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm' : 'text-slate-500'
            )}
          >
            {rangeLabels[k]}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={lang === 'ar' ? 'بحث فئة...' : 'Search...'} className="ps-9" />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2">
        <Card className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900">
          <div className="flex items-center gap-1.5 mb-0.5">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">{lang === 'ar' ? 'إجمالي الدخل' : 'Total Income'}</span>
          </div>
          <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300 truncate">{fmt(totalIncome)}</p>
        </Card>
        <Card className="p-3 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900">
          <div className="flex items-center gap-1.5 mb-0.5">
            <TrendingDown className="w-3.5 h-3.5 text-red-600" />
            <span className="text-[10px] font-semibold text-red-700 dark:text-red-400">{lang === 'ar' ? 'إجمالي المصروف' : 'Total Expense'}</span>
          </div>
          <p className="text-sm font-bold text-red-700 dark:text-red-300 truncate">{fmt(totalExpense)}</p>
        </Card>
      </div>

      {/* Category list */}
      {categoryTotals.length === 0 ? (
        <Card className="p-8 text-center">
          <Tag className="w-10 h-10 mx-auto text-slate-300 mb-2" />
          <p className="text-sm text-slate-400">{lang === 'ar' ? 'لا توجد فئات في هذه الفترة' : 'No categories in this period'}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {categoryTotals.map((c, i) => {
            const Icon = getIcon(c.category.icon);
            const isIncome = c.category.type === 'INCOME';
            const pct = totalExpense > 0 ? (c.total / totalExpense) * 100 : 0;
            return (
              <Card
                key={i}
                className="p-3 cursor-pointer hover:shadow-md transition"
                onClick={() => setDetailCatId(c.category.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0" style={{ background: c.category.color }}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-sm font-medium truncate">
                        {lang === 'ar' ? c.category.nameAr : c.category.nameEn}
                      </span>
                      <span className={cn('text-sm font-semibold shrink-0', isIncome ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                        {isIncome ? '+' : '-'}{fmt(c.total)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex-1">
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: c.category.color }} />
                      </div>
                      <span className="text-[10px] text-slate-500 shrink-0">{c.count} {lang === 'ar' ? 'معاملة' : 'txns'}</span>
                      <ChevronRight className="w-3 h-3 text-slate-400 rtl:rotate-180" />
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail modal */}
      {detailCatId && (
        <CategoryDetailModal
          categoryId={detailCatId}
          dateRange={dateRange}
          onClose={() => setDetailCatId(null)}
        />
      )}
    </div>
  );
}

/** Category detail - shows all transactions for a category in date range */
function CategoryDetailModal({
  categoryId, dateRange, onClose,
}: {
  categoryId: string;
  dateRange: { start: string; end: string };
  onClose: () => void;
}) {
  const { t, lang } = useT();
  const baseCurrency = useSettings(s => s.baseCurrency);
  const [txs, setTxs] = useState<TxItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ data: TxItem[] }>(`/api/transactions?categoryId=${categoryId}&from=${dateRange.start}&to=${dateRange.end + 'T23:59:59.999Z'}&limit=500`)
      .then(r => setTxs(r.data))
      .finally(() => setLoading(false));
  }, [categoryId, dateRange]);

  const fmt = (n: number, cur: any = baseCurrency) => formatMoney(n, cur, lang);
  const total = txs.reduce((s, t) => s + convert(t.amount, t.currency as Currency, baseCurrency), 0);

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {txs[0] ? (lang === 'ar' ? txs[0].category.nameAr : txs[0].category.nameEn) : ''}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <Card className="p-4 bg-blue-600 text-white border-0">
              <p className="text-xs text-blue-100">{lang === 'ar' ? 'الإجمالي' : 'Total'}</p>
              <p className="text-2xl font-bold">{fmt(total)}</p>
              <p className="text-xs text-blue-200 mt-1">{txs.length} {lang === 'ar' ? 'معاملة' : 'transactions'}</p>
            </Card>
            <div className="mt-3 space-y-1.5 max-h-72 overflow-y-auto">
              {txs.map(tx => {
                const Icon = getIcon(tx.category?.icon || 'tag');
                const isIncome = tx.type === 'INCOME';
                return (
                  <div key={tx.id} className="flex items-center gap-2 p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0" style={{ background: tx.category?.color || '#64748B' }}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{tx.account?.name}</p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {new Date(tx.date).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' })}
                        {tx.note ? ` • ${tx.note}` : ''}
                      </p>
                    </div>
                    <span className={cn('text-xs font-semibold shrink-0', isIncome ? 'text-emerald-600' : 'text-red-600')}>
                      {isIncome ? '+' : '-'}{fmt(tx.amount, tx.currency)}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
