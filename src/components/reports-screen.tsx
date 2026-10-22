'use client';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, TrendingUp, TrendingDown, Wallet, ChevronRight } from 'lucide-react';
import { useT } from '@/hooks/use-t';
import { useSettings } from '@/lib/store';
import { api, downloadFile } from '@/lib/api';
import { formatMoney, convert, type Currency } from '@/lib/currency';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getIcon } from '@/lib/icons';

interface Stat {
  totalExpense: number;
  totalIncome: number;
  balance: number;
  totalAssets: number;
  baseCurrency: string;
  expenseCount: number;
  incomeCount: number;
  byCategory: { total: number; count: number; category: { id: string; nameAr: string; nameEn: string; color: string; icon: string } }[];
  byDay: { date: string; expense: number; income: number }[];
  month: string;
}

const PIE_COLORS = ['#EF4444', '#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#06B6D4', '#EC4899', '#14B8A6', '#F97316', '#84CC16', '#A855F7', '#0EA5E9'];

export function ReportsScreen() {
  const { t, lang } = useT();
  const baseCurrency = useSettings(s => s.baseCurrency);
  const [stat, setStat] = useState<Stat | null>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  const load = async () => {
    setLoading(true);
    try {
      const s = await api<{ data: Stat }>(`/api/stats?month=${month}&baseCurrency=${baseCurrency}`);
      setStat(s.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month, baseCurrency]);

  const fmt = (n: number) => formatMoney(n, baseCurrency, lang);

  const handleExportCSV = async () => {
    try {
      await downloadFile(`/api/excel?action=export&month=${month}`, `mywallet-${month}.xlsx`);
      toast.success(lang === 'ar' ? 'تم تصدير Excel' : 'Excel exported');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (loading || !stat) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Pie chart data (top 8 categories + "Other")
  const sortedCategories = [...stat.byCategory].sort((a, b) => b.total - a.total);
  const topCategories = sortedCategories.slice(0, 8);
  const otherTotal = sortedCategories.slice(8).reduce((s, c) => s + c.total, 0);
  const pieData = [
    ...topCategories.map(c => ({
      name: lang === 'ar' ? c.category.nameAr : c.category.nameEn,
      value: c.total,
      color: c.category.color,
    })),
    ...(otherTotal > 0 ? [{
      name: lang === 'ar' ? 'أخرى' : 'Other',
      value: otherTotal,
      color: '#64748B',
    }] : []),
  ];

  // Daily bar chart
  const barData = stat.byDay.map(d => ({
    day: parseInt(d.date.split('-')[2], 10),
    expense: d.expense,
    income: d.income,
  }));

  // Savings rate
  const savingsRate = stat.totalIncome > 0
    ? ((stat.totalIncome - stat.totalExpense) / stat.totalIncome) * 100
    : 0;

  return (
    <div className="p-4 space-y-5">
      {/* Header */}
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t('reports')}</h1>
          <p className="text-xs text-slate-500">{month}</p>
        </div>
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-sm"
        />
      </header>

      {/* Summary cards - 3 columns */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
              {t('monthlyIncome')}
            </span>
          </div>
          <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300 truncate">{fmt(stat.totalIncome)}</p>
          <p className="text-[10px] text-emerald-600/70">{stat.incomeCount} {lang === 'ar' ? 'معاملة' : 'txns'}</p>
        </Card>
        <Card className="p-3 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingDown className="w-3.5 h-3.5 text-red-600" />
            <span className="text-[10px] font-semibold text-red-700 dark:text-red-400">
              {t('monthlyExpenses')}
            </span>
          </div>
          <p className="text-sm font-bold text-red-700 dark:text-red-300 truncate">{fmt(stat.totalExpense)}</p>
          <p className="text-[10px] text-red-600/70">{stat.expenseCount} {lang === 'ar' ? 'معاملة' : 'txns'}</p>
        </Card>
        <Card className="p-3 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900">
          <div className="flex items-center gap-1.5 mb-1">
            <Wallet className="w-3.5 h-3.5 text-blue-600" />
            <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-400">
              {lang === 'ar' ? 'الصافي' : 'Net'}
            </span>
          </div>
          <p className={cn(
            "text-sm font-bold truncate",
            stat.balance >= 0 ? "text-blue-700 dark:text-blue-300" : "text-red-700 dark:text-red-300"
          )}>
            {fmt(stat.balance)}
          </p>
          <p className="text-[10px] text-blue-600/70">
            {savingsRate >= 0 ? '+' : ''}{savingsRate.toFixed(1)}% {lang === 'ar' ? 'ادخار' : 'savings'}
          </p>
        </Card>
      </div>

      {/* Daily trend bar chart */}
      <section>
        <h2 className="text-sm font-semibold mb-2">{t('incomeVsExpense')}</h2>
        <Card className="p-3">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData}>
              <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={4} />
              <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={35} />
              <Tooltip
                formatter={(v: number) => fmt(v)}
                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Bar dataKey="income" name={t('income')} fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={20} />
              <Bar dataKey="expense" name={t('expense')} fill="#EF4444" radius={[4, 4, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </section>

      {/* Pie chart with category breakdown */}
      <section>
        <h2 className="text-sm font-semibold mb-2">{lang === 'ar' ? 'توزيع المصروفات' : 'Expense Distribution'}</h2>
        {pieData.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-slate-400">{t('noTransactionsYet')}</p>
          </Card>
        ) : (
          <Card className="p-3">
            <div className="flex items-center gap-3">
              {/* Pie chart on the left */}
              <div className="w-1/3 shrink-0">
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={32}
                      outerRadius={60}
                      paddingAngle={2}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => fmt(v)}
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* Center: Total in the middle of donut */}
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1/3 text-center pointer-events-none">
                <p className="text-[10px] text-slate-400">{lang === 'ar' ? 'الإجمالي' : 'Total'}</p>
                <p className="text-sm font-bold">{fmt(stat.totalExpense)}</p>
              </div>
              {/* Legend on the right */}
              <div className="flex-1 space-y-1.5">
                {pieData.map((entry, i) => {
                  const pct = stat.totalExpense > 0 ? (entry.value / stat.totalExpense) * 100 : 0;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: entry.color }}
                      />
                      <span className="text-[11px] font-medium flex-1 truncate">{entry.name}</span>
                      <span className="text-[10px] text-slate-500">{pct.toFixed(1)}%</span>
                      <span className="text-[11px] font-semibold">{fmt(entry.value)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        )}
      </section>

      {/* Top categories list */}
      <section>
        <h2 className="text-sm font-semibold mb-2">{t('topCategories')}</h2>
        {sortedCategories.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-slate-400">{t('noTransactionsYet')}</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {sortedCategories.slice(0, 10).map((c, i) => {
              const Icon = getIcon(c.category.icon);
              const pct = stat.totalExpense > 0 ? (c.total / stat.totalExpense) * 100 : 0;
              return (
                <Card key={i} className="p-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white shrink-0"
                      style={{ background: c.category.color }}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-1">
                        <span className="text-sm font-medium truncate">
                          {lang === 'ar' ? c.category.nameAr : c.category.nameEn}
                        </span>
                        <span className="text-sm font-semibold shrink-0">{fmt(c.total)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex-1">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, background: c.category.color }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-500 shrink-0">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Export */}
      <section>
        <Button
          onClick={handleExportCSV}
          variant="outline"
          className="w-full h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100"
        >
          <Download className="w-5 h-5" /> {lang === 'ar' ? 'تصدير Excel لهذا الشهر' : 'Export Excel for this month'}
        </Button>
      </section>
    </div>
  );
}
