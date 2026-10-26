'use client';
import { useEffect, useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Filter, Trash2, ArrowDownUp, ArrowUpRight, ArrowDownRight, Wallet } from 'lucide-react';
import { useT } from '@/hooks/use-t';
import { useSettings } from '@/lib/store';
import { api } from '@/lib/api';
import { formatMoney, convert, compactNumber, type Currency } from '@/lib/currency';
import { getIcon } from '@/lib/icons';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface TxItem {
  id: string; type: string; amount: number; currency: string; date: string; note: string | null;
  category: { id: string; nameAr: string; nameEn: string; color: string; icon: string; type: string };
  account: { id: string; name: string; color: string; icon: string; currency: string };
}
interface Category { id: string; nameAr: string; nameEn: string; type: string; color: string; icon: string; }
interface Stat {
  totalExpense: number; totalIncome: number; balance: number; totalAssets: number;
  baseCurrency: string; expenseCount: number; incomeCount: number;
  byCategory: any[]; byDay: any[]; month: string;
}

export function HomeScreen({ onEditTx, onOpenAccounts }: {
  onEditTx: (tx: TxItem) => void;
  onOpenAccounts: () => void;
}) {
  const { t, lang } = useT();
  const { toast } = useToast();
  const baseCurrency = useSettings(s => s.baseCurrency);
  const [items, setItems] = useState<TxItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stat, setStat] = useState<Stat | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'EXPENSE' | 'INCOME'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));

  const load = async () => {
    setLoading(true);
    const month = new Date().toISOString().slice(0, 7);
    const today = new Date().toISOString();
    try {
      const [s, r, c] = await Promise.all([
        api<{ data: Stat }>(`/api/stats?month=${month}&baseCurrency=${baseCurrency}`),
        api<{ data: TxItem[] }>(`/api/transactions?limit=500&to=${today}`),
        api<{ data: Category[] }>('/api/categories'),
      ]);
      setStat(s.data);
      setItems(r.data);
      setCategories(c.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [baseCurrency]);

  const fmt = (n: number) => formatMoney(n, baseCurrency, lang);

  // Filter: EXCLUDE transfers from the list
  const filtered = useMemo(() => {
    return items.filter(tx => {
      if (tx.type === 'TRANSFER' || tx.category.nameAr === 'تحويلات' || tx.category.nameEn === 'Transfers') return false; // Transfers not shown here
      if (typeFilter !== 'ALL' && tx.type !== typeFilter) return false;
      if (categoryFilter !== 'ALL' && tx.category.id !== categoryFilter) return false;
      if (search) {
        const q = search.toLowerCase().trim();
        const cat = (lang === 'ar' ? tx.category.nameAr : tx.category.nameEn).toLowerCase();
        const catOther = (lang === 'ar' ? tx.category.nameEn : tx.category.nameAr).toLowerCase();
        const accName = (tx.account?.name || '').toLowerCase();
        const amountStr = String(tx.amount);
        const noteStr = (tx.note || '').toLowerCase();
        if (!cat.includes(q) && !catOther.includes(q) && !accName.includes(q) && !amountStr.includes(q) && !noteStr.includes(q)) return false;
      }
      if (fromDate) { const d = new Date(tx.date).toISOString().slice(0, 10); if (d < fromDate) return false; }
      if (toDate) { const d = new Date(tx.date).toISOString().slice(0, 10); if (d > toDate) return false; }
      return true;
    });
  }, [items, search, typeFilter, categoryFilter, fromDate, toDate, lang]);

  // Group by date
  const grouped = useMemo(() => {
    const m = new Map<string, TxItem[]>();
    filtered.forEach(tx => {
      const key = new Date(tx.date).toISOString().slice(0, 10);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(tx);
    });
    const entries = Array.from(m.entries());
    entries.sort((a, b) => sortOrder === 'desc' ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0]));
    return entries;
  }, [filtered, sortOrder]);

  // Quick summary
  const quickSummary = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let tE = 0, wE = 0, mE = 0, tI = 0, wI = 0, mI = 0;
    filtered.forEach(tx => {
      const d = new Date(tx.date).toISOString().slice(0, 10);
      const a = convert(tx.amount, tx.currency as Currency, baseCurrency);
      if (tx.type === 'EXPENSE') {
        if (d === todayStr) tE += a;
        if (d >= weekAgo.toISOString().slice(0, 10)) wE += a;
        if (d >= monthStart.toISOString().slice(0, 10)) mE += a;
      } else if (tx.type === 'INCOME') {
        if (d === todayStr) tI += a;
        if (d >= weekAgo.toISOString().slice(0, 10)) wI += a;
        if (d >= monthStart.toISOString().slice(0, 10)) mI += a;
      }
    });
    return { tE, wE, mE, tI, wI, mI };
  }, [filtered, baseCurrency]);

  const handleDelete = async (tx: TxItem) => {
    if (!confirm(lang === 'ar' ? 'حذف المعاملة؟' : 'Delete?')) return;
    try {
      await api(`/api/transactions/${tx.id}`, { method: 'DELETE' });
      toast({ title: lang === 'ar' ? 'تم الحذف' : 'Deleted' });
      load();
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' });

  if (loading || !stat) {
    return <div className="p-4 space-y-3">
      <Skeleton className="h-32 w-full rounded-2xl" />
      <Skeleton className="h-12 w-full" />
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
    </div>;
  }

  return (
    <div className="p-4 space-y-4 pb-4">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500">{t('welcomeBack')}</p>
          <h1 className="text-xl font-bold">{t('appName')}</h1>
        </div>
      </header>

      {/* Balance Card */}
      <Card className="relative overflow-hidden bg-gradient-to-br from-blue-600 to-blue-700 text-white border-0 p-5">
        <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/10" />
        <div className="absolute -left-12 -bottom-12 w-40 h-40 rounded-full bg-white/5" />
        <div className="relative">
          <p className="text-sm text-blue-100">{t('totalBalance')}</p>
          <p className="text-3xl font-bold mt-1 mb-4">{fmt(stat.totalAssets)}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/15 rounded-xl p-3 backdrop-blur-sm text-start">
              <div className="flex items-center gap-1 text-emerald-300 text-xs">
                <ArrowUpRight className="w-3 h-3" /> {t('monthlyIncome')}
              </div>
              <p className="font-bold mt-0.5">{fmt(stat.totalIncome)}</p>
            </div>
            <div className="bg-white/15 rounded-xl p-3 backdrop-blur-sm text-start">
              <div className="flex items-center gap-1 text-red-300 text-xs">
                <ArrowDownRight className="w-3 h-3" /> {t('monthlyExpenses')}
              </div>
              <p className="font-bold mt-0.5">{fmt(stat.totalExpense)}</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Quick summary */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="p-2.5 bg-slate-50 dark:bg-slate-800/50 text-center">
          <p className="text-[10px] text-slate-500 font-medium">{lang === 'ar' ? 'اليوم' : 'Today'}</p>
          <p className="text-xs font-bold text-red-600 dark:text-red-400 truncate">{compactNumber(quickSummary.tE, lang)}</p>
          <p className="text-[10px] text-emerald-600">{compactNumber(quickSummary.tI, lang)}+</p>
        </Card>
        <Card className="p-2.5 bg-slate-50 dark:bg-slate-800/50 text-center">
          <p className="text-[10px] text-slate-500 font-medium">{lang === 'ar' ? 'الأسبوع' : 'Week'}</p>
          <p className="text-xs font-bold text-red-600 dark:text-red-400 truncate">{compactNumber(quickSummary.wE, lang)}</p>
          <p className="text-[10px] text-emerald-600">{compactNumber(quickSummary.wI, lang)}+</p>
        </Card>
        <Card className="p-2.5 bg-slate-50 dark:bg-slate-800/50 text-center">
          <p className="text-[10px] text-slate-500 font-medium">{lang === 'ar' ? 'الشهر' : 'Month'}</p>
          <p className="text-xs font-bold text-red-600 dark:text-red-400 truncate">{compactNumber(quickSummary.mE, lang)}</p>
          <p className="text-[10px] text-emerald-600">{compactNumber(quickSummary.mI, lang)}+</p>
        </Card>
      </div>

      {/* Search + Sort + Date filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={lang === 'ar' ? 'بحث بالاسم أو المبلغ...' : 'Search...'} className="ps-9" />
        </div>
        <button onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')} className="px-3 rounded-lg border-2 border-slate-200 dark:border-slate-800 text-slate-500 flex items-center gap-1">
          <ArrowDownUp className={cn('w-4 h-4 transition', sortOrder === 'asc' && 'rotate-180')} />
          <span className="text-xs font-medium">{sortOrder === 'desc' ? (lang === 'ar' ? 'الأحدث' : 'Newest') : (lang === 'ar' ? 'الأقدم' : 'Oldest')}</span>
        </button>
        <button onClick={() => setShowDateFilter(!showDateFilter)} className={cn('px-3 rounded-lg border-2 transition flex items-center gap-1', showDateFilter || fromDate || toDate ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300' : 'border-slate-200 dark:border-slate-800 text-slate-500')}>
          <Filter className="w-4 h-4" /><span className="text-xs font-medium">{lang === 'ar' ? 'تاريخ' : 'Date'}</span>
        </button>
      </div>

      {/* Date filter */}
      {showDateFilter && (
        <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 font-medium">{lang === 'ar' ? 'من' : 'From'}</label>
            <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 font-medium">{lang === 'ar' ? 'إلى' : 'To'}</label>
            <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-9 text-sm" />
          </div>
          {(fromDate || toDate) && <button onClick={() => { setFromDate(''); setToDate(''); }} className="col-span-2 text-xs text-red-600 hover:underline mt-1">{lang === 'ar' ? 'مسح' : 'Clear'}</button>}
        </div>
      )}

      {/* Type + Category filters */}
      <div className="grid grid-cols-2 gap-2">
        <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
          <SelectTrigger><SelectValue placeholder={t('type')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('all')}</SelectItem>
            <SelectItem value="EXPENSE">{t('expense')}</SelectItem>
            <SelectItem value="INCOME">{t('income')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger><SelectValue placeholder={t('category')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('all')}</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.id}>{lang === 'ar' ? c.nameAr : c.nameEn}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Transaction list (NO TRANSFERS) */}
      {grouped.length === 0 ? (
        <Card className="p-8 text-center text-slate-500">
          <Filter className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">{t('noTransactionsYet')}</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([day, txs]) => {
            const totalExp = txs.filter(t => t.type === 'EXPENSE').reduce((s, t) => s + convert(t.amount, t.currency as Currency, baseCurrency), 0);
            const totalInc = txs.filter(t => t.type === 'INCOME').reduce((s, t) => s + convert(t.amount, t.currency as Currency, baseCurrency), 0);
            return (
              <div key={day}>
                <div className="flex justify-between items-baseline mb-1.5 px-1">
                  <h3 className="text-xs font-semibold text-slate-500">{formatDate(day)}</h3>
                  <p className="text-xs text-slate-400">
                    {totalInc > 0 && <span className="text-emerald-600">+{fmt(totalInc)}</span>}
                    {totalInc > 0 && totalExp > 0 && ' / '}
                    {totalExp > 0 && <span className="text-red-600">-{fmt(totalExp)}</span>}
                  </p>
                </div>
                <Card className="divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                  {txs.map(tx => {
                    const Icon = getIcon(tx.category.icon);
                    const isIncome = tx.type === 'INCOME';
                    return (
                      <div key={tx.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                        <button onClick={() => onEditTx(tx)} className="flex items-center gap-3 flex-1 min-w-0 text-start">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0" style={{ background: tx.category.color }}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{lang === 'ar' ? tx.category.nameAr : tx.category.nameEn}</p>
                            <p className="text-xs text-slate-400 truncate">{tx.account.name}{tx.note ? ` • ${tx.note}` : ''}</p>
                          </div>
                          <div className={cn('font-semibold text-sm shrink-0', isIncome ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                            {isIncome ? '+' : '-'}{formatMoney(tx.amount, tx.currency as Currency, lang)}
                          </div>
                        </button>
                        <button onClick={() => handleDelete(tx)} className="text-slate-400 hover:text-red-500 p-1 transition shrink-0" aria-label={t('delete')}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
