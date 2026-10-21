'use client';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, FileText } from 'lucide-react';
import { useT } from '@/hooks/use-t';
import { useSettings } from '@/lib/store';
import { api, downloadFile } from '@/lib/api';
import { formatMoney } from '@/lib/currency';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { toast } from 'sonner';

interface Stat {
  totalExpense: number;
  totalIncome: number;
  balance: number;
  byCategory: { total: number; count: number; category: { id: string; nameAr: string; nameEn: string; color: string; icon: string } }[];
  byDay: { date: string; expense: number; income: number }[];
  month: string;
}

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
      await downloadFile(`/api/export?format=csv&month=${month}`, `transactions-${month}.csv`);
      toast.success(lang === 'ar' ? 'تم التصدير' : 'Exported');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (loading || !stat) {
    return <div className="p-4 space-y-3">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>;
  }

  const pieData = stat.byCategory.slice(0, 6).map(c => ({
    name: lang === 'ar' ? c.category.nameAr : c.category.nameEn,
    value: c.total,
    color: c.category.color,
  }));

  const barData = stat.byDay.map(d => ({
    day: parseInt(d.date.split('-')[2], 10),
    expense: d.expense,
    income: d.income,
  }));

  const savingsRate = stat.totalIncome > 0
    ? ((stat.totalIncome - stat.totalExpense) / stat.totalIncome) * 100
    : 0;

  return (
    <div className="p-4 space-y-5">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t('reports')}</h1>
          <p className="text-sm text-slate-500">{month}</p>
        </div>
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-sm"
        />
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900">
          <p className="text-xs text-emerald-700 dark:text-emerald-400">{t('monthlyIncome')}</p>
          <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300 mt-1">{fmt(stat.totalIncome)}</p>
        </Card>
        <Card className="p-4 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900">
          <p className="text-xs text-red-700 dark:text-red-400">{t('monthlyExpenses')}</p>
          <p className="text-lg font-bold text-red-700 dark:text-red-300 mt-1">{fmt(stat.totalExpense)}</p>
        </Card>
        <Card className="p-4 col-span-2 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900">
          <div className="flex justify-between items-baseline">
            <div>
              <p className="text-xs text-blue-700 dark:text-blue-400">{t('monthlyBalance')}</p>
              <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-1">{fmt(stat.balance)}</p>
            </div>
            <div className="text-end">
              <p className="text-xs text-blue-700 dark:text-blue-400">Savings Rate</p>
              <p className="text-lg font-semibold text-blue-700 dark:text-blue-300">
                {savingsRate >= 0 ? '+' : ''}{savingsRate.toFixed(1)}%
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Daily chart */}
      <section>
        <h2 className="text-sm font-semibold mb-2">{t('incomeVsExpense')}</h2>
        <Card className="p-3">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData}>
              <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={30} />
              <Tooltip
                formatter={(v: number) => fmt(v)}
                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="income" name={t('income')} fill="#10B981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" name={t('expense')} fill="#EF4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </section>

      {/* Top categories pie */}
      <section>
        <h2 className="text-sm font-semibold mb-2">{t('topCategories')}</h2>
        <Card className="p-3">
          {pieData.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-10">{t('noTransactionsYet')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </section>

      {/* Export buttons */}
      <section>
        <h2 className="text-sm font-semibold mb-2">{t('exportData')}</h2>
        <div className="grid grid-cols-1 gap-2">
          <Button onClick={handleExportCSV} variant="outline" className="h-12 rounded-xl">
            <Download className="w-5 h-5" /> {t('exportCSV')}
          </Button>
        </div>
      </section>
    </div>
  );
}
