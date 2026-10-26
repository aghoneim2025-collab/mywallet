'use client';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, TrendingUp, TrendingDown, Wallet, FileText, ArrowRight } from 'lucide-react';
import { useT } from '@/hooks/use-t';
import { useSettings } from '@/lib/store';
import { api, downloadFile } from '@/lib/api';
import { formatMoney, convert, compactNumber, type Currency } from '@/lib/currency';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  const [viewMode, setViewMode] = useState<'monthly' | 'yearly'>('monthly');
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [yearlyData, setYearlyData] = useState<{ month: string; income: number; expense: number; balance: number }[] | null>(null);
  const [detailCategoryId, setDetailCategoryId] = useState<string | null>(null);
  const [lastMonthStat, setLastMonthStat] = useState<Stat | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      if (viewMode === 'monthly') {
        const [s, lastM] = await Promise.all([
          api<{ data: Stat }>(`/api/stats?month=${month}&baseCurrency=${baseCurrency}`),
          // Fetch last month for comparison
          (async () => {
            const lastMonthDate = new Date(month + '-01');
            lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
            const lastMonthStr = lastMonthDate.toISOString().slice(0, 7);
            try {
              const r = await api<{ data: Stat }>(`/api/stats?month=${lastMonthStr}&baseCurrency=${baseCurrency}`);
              return r.data;
            } catch { return null; }
          })(),
        ]);
        setStat(s.data);
        setLastMonthStat(lastM);
      } else {
        // Yearly: fetch 12 months stats in parallel
        const months: { month: string; income: number; expense: number; balance: number }[] = [];
        const promises: Promise<{ month: string; income: number; expense: number; balance: number }>[] = [];
        for (let m = 1; m <= 12; m++) {
          const mStr = `${year}-${String(m).padStart(2, '0')}`;
          promises.push(
            api<{ data: Stat }>(`/api/stats?month=${mStr}&baseCurrency=${baseCurrency}`)
              .then(s => ({
                month: mStr,
                income: s.data.totalIncome,
                expense: s.data.totalExpense,
                balance: s.data.balance,
              }))
              .catch(() => ({ month: mStr, income: 0, expense: 0, balance: 0 }))
          );
        }
        const results = await Promise.all(promises);
        setYearlyData(results);
        // Also set stat to yearly totals
        const totalIncome = results.reduce((s, r) => s + r.income, 0);
        const totalExpense = results.reduce((s, r) => s + r.expense, 0);
        setStat({
          totalIncome,
          totalExpense,
          balance: totalIncome - totalExpense,
          totalAssets: 0,
          baseCurrency,
          expenseCount: 0,
          incomeCount: 0,
          byCategory: [],
          byDay: [],
          month: year,
        } as Stat);
      }
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (viewMode === 'monthly') {
      load();
    } else {
      load();
    }
  }, [month, baseCurrency, viewMode, year]);

  const fmt = (n: number) => formatMoney(n, baseCurrency, lang);

  const handleExportCSV = async () => {
    try {
      await downloadFile(`/api/excel?action=export&month=${month}`, `mywallet-${month}.xlsx`);
      toast.success(lang === 'ar' ? 'تم تصدير Excel' : 'Excel exported');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // #6: PDF Export
  const handleExportPDF = async () => {
    try {
      if (!stat) {
        toast.error(lang === 'ar' ? 'لا توجد بيانات للتصدير' : 'No data to export');
        return;
      }
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF();

      // Title
      doc.setFontSize(20);
      doc.text(`MyWallet Report - ${month}`, 14, 20);
      doc.setFontSize(12);
      doc.text(`Base Currency: ${baseCurrency}`, 14, 30);

      // Summary
      doc.text(`Income:    ${fmt(stat.totalIncome)}`, 14, 45);
      doc.text(`Expense:   ${fmt(stat.totalExpense)}`, 14, 52);
      doc.text(`Balance:   ${fmt(stat.balance)}`, 14, 59);

      // Categories table
      autoTable(doc, {
        startY: 70,
        head: [['Category', 'Count', 'Amount', '%']],
        body: sortedCategories.map(c => [
          lang === 'ar' ? c.category.nameAr : c.category.nameEn,
          String(c.count),
          fmt(c.total),
          ((c.total / stat.totalExpense) * 100).toFixed(1) + '%',
        ]),
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235] },
      });

      doc.save(`mywallet-report-${month}.pdf`);
      toast.success(lang === 'ar' ? 'تم تصدير PDF' : 'PDF exported');
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
      <header className="flex justify-between items-center gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t('reports')}</h1>
          <p className="text-xs text-slate-500">{viewMode === 'monthly' ? month : year}</p>
        </div>
        <div className="flex gap-1">
          {/* Toggle monthly/yearly */}
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
            <button
              onClick={() => setViewMode('monthly')}
              className={cn(
                'px-2 py-1 rounded text-xs font-medium transition',
                viewMode === 'monthly'
                  ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm'
                  : 'text-slate-500'
              )}
            >
              {lang === 'ar' ? 'شهري' : 'Monthly'}
            </button>
            <button
              onClick={() => setViewMode('yearly')}
              className={cn(
                'px-2 py-1 rounded text-xs font-medium transition',
                viewMode === 'yearly'
                  ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm'
                  : 'text-slate-500'
              )}
            >
              {lang === 'ar' ? 'سنوي' : 'Yearly'}
            </button>
          </div>
        </div>
      </header>

      {/* Date selector (month or year) */}
      <div>
        {viewMode === 'monthly' ? (
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-sm w-full"
          />
        ) : (
          <select
            value={year}
            onChange={e => setYear(e.target.value)}
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-sm w-full"
          >
            {Array.from({ length: 15 }, (_, i) => (new Date().getFullYear() - 7 + i).toString()).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        )}
      </div>

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

      {/* Yearly chart - shows when viewMode = yearly */}
      {viewMode === 'yearly' && yearlyData && (
        <section>
          <h2 className="text-sm font-semibold mb-2">
            {lang === 'ar' ? 'الدخل مقابل المصروفات شهرياً' : 'Monthly Income vs Expenses'}
          </h2>
          <Card className="p-3">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={yearlyData.map(d => ({
                  month: d.month.split('-')[1],
                  income: d.income,
                  expense: d.expense,
                }))}
              >
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={40} />
                <Tooltip
                  formatter={(v: number) => fmt(v)}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Bar dataKey="income" name={t('income')} fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Bar dataKey="expense" name={t('expense')} fill="#EF4444" radius={[4, 4, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Monthly breakdown table */}
          <Card className="p-3 mt-2">
            <div className="grid grid-cols-4 gap-2 text-[10px] font-semibold text-slate-500 mb-2">
              <span>{lang === 'ar' ? 'الشهر' : 'Month'}</span>
              <span className="text-end text-emerald-600">{lang === 'ar' ? 'دخل' : 'Income'}</span>
              <span className="text-end text-red-600">{lang === 'ar' ? 'مصروف' : 'Expense'}</span>
              <span className="text-end text-blue-600">{lang === 'ar' ? 'صافي' : 'Net'}</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {yearlyData.map(d => (
                <div key={d.month} className="grid grid-cols-4 gap-2 py-1.5 text-xs">
                  <span className="text-slate-700 dark:text-slate-300">{d.month}</span>
                  <span className="text-end text-emerald-600 dark:text-emerald-400">{fmt(d.income)}</span>
                  <span className="text-end text-red-600 dark:text-red-400">{fmt(d.expense)}</span>
                  <span className={cn('text-end font-semibold', d.balance >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400')}>{fmt(d.balance)}</span>
                </div>
              ))}
            </div>
          </Card>
        </section>
      )}

      {/* #5: Monthly comparison - this month vs last month */}
      {viewMode === 'monthly' && lastMonthStat && (
        <section>
          <h2 className="text-sm font-semibold mb-2">
            {lang === 'ar' ? 'مقارنة بالشهر الماضي' : 'vs Last Month'}
          </h2>
          <Card className="p-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              {/* Income comparison */}
              <div>
                <p className="text-[10px] text-slate-500">{t('income')}</p>
                <p className="text-xs font-bold text-emerald-600">{fmt(stat.totalIncome)}</p>
                {(() => {
                  const diff = stat.totalIncome - lastMonthStat.totalIncome;
                  const pct = lastMonthStat.totalIncome > 0 ? (diff / lastMonthStat.totalIncome) * 100 : 0;
                  return (
                    <p className={cn('text-[10px] font-medium', diff >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                      {diff >= 0 ? '↑' : '↓'} {Math.abs(pct).toFixed(0)}%
                    </p>
                  );
                })()}
              </div>
              {/* Expense comparison */}
              <div>
                <p className="text-[10px] text-slate-500">{t('expense')}</p>
                <p className="text-xs font-bold text-red-600">{fmt(stat.totalExpense)}</p>
                {(() => {
                  const diff = stat.totalExpense - lastMonthStat.totalExpense;
                  const pct = lastMonthStat.totalExpense > 0 ? (diff / lastMonthStat.totalExpense) * 100 : 0;
                  return (
                    <p className={cn('text-[10px] font-medium', diff <= 0 ? 'text-emerald-600' : 'text-red-600')}>
                      {diff <= 0 ? '↓' : '↑'} {Math.abs(pct).toFixed(0)}%
                    </p>
                  );
                })()}
              </div>
              {/* Balance comparison */}
              <div>
                <p className="text-[10px] text-slate-500">{lang === 'ar' ? 'الصافي' : 'Net'}</p>
                <p className={cn('text-xs font-bold', stat.balance >= 0 ? 'text-blue-600' : 'text-red-600')}>{fmt(stat.balance)}</p>
                {(() => {
                  const diff = stat.balance - lastMonthStat.balance;
                  const pct = lastMonthStat.balance !== 0 ? (diff / Math.abs(lastMonthStat.balance)) * 100 : 0;
                  return (
                    <p className={cn('text-[10px] font-medium', diff >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                      {diff >= 0 ? '↑' : '↓'} {Math.abs(pct).toFixed(0)}%
                    </p>
                  );
                })()}
              </div>
            </div>
          </Card>
        </section>
      )}

      {/* Daily trend bar chart - only in monthly mode */}
      {viewMode === 'monthly' && (
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
      )}

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
                <Card key={i} className="p-3 cursor-pointer hover:shadow-md transition" onClick={() => setDetailCategoryId(c.category.id)}>
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
      <section className="grid grid-cols-2 gap-2">
        <Button
          onClick={handleExportCSV}
          variant="outline"
          className="h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100"
        >
          <Download className="w-5 h-5" /> Excel
        </Button>
        <Button
          onClick={handleExportPDF}
          variant="outline"
          className="h-12 rounded-xl bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 hover:bg-red-100"
        >
          <FileText className="w-5 h-5" /> PDF
        </Button>
      </section>

      {/* Category Detail Modal */}
      {detailCategoryId && (
        <CategoryDetailModal
          categoryId={detailCategoryId}
          month={month}
          onClose={() => setDetailCategoryId(null)}
        />
      )}
    </div>
  );
}

/** #4: Category Detail Modal - shows all transactions for a category in a given month */
function CategoryDetailModal({
  categoryId, month, onClose,
}: {
  categoryId: string;
  month: string;
  onClose: () => void;
}) {
  const { t, lang } = useT();
  const baseCurrency = useSettings(s => s.baseCurrency);
  const [txs, setTxs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const start = `${month}-01`;
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    api<{ data: any[] }>(`/api/transactions?categoryId=${categoryId}&from=${start}&to=${end.toISOString()}&limit=500`)
      .then(r => setTxs(r.data))
      .finally(() => setLoading(false));
  }, [categoryId, month]);

  const fmt = (n: number, cur: any = baseCurrency) => formatMoney(n, cur, lang);
  const total = txs.reduce((s, t) => s + convert(t.amount, t.currency as Currency, baseCurrency), 0);

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {txs[0] ? (lang === 'ar' ? txs[0].category.nameAr : txs[0].category.nameEn) : (lang === 'ar' ? 'تفاصيل الفئة' : 'Category Details')}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <Card className="p-4 bg-blue-600 text-white border-0">
              <p className="text-xs text-blue-100">{lang === 'ar' ? 'إجمالي الإنفاق' : 'Total Spending'}</p>
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
