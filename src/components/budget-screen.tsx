'use client';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, AlertTriangle, Check, PiggyBank } from 'lucide-react';
import { useT } from '@/hooks/use-t';
import { useSettings } from '@/lib/store';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { getIcon } from '@/lib/icons';
import { toast } from 'sonner';

interface BudgetItem {
  id: string;
  categoryId: string;
  month: string;
  limit: number;
  currency: string;
  spent: number;
  category: { id: string; nameAr: string; nameEn: string; color: string; icon: string };
}
interface Category { id: string; nameAr: string; nameEn: string; type: string; color: string; icon: string; }

export function BudgetScreen() {
  const { t, lang } = useT();
  const baseCurrency = useSettings(s => s.baseCurrency);
  const [budgets, setBudgets] = useState<BudgetItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [modal, setModal] = useState<{ open: boolean; catId?: string; limit?: string }>({ open: false });

  const fmt = (n: number) => formatMoney(n, baseCurrency, lang);

  const load = async () => {
    setLoading(true);
    try {
      const [b, c] = await Promise.all([
        api<{ data: BudgetItem[] }>(`/api/budgets?month=${month}`),
        api<{ data: Category[] }>('/api/categories?type=EXPENSE'),
      ]);
      setBudgets(b.data);
      setCategories(c.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month]);

  const totalLimit = budgets.reduce((s, b) => s + b.limit, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.spent, 0);
  const totalRemaining = totalLimit - totalSpent;
  const totalPct = totalLimit > 0 ? (totalSpent / totalLimit) * 100 : 0;

  const handleSave = async () => {
    const limit = parseFloat(modal.limit || '');
    if (!modal.catId || !limit || limit <= 0) {
      toast.error(lang === 'ar' ? 'أدخل الحد' : 'Enter limit');
      return;
    }
    try {
      await api('/api/budgets', {
        method: 'POST',
        body: JSON.stringify({ categoryId: modal.catId, month, limit, currency: baseCurrency }),
      });
      toast.success(lang === 'ar' ? 'تم الحفظ' : 'Saved');
      setModal({ open: false });
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(lang === 'ar' ? 'حذف الميزانية؟' : 'Delete budget?')) return;
    try {
      await api(`/api/budgets?id=${id}`, { method: 'DELETE' });
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="p-4 space-y-5">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t('monthlyBudget')}</h1>
          <p className="text-sm text-slate-500">{month}</p>
        </div>
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-sm"
        />
      </header>

      {/* Summary card */}
      <Card className="p-5 bg-gradient-to-br from-emerald-500 to-emerald-600 text-white border-0">
        <div className="flex justify-between items-start mb-2">
          <div>
            <p className="text-emerald-100 text-sm">{t('spent')}</p>
            <p className="text-2xl font-bold">{fmt(totalSpent)}</p>
          </div>
          <div className="text-end">
            <p className="text-emerald-100 text-sm">{t('budgetLimit')}</p>
            <p className="text-lg font-semibold">{fmt(totalLimit)}</p>
          </div>
        </div>
        <div className="h-2 bg-white/20 rounded-full overflow-hidden my-2">
          <div
            className={cn('h-full rounded-full transition-all', totalPct >= 100 ? 'bg-red-300' : 'bg-white')}
            style={{ width: `${Math.min(totalPct, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-emerald-100">{totalPct.toFixed(0)}% {t('ofBudget')}</span>
          <span className={cn('font-semibold', totalRemaining < 0 ? 'text-red-200' : 'text-white')}>
            {totalRemaining >= 0 ? `${t('remaining')}: ${fmt(totalRemaining)}` : `${t('overBudget')}: ${fmt(-totalRemaining)}`}
          </span>
        </div>
      </Card>

      {/* Categories list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : budgets.length === 0 ? (
        <Card className="p-8 text-center">
          <PiggyBank className="w-10 h-10 mx-auto text-slate-300 mb-2" />
          <p className="text-sm text-slate-500 mb-4">{t('noBudgets')}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {budgets.map(b => {
            const pct = b.limit > 0 ? (b.spent / b.limit) * 100 : 0;
            const remaining = b.limit - b.spent;
            const over = remaining < 0;
            const Icon = getIcon(b.category.icon);
            return (
              <Card key={b.id} className="p-3.5">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0" style={{ background: b.category.color }}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{lang === 'ar' ? b.category.nameAr : b.category.nameEn}</p>
                    <p className="text-xs text-slate-400">
                      {fmt(b.spent)} / {fmt(b.limit)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(b.id)}
                    className="text-slate-400 hover:text-red-500 text-xs"
                  >
                    {t('delete')}
                  </button>
                </div>
                <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      over ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
                    )}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1.5">
                  <span className="text-xs text-slate-500">{pct.toFixed(0)}%</span>
                  <span className={cn('text-xs font-medium', over ? 'text-red-600' : 'text-slate-600 dark:text-slate-300')}>
                    {over ? `${t('overBudget')} ${fmt(-remaining)}` : `${t('remaining')} ${fmt(remaining)}`}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add budget button */}
      <Button
        onClick={() => setModal({ open: true })}
        className="w-full h-12 rounded-xl text-base"
        size="lg"
      >
        <Plus className="w-5 h-5" /> {t('setBudget')}
      </Button>

      {/* Modal */}
      <Dialog open={modal.open} onOpenChange={o => setModal(m => ({ ...m, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('setBudget')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t('category')}</Label>
              <div className="grid grid-cols-4 gap-2 max-h-44 overflow-y-auto p-1">
                {categories.map(c => {
                  const Icon = getIcon(c.icon);
                  const sel = modal.catId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setModal(m => ({ ...m, catId: c.id }))}
                      className={cn(
                        'flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition',
                        sel ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-transparent bg-slate-50 dark:bg-slate-800'
                      )}
                    >
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white" style={{ background: c.color }}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="text-[10px]">{lang === 'ar' ? c.nameAr : c.nameEn}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('budgetLimit')} ({baseCurrency})</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={modal.limit || ''}
                onChange={e => setModal(m => ({ ...m, limit: e.target.value }))}
                placeholder="0.00"
                className="text-lg h-12"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal({ open: false })}>{t('cancel')}</Button>
            <Button onClick={handleSave}>
              <Check className="w-4 h-4" /> {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
