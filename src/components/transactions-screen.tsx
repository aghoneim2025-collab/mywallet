'use client';
import { useEffect, useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Filter, Trash2, Pencil, ArrowDownUp, Calendar } from 'lucide-react';
import { useT } from '@/hooks/use-t';
import { useSettings } from '@/lib/store';
import { api } from '@/lib/api';
import { formatMoney, convert, compactNumber, type Currency } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { getIcon } from '@/lib/icons';
import { useToast } from '@/hooks/use-toast';

interface TxItem {
  id: string;
  type: string;
  amount: number;
  currency: string;
  date: string;
  note: string | null;
  toAccountId?: string | null;
  category: { id: string; nameAr: string; nameEn: string; color: string; icon: string; type: string };
  account: { id: string; name: string; color: string; icon: string; currency: string };
  toAccount?: { id: string; name: string; color: string; icon: string; currency: string } | null;
}

interface Category { id: string; nameAr: string; nameEn: string; type: string; color: string; icon: string; }

export function TransactionsScreen({ onEditTx }: { onEditTx: (tx: TxItem) => void }) {
  const { t, lang } = useT();
  const { toast } = useToast();
  const baseCurrency = useSettings(s => s.baseCurrency);
  const [items, setItems] = useState<TxItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'EXPENSE' | 'INCOME' | 'TRANSFER'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const load = async () => {
    setLoading(true);
    try {
      const [t1, c1] = await Promise.all([
        api<{ data: TxItem[] }>('/api/transactions?limit=500'),
        api<{ data: Category[] }>('/api/categories'),
      ]);
      setItems(t1.data);
      setCategories(c1.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return items.filter(tx => {
      if (typeFilter !== 'ALL' && tx.type !== typeFilter) return false;
      if (categoryFilter !== 'ALL' && tx.category.id !== categoryFilter) return false;
      if (search) {
        const q = search.toLowerCase().trim();
        const cat = lang === 'ar' ? tx.category.nameAr : tx.category.nameEn;
        const catOther = lang === 'ar' ? tx.category.nameEn : tx.category.nameAr;
        const accName = tx.account?.name || '';
        const toAccName = tx.toAccount?.name || '';
        const amountStr = String(tx.amount);
        const noteStr = tx.note || '';
        // Smart search: matches name OR amount OR note
        if (!cat.toLowerCase().includes(q) &&
            !catOther.toLowerCase().includes(q) &&
            !accName.toLowerCase().includes(q) &&
            !toAccName.toLowerCase().includes(q) &&
            !amountStr.includes(q) &&
            !noteStr.toLowerCase().includes(q)) return false;
      }
      if (fromDate) {
        const txDate = new Date(tx.date).toISOString().slice(0, 10);
        if (txDate < fromDate) return false;
      }
      if (toDate) {
        const txDate = new Date(tx.date).toISOString().slice(0, 10);
        if (txDate > toDate) return false;
      }
      return true;
    });
  }, [items, search, typeFilter, categoryFilter, fromDate, toDate, lang]);

  // group by day - sorted by toggle
  const grouped = useMemo(() => {
    const m = new Map<string, TxItem[]>();
    filtered.forEach(tx => {
      const d = new Date(tx.date);
      const key = d.toISOString().slice(0, 10);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(tx);
    });
    const entries = Array.from(m.entries());
    // Sort by toggle: desc = newest first, asc = oldest first
    if (sortOrder === 'desc') {
      entries.sort((a, b) => b[0].localeCompare(a[0]));
    } else {
      entries.sort((a, b) => a[0].localeCompare(b[0]));
    }
    return entries;
  }, [filtered, sortOrder]);

  // Quick summary: today / this week / this month
  const quickSummary = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let todayExp = 0, weekExp = 0, monthExp = 0;
    let todayInc = 0, weekInc = 0, monthInc = 0;

    filtered.forEach(tx => {
      const txDate = new Date(tx.date).toISOString().slice(0, 10);
      const amt = convert(tx.amount, tx.currency as Currency, baseCurrency as Currency);
      if (tx.type === 'EXPENSE') {
        if (txDate === todayStr) todayExp += amt;
        if (txDate >= weekAgo.toISOString().slice(0, 10)) weekExp += amt;
        if (txDate >= monthStart.toISOString().slice(0, 10)) monthExp += amt;
      } else if (tx.type === 'INCOME') {
        if (txDate === todayStr) todayInc += amt;
        if (txDate >= weekAgo.toISOString().slice(0, 10)) weekInc += amt;
        if (txDate >= monthStart.toISOString().slice(0, 10)) monthInc += amt;
      }
    });

    return { todayExp, weekExp, monthExp, todayInc, weekInc, monthInc };
  }, [filtered, baseCurrency]);

  const handleDelete = async (tx: TxItem) => {
    if (!confirm(lang === 'ar' ? `حذف المعاملة؟` : 'Delete transaction?')) return;
    try {
      await api(`/api/transactions/${tx.id}`, { method: 'DELETE' });
      toast({ title: lang === 'ar' ? 'تم الحذف' : 'Deleted' });
      load();
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' });
    }
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  };

  const fmt = (n: number, cur: string) => formatMoney(n, cur as any, lang);

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t('transactions')}</h1>
        <p className="text-sm text-slate-500">{filtered.length} {t('transactions')}</p>
      </header>

      {/* Search + Date toggle + Sort */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={lang === 'ar' ? 'بحث بالاسم أو المبلغ...' : 'Search by name or amount...'}
            className="ps-9"
          />
        </div>
        <button
          onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
          className="px-3 rounded-lg border-2 border-slate-200 dark:border-slate-800 text-slate-500 flex items-center gap-1"
          aria-label={lang === 'ar' ? 'ترتيب' : 'Sort'}
        >
          <ArrowDownUp className={cn('w-4 h-4 transition', sortOrder === 'asc' && 'rotate-180')} />
          <span className="text-xs font-medium">{sortOrder === 'desc' ? (lang === 'ar' ? 'الأحدث' : 'Newest') : (lang === 'ar' ? 'الأقدم' : 'Oldest')}</span>
        </button>
        <button
          onClick={() => setShowDateFilter(!showDateFilter)}
          className={cn(
            'px-3 rounded-lg border-2 transition flex items-center gap-1',
            showDateFilter || fromDate || toDate
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
              : 'border-slate-200 dark:border-slate-800 text-slate-500'
          )}
          aria-label={lang === 'ar' ? 'فلتر التاريخ' : 'Date filter'}
        >
          <Filter className="w-4 h-4" />
          <span className="text-xs font-medium">{lang === 'ar' ? 'تاريخ' : 'Date'}</span>
        </button>
      </div>

      {/* Date filter (collapsible) */}
      {showDateFilter && (
        <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 font-medium">{lang === 'ar' ? 'من تاريخ' : 'From'}</label>
            <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 font-medium">{lang === 'ar' ? 'إلى تاريخ' : 'To'}</label>
            <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-9 text-sm" />
          </div>
          {(fromDate || toDate) && (
            <button
              onClick={() => { setFromDate(''); setToDate(''); }}
              className="col-span-2 text-xs text-red-600 hover:underline mt-1"
            >
              {lang === 'ar' ? 'مسح فلتر التاريخ' : 'Clear date filter'}
            </button>
          )}
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
            <SelectItem value="TRANSFER">{t('transfer')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger><SelectValue placeholder={t('category')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('all')}</SelectItem>
            {categories.map(c => (
              <SelectItem key={c.id} value={c.id}>
                {lang === 'ar' ? c.nameAr : c.nameEn}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Quick summary: Today / This week / This month */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="p-2.5 bg-slate-50 dark:bg-slate-800/50 text-center">
          <p className="text-[10px] text-slate-500 font-medium">{lang === 'ar' ? 'اليوم' : 'Today'}</p>
          <p className="text-xs font-bold text-red-600 dark:text-red-400 truncate">{compactNumber(quickSummary.todayExp, lang)}</p>
          <p className="text-[10px] text-emerald-600">{compactNumber(quickSummary.todayInc, lang)}+</p>
        </Card>
        <Card className="p-2.5 bg-slate-50 dark:bg-slate-800/50 text-center">
          <p className="text-[10px] text-slate-500 font-medium">{lang === 'ar' ? 'الأسبوع' : 'Week'}</p>
          <p className="text-xs font-bold text-red-600 dark:text-red-400 truncate">{compactNumber(quickSummary.weekExp, lang)}</p>
          <p className="text-[10px] text-emerald-600">{compactNumber(quickSummary.weekInc, lang)}+</p>
        </Card>
        <Card className="p-2.5 bg-slate-50 dark:bg-slate-800/50 text-center">
          <p className="text-[10px] text-slate-500 font-medium">{lang === 'ar' ? 'الشهر' : 'Month'}</p>
          <p className="text-xs font-bold text-red-600 dark:text-red-400 truncate">{compactNumber(quickSummary.monthExp, lang)}</p>
          <p className="text-[10px] text-emerald-600">{compactNumber(quickSummary.monthInc, lang)}+</p>
        </Card>
      </div>

      {/* Monthly summary card */}
      {(() => {
        const totalInc = filtered.filter(t => t.type === 'INCOME').reduce((s, t) => s + convert(t.amount, t.currency as Currency, baseCurrency as Currency), 0);
        const totalExp = filtered.filter(t => t.type === 'EXPENSE').reduce((s, t) => s + convert(t.amount, t.currency as Currency, baseCurrency as Currency), 0);
        const net = totalInc - totalExp;
        return (
          <div className="grid grid-cols-3 gap-2">
            <Card className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-center">
              <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">{t('income')}</p>
              <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300 truncate">{fmt(totalInc, baseCurrency)}</p>
            </Card>
            <Card className="p-3 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-center">
              <p className="text-[10px] font-semibold text-red-700 dark:text-red-400">{t('expense')}</p>
              <p className="text-sm font-bold text-red-700 dark:text-red-300 truncate">{fmt(totalExp, baseCurrency)}</p>
            </Card>
            <Card className="p-3 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900 text-center">
              <p className="text-[10px] font-semibold text-blue-700 dark:text-blue-400">{lang === 'ar' ? 'الصافي' : 'Net'}</p>
              <p className={cn("text-sm font-bold truncate", net >= 0 ? "text-blue-700 dark:text-blue-300" : "text-red-700 dark:text-red-300")}>{fmt(net, baseCurrency)}</p>
            </Card>
          </div>
        );
      })()}

      {/* List */}
      {grouped.length === 0 ? (
        <Card className="p-8 text-center text-slate-500">
          <Filter className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">{t('noTransactionsYet')}</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([day, txs]) => {
            const totalExp = txs.filter(t => t.type === 'EXPENSE').reduce((s, t) => s + t.amount, 0);
            const totalInc = txs.filter(t => t.type === 'INCOME').reduce((s, t) => s + t.amount, 0);
            return (
              <div key={day}>
                <div className="flex justify-between items-baseline mb-1.5 px-1">
                  <h3 className="text-xs font-semibold text-slate-500">{formatDate(day)}</h3>
                  <p className="text-xs text-slate-400">
                    {totalInc > 0 && <span className="text-emerald-600">+{fmt(totalInc, baseCurrency)}</span>}
                    {totalInc > 0 && totalExp > 0 && ' / '}
                    {totalExp > 0 && <span className="text-red-600">-{fmt(totalExp, baseCurrency)}</span>}
                  </p>
                </div>
                <Card className="divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                  {txs.map(tx => {
                    const Icon = getIcon(tx.category.icon);
                    const isIncome = tx.type === 'INCOME';
                    const isTransfer = tx.type === 'TRANSFER';
                    const transferLabel = isTransfer && tx.toAccount
                      ? `${tx.account.name} → ${tx.toAccount.name}`
                      : tx.account.name;
                    return (
                      <div key={tx.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                        <button
                          onClick={() => onEditTx(tx)}
                          className="flex items-center gap-3 flex-1 min-w-0 text-start"
                        >
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0" style={{ background: isTransfer ? '#64748B' : tx.category.color }}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                              {isTransfer
                                ? (lang === 'ar' ? 'تحويل' : 'Transfer')
                                : (lang === 'ar' ? tx.category.nameAr : tx.category.nameEn)}
                            </p>
                            <p className="text-xs text-slate-400 truncate">
                              {transferLabel}{tx.note ? ` • ${tx.note}` : ''}
                            </p>
                          </div>
                          <div className={cn(
                            'font-semibold text-sm shrink-0',
                            isIncome
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : isTransfer
                                ? 'text-slate-600 dark:text-slate-300'
                                : 'text-red-600 dark:text-red-400'
                          )}>
                            {isIncome ? '+' : isTransfer ? '⇄ ' : '-'}{fmt(tx.amount, tx.currency)}
                          </div>
                        </button>
                        <button
                          onClick={() => handleDelete(tx)}
                          className="text-slate-400 hover:text-red-500 p-1 transition shrink-0"
                          aria-label={t('delete')}
                        >
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
