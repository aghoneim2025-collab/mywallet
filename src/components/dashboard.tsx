'use client';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowUpRight, ArrowDownRight, Wallet, TrendingUp, TrendingDown, Plus, CreditCard } from 'lucide-react';
import { useT } from '@/hooks/use-t';
import { useSettings } from '@/lib/store';
import { api } from '@/lib/api';
import { formatMoney, compactNumber } from '@/lib/currency';
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, PieChart, Pie, Cell,
  BarChart, Bar,
} from 'recharts';
import { cn } from '@/lib/utils';
import { getIcon } from '@/lib/icons';

interface Stat {
  totalExpense: number;
  totalIncome: number;
  balance: number;
  totalAssets: number;
  expenseCount: number;
  incomeCount: number;
  byCategory: { total: number; count: number; category: { id: string; nameAr: string; nameEn: string; color: string; icon: string } }[];
  byDay: { date: string; expense: number; income: number }[];
  month: string;
}

interface TxItem {
  id: string;
  type: string;
  amount: number;
  currency: string;
  date: string;
  note: string | null;
  category: { id: string; nameAr: string; nameEn: string; color: string; icon: string };
  account: { id: string; name: string; color: string; icon: string };
}

export function Dashboard({ onAddExpense, onAddIncome, onEditTx, onOpenAccounts }: {
  onAddExpense: () => void;
  onAddIncome: () => void;
  onEditTx: (tx: TxItem) => void;
  onOpenAccounts: () => void;
}) {
  const { t, lang } = useT();
  const baseCurrency = useSettings(s => s.baseCurrency);
  const [stat, setStat] = useState<Stat | null>(null);
  const [recent, setRecent] = useState<TxItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const month = new Date().toISOString().slice(0, 7);
    try {
      const [s, r] = await Promise.all([
        api<{ data: Stat }>(`/api/stats?month=${month}&baseCurrency=${baseCurrency}`),
        api<{ data: TxItem[] }>(`/api/transactions?limit=10`),
      ]);
      setStat(s.data);
      setRecent(r.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [baseCurrency]);

  if (loading || !stat) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const fmt = (n: number) => formatMoney(n, baseCurrency, lang);

  return (
    <div className="px-4 pt-4 pb-4 space-y-5">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500">{t('welcomeBack')}</p>
          <h1 className="text-xl font-bold">{t('appName')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenAccounts}
            className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center active:scale-95 transition"
            aria-label={t('accounts')}
          >
            <CreditCard className="w-5 h-5" />
          </button>
          <button
            onClick={onAddExpense}
            className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-md active:scale-95 transition"
            aria-label={t('add')}
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Total Balance Card - clickable to open accounts */}
      <button onClick={onOpenAccounts} className="block w-full text-start">
        <Card className="relative overflow-hidden bg-gradient-to-br from-blue-600 to-blue-700 text-white border-0 p-5">
          <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/10" />
          <div className="absolute -left-12 -bottom-12 w-40 h-40 rounded-full bg-white/5" />
          <div className="relative">
            <p className="text-sm text-blue-100">{t('totalBalance')}</p>
            <p className="text-3xl font-bold mt-1 mb-4">{fmt(stat.totalAssets)}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/15 rounded-xl p-3 backdrop-blur-sm text-start">
                <div className="flex items-center gap-1 text-emerald-300 text-xs">
                  <ArrowUpRight className="w-3 h-3" />
                  {t('monthlyIncome')}
                </div>
                <p className="font-bold mt-0.5">{fmt(stat.totalIncome)}</p>
              </div>
              <div className="bg-white/15 rounded-xl p-3 backdrop-blur-sm text-start">
                <div className="flex items-center gap-1 text-red-300 text-xs">
                  <ArrowDownRight className="w-3 h-3" />
                  {t('monthlyExpenses')}
                </div>
                <p className="font-bold mt-0.5">{fmt(stat.totalExpense)}</p>
              </div>
            </div>
          </div>
        </Card>
      </button>

      {/* Daily trend chart */}
      <section>
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
          {t('dailyTrend')} - {stat.month}
        </h2>
        <Card className="p-3">
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={stat.byDay}>
              <defs>
                <linearGradient id="g-e" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#EF4444" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#EF4444" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="g-i" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: '#94a3b8' }}
                tickFormatter={d => parseInt(d.split('-')[2], 10).toString()}
                interval={4}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                formatter={(v: number) => fmt(v)}
                labelFormatter={l => l}
              />
              <Area type="monotone" dataKey="expense" stroke="#EF4444" strokeWidth={2} fill="url(#g-e)" />
              <Area type="monotone" dataKey="income" stroke="#10B981" strokeWidth={2} fill="url(#g-i)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </section>

      {/* Expenses by Category */}
      <section>
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
          {t('expensesByCategory')}
        </h2>
        {stat.byCategory.length === 0 ? (
          <Card className="p-6 text-center text-slate-400">
            <p className="text-sm">{t('noTransactionsYet')}</p>
          </Card>
        ) : (
          <div className="grid grid-cols-5 gap-2 items-center">
            <div className="col-span-2">
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie
                    data={stat.byCategory}
                    dataKey="total"
                    nameKey="category.nameAr"
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={60}
                    paddingAngle={2}
                  >
                    {stat.byCategory.map((entry, i) => (
                      <Cell key={i} fill={entry.category.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="col-span-3 space-y-1.5">
              {stat.byCategory.slice(0, 5).map((c, i) => {
                const Icon = getIcon(c.category.icon);
                const pct = stat.totalExpense > 0 ? (c.total / stat.totalExpense) * 100 : 0;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white shrink-0"
                      style={{ background: c.category.color }}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline">
                        <span className="text-xs font-medium truncate">
                          {lang === 'ar' ? c.category.nameAr : c.category.nameEn}
                        </span>
                        <span className="text-xs text-slate-500">{pct.toFixed(0)}%</span>
                      </div>
                      <div className="h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.category.color }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Recent transactions */}
      <section>
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('recentTransactions')}</h2>
        </div>

        {recent.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 mx-auto flex items-center justify-center mb-3">
              <Wallet className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-sm text-slate-500 mb-3">{t('noTransactions')}</p>
            <button
              onClick={onAddExpense}
              className="text-sm text-blue-600 dark:text-blue-400 font-medium"
            >
              {t('addFirstTransaction')}
            </button>
          </Card>
        ) : (
          <div className="space-y-2">
            {recent.map(tx => {
              const Icon = getIcon(tx.category.icon);
              const isIncome = tx.type === 'INCOME';
              return (
                <button
                  key={tx.id}
                  onClick={() => onEditTx(tx)}
                  className="w-full flex items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-start active:bg-slate-50 dark:active:bg-slate-800 transition"
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0"
                    style={{ background: tx.category.color }}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {lang === 'ar' ? tx.category.nameAr : tx.category.nameEn}
                    </p>
                    <p className="text-xs text-slate-400">
                      {new Date(tx.date).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' })}
                      {tx.note ? ` • ${tx.note}` : ''}
                    </p>
                  </div>
                  <div className={cn('font-semibold text-sm shrink-0', isIncome ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                    {isIncome ? '+' : '-'}{formatMoney(tx.amount, tx.currency as any, lang)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
