'use client';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useT } from '@/hooks/use-t';
import { useSettings } from '@/lib/store';
import { api } from '@/lib/api';
import { formatMoney, convert, CURRENCY_SYMBOLS, type Currency } from '@/lib/currency';
import { DynamicIcon } from '@/lib/icons';
import { ArrowLeftRight, Loader2, Check, ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Account {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: number;
  color: string;
  icon: string;
  isDefault?: boolean;
}

export function TransferModal({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: () => void;
}) {
  const { t, lang } = useT();
  const baseCurrency = useSettings(s => s.baseCurrency);

  const [amount, setAmount] = useState('');
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      api<{ data: Account[] }>('/api/accounts').then(a => {
        setAccounts(a.data);
        const def = a.data.find(x => x.isDefault) || a.data[0];
        setFromAccountId(def?.id || '');
        setToAccountId(a.data.find(x => x.id !== def?.id)?.id || '');
      });
      setDate(new Date().toISOString().slice(0, 10));
      setAmount('');
      setNote('');
      setError(null);
    }
  }, [open]);

  const fromAccount = accounts.find(a => a.id === fromAccountId);
  const toAccount = accounts.find(a => a.id === toAccountId);

  // Currency conversion preview
  const convertedAmount = (() => {
    const amt = parseFloat(amount);
    if (!amt || !fromAccount || !toAccount) return null;
    if (fromAccount.currency === toAccount.currency) return amt;
    return convert(amt, fromAccount.currency as Currency, toAccount.currency as Currency);
  })();

  const handleSwap = () => {
    const tmp = fromAccountId;
    setFromAccountId(toAccountId);
    setToAccountId(tmp);
  };

  const handleSave = async () => {
    setError(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setError(t('amount') + ' ' + t('required'));
      return;
    }
    if (!fromAccountId || !toAccountId) {
      setError(t('required'));
      return;
    }
    if (fromAccountId === toAccountId) {
      setError(lang === 'ar' ? 'لازم الحسابين يكونوا مختلفين' : 'Accounts must be different');
      return;
    }

    setLoading(true);
    try {
      await api('/api/transfer', {
        method: 'POST',
        body: JSON.stringify({
          fromAccountId,
          toAccountId,
          amount: amt,
          currency: fromAccount?.currency || baseCurrency,
          date: new Date(date).toISOString(),
          note: note || null,
        }),
      });
      toast.success(lang === 'ar' ? 'تم التحويل بنجاح' : 'Transfer successful');
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
          <DialogTitle className="text-center flex items-center justify-center gap-2">
            <ArrowLeftRight className="w-5 h-5 text-blue-600" />
            {lang === 'ar' ? 'تحويل بين الحسابات' : 'Transfer Between Accounts'}
          </DialogTitle>
        </DialogHeader>

        {/* From account */}
        <div className="space-y-1.5">
          <Label>{lang === 'ar' ? 'من حساب' : 'From Account'}</Label>
          <Select value={fromAccountId} onValueChange={setFromAccountId}>
            <SelectTrigger className="w-full h-12">
              <SelectValue placeholder={t('selectAccount')} />
            </SelectTrigger>
            <SelectContent>
              {accounts.map(a => (
                <SelectItem key={a.id} value={a.id}>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-white"
                      style={{ background: a.color }}
                    >
                      <DynamicIcon name={a.icon} className="w-3 h-3" />
                    </div>
                    <span>{a.name}</span>
                    <span className="text-xs text-slate-400">
                      ({formatMoney(a.balance, a.currency as Currency, lang)})
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Swap button */}
        <div className="flex justify-center -my-1">
          <button
            onClick={handleSwap}
            className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 flex items-center justify-center hover:bg-blue-200 dark:hover:bg-blue-900 active:scale-95 transition"
            aria-label={lang === 'ar' ? 'تبديل' : 'Swap'}
          >
            <ArrowLeft className="w-4 h-4 rtl:hidden" />
            <ArrowRight className="w-4 h-4 ltr:hidden" />
          </button>
        </div>

        {/* To account */}
        <div className="space-y-1.5">
          <Label>{lang === 'ar' ? 'إلى حساب' : 'To Account'}</Label>
          <Select value={toAccountId} onValueChange={setToAccountId}>
            <SelectTrigger className="w-full h-12">
              <SelectValue placeholder={t('selectAccount')} />
            </SelectTrigger>
            <SelectContent>
              {accounts.map(a => (
                <SelectItem key={a.id} value={a.id}>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-white"
                      style={{ background: a.color }}
                    >
                      <DynamicIcon name={a.icon} className="w-3 h-3" />
                    </div>
                    <span>{a.name}</span>
                    <span className="text-xs text-slate-400">({a.currency})</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Amount */}
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
            <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">
              {fromAccount?.currency || baseCurrency}
            </span>
          </div>
          {/* Conversion preview */}
          {convertedAmount !== null && fromAccount && toAccount && fromAccount.currency !== toAccount.currency && (
            <p className="text-xs text-slate-500 mt-1 text-center">
              {lang === 'ar' ? 'سيصل إلى' : 'Will arrive as'}: {formatMoney(convertedAmount, toAccount.currency as Currency, lang)} ({toAccount.name})
            </p>
          )}
        </div>

        {/* Date */}
        <div className="space-y-1.5">
          <Label>{t('date')}</Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>

        {/* Note */}
        <div className="space-y-1.5">
          <Label>{t('note')} <span className="text-xs text-slate-400">({t('optional')})</span></Label>
          <Textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="..."
            rows={2}
          />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={loading || fromAccountId === toAccountId}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {lang === 'ar' ? 'تحويل' : 'Transfer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
