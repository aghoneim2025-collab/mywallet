'use client';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useT } from '@/hooks/use-t';
import { useSettings } from '@/lib/store';
import { api } from '@/lib/api';
import { formatMoney, type Currency } from '@/lib/currency';
import * as LucideIcons from 'lucide-react';
import { Loader2, Check, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tx = {
  id?: string;
  type: 'EXPENSE' | 'INCOME';
  amount?: number;
  currency?: Currency;
  accountId?: string;
  categoryId?: string;
  date?: string;
  note?: string;
};

interface Category { id: string; nameAr: string; nameEn: string; type: string; icon: string; color: string; }
interface Account { id: string; name: string; type: string; currency: string; balance: number; color: string; icon: string; }

export function TransactionModal({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: Tx | null;
  onSaved?: () => void;
}) {
  const { t, lang } = useT();
  const baseCurrency = useSettings(s => s.baseCurrency);

  const [type, setType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      // load categories + accounts
      Promise.all([
        api<{ data: Category[] }>('/api/categories'),
        api<{ data: Account[] }>('/api/accounts'),
      ]).then(([c, a]) => {
        setCategories(c.data);
        setAccounts(a.data);
        const defaultAcc = a.data.find(x => x.balance === 0) || a.data[0];
        const def = a.data.find(x => (x as any).isDefault) || a.data[0];
        setAccountId(initial?.accountId || def?.id || defaultAcc?.id || '');
      });
    }
  }, [open]);

  useEffect(() => {
    if (initial) {
      setType(initial.type);
      setAmount(initial.amount?.toString() || '');
      setAccountId(initial.accountId || '');
      setCategoryId(initial.categoryId || '');
      setDate(initial.date ? initial.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
      setNote(initial.note || '');
    } else if (open) {
      setType('EXPENSE');
      setAmount('');
      setCategoryId('');
      setDate(new Date().toISOString().slice(0, 10));
      setNote('');
    }
  }, [initial, open]);

  const filteredCategories = categories.filter(c => c.type === type);

  const getIcon = (name: string) => {
    const I = (LucideIcons as any)[name] || LucideIcons.Tag;
    return I;
  };

  const handleSave = async () => {
    setError(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setError(t('amount') + ' ' + t('required'));
      return;
    }
    if (!accountId || !categoryId) {
      setError(t('required'));
      return;
    }

    setLoading(true);
    try {
      const body = {
        type,
        amount: amt,
        currency: baseCurrency,
        accountId,
        categoryId,
        date: new Date(date).toISOString(),
        note: note || null,
      };
      if (initial?.id) {
        await api(`/api/transactions/${initial.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        toast.success(lang === 'ar' ? 'تم تعديل المعاملة' : 'Transaction updated');
      } else {
        await api('/api/transactions', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        toast.success(lang === 'ar' ? 'تمت إضافة المعاملة' : 'Transaction added');
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-center">
            {initial?.id ? t('editTransaction') : type === 'EXPENSE' ? t('addExpense') : t('addIncome')}
          </DialogTitle>
        </DialogHeader>

        {/* type toggle */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
          <button
            onClick={() => setType('EXPENSE')}
            className={cn(
              'flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all',
              type === 'EXPENSE'
                ? 'bg-white dark:bg-slate-900 text-red-600 shadow-sm'
                : 'text-slate-500'
            )}
          >
            <ArrowDown className="w-4 h-4" /> {t('expense')}
          </button>
          <button
            onClick={() => setType('INCOME')}
            className={cn(
              'flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all',
              type === 'INCOME'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 shadow-sm'
                : 'text-slate-500'
            )}
          >
            <ArrowUp className="w-4 h-4" /> {t('income')}
          </button>
        </div>

        {/* amount */}
        <div className="space-y-1.5">
          <Label>{t('amount')}</Label>
          <div className="relative">
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="text-2xl font-bold text-center h-14 pe-12"
              autoFocus
            />
            <span className="absolute end-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium">
              {baseCurrency}
            </span>
          </div>
        </div>

        {/* category */}
        <div className="space-y-1.5">
          <Label>{t('category')}</Label>
          <div className="grid grid-cols-4 gap-2 max-h-44 overflow-y-auto p-1">
            {filteredCategories.map(c => {
              const Icon = getIcon(c.icon);
              const sel = categoryId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(c.id)}
                  className={cn(
                    'flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all',
                    sel ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-transparent bg-slate-50 dark:bg-slate-800'
                  )}
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white"
                    style={{ background: c.color }}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] text-center leading-tight">
                    {lang === 'ar' ? c.nameAr : c.nameEn}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* account */}
        <div className="space-y-1.5">
          <Label>{t('account')}</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="w-full"><SelectValue placeholder={t('selectAccount')} /></SelectTrigger>
            <SelectContent>
              {accounts.map(a => {
                const Icon = getIcon(a.icon);
                return (
                  <SelectItem key={a.id} value={a.id}>
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4" style={{ color: a.color }} />
                      <span>{a.name}</span>
                      <span className="text-xs text-slate-400">({a.currency})</span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* date */}
        <div className="space-y-1.5">
          <Label>{t('date')}</Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>

        {/* note */}
        <div className="space-y-1.5">
          <Label>{t('note')} <span className="text-xs text-slate-400">({t('optional')})</span></Label>
          <Textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="..."
            rows={2}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
