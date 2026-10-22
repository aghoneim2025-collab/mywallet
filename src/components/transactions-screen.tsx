'use client';
import { useEffect, useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Filter, Trash2, Pencil } from 'lucide-react';
import { useT } from '@/hooks/use-t';
import { useSettings } from '@/lib/store';
import { api } from '@/lib/api';
import { formatMoney, convert, type Currency } from '@/lib/currency';
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
  category: { id: string; nameAr: string; nameEn: string; color: string; icon: string; type: string };
  account: { id: string; name: string; color: string; icon: string; currency: string };
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
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'EXPENSE' | 'INCOME'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

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
        const cat = lang === 'ar' ? tx.category.nameAr : tx.category.nameEn;
        if (!cat.includes(search) && !(tx.note || '').includes(search)) return false;
      }
      return true;
    });
  }, [items, search, typeFilter, categoryFilter, lang]);

  // group by day
  const grouped = useMemo(() => {
    const m = new Map<string, TxItem[]>();
    filtered.forEach(tx => {
      const d = new Date(tx.date);
      const key = d.toISOString().slice(0, 10);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(tx);
    });
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

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

      {/* Search */}
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('search')}
          className="ps-9"
        />
      </div>

      {/* Filters */}
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
            {categories.map(c => (
              <SelectItem key={c.id} value={c.id}>
                {lang === 'ar' ? c.nameAr : c.nameEn}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
                    return (
                      <div key={tx.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                        <button
                          onClick={() => onEditTx(tx)}
                          className="flex items-center gap-3 flex-1 min-w-0 text-start"
                        >
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0" style={{ background: tx.category.color }}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                              {lang === 'ar' ? tx.category.nameAr : tx.category.nameEn}
                            </p>
                            <p className="text-xs text-slate-400 truncate">
                              {tx.account.name}{tx.note ? ` • ${tx.note}` : ''}
                            </p>
                          </div>
                          <div className={cn('font-semibold text-sm shrink-0', isIncome ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                            {isIncome ? '+' : '-'}{fmt(tx.amount, tx.currency)}
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
