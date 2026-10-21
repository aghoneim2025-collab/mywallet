'use client';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Pencil, Wallet, Trash2 } from 'lucide-react';
import { useT } from '@/hooks/use-t';
import { useSettings } from '@/lib/store';
import { api } from '@/lib/api';
import { formatMoney, type Currency } from '@/lib/currency';
import { getIcon } from '@/lib/icons';
import { toast } from 'sonner';

interface Account {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: number;
  color: string;
  icon: string;
  isDefault: boolean;
}

const ICONS = ['wallet', 'credit-card', 'landmark', 'smartphone', 'piggy-bank', 'banknote'];
const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];
const TYPES = [
  { value: 'CASH', labelAr: 'نقدي', labelEn: 'Cash' },
  { value: 'BANK', labelAr: 'بنك', labelEn: 'Bank' },
  { value: 'E_WALLET', labelAr: 'محفظة إلكترونية', labelEn: 'E-Wallet' },
  { value: 'CARD', labelAr: 'بطاقة ائتمان', labelEn: 'Credit Card' },
  { value: 'SAVINGS', labelAr: 'حساب توفير', labelEn: 'Savings' },
];

const CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'EGP', label: 'EGP' },
  { value: 'SAR', label: 'SAR' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'AED', label: 'AED' },
];

export function AccountsScreen() {
  const { t, lang } = useT();
  const baseCurrency = useSettings(s => s.baseCurrency);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; data?: Account | null }>({ open: false });

  const fmt = (n: number, cur: string) => formatMoney(n, cur as any, lang);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api<{ data: Account[] }>('/api/accounts');
      setAccounts(r.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);

  const handleSave = async (data: any) => {
    try {
      if (data.id) {
        await api(`/api/accounts/${data.id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        });
        toast.success(lang === 'ar' ? 'تم التعديل' : 'Updated');
      } else {
        await api('/api/accounts', {
          method: 'POST',
          body: JSON.stringify(data),
        });
        toast.success(lang === 'ar' ? 'تم الإضافة' : 'Created');
      }
      setModal({ open: false });
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(lang === 'ar' ? 'حذف الحساب؟' : 'Delete account?')) return;
    try {
      await api(`/api/accounts/${id}`, { method: 'DELETE' });
      toast.success(lang === 'ar' ? 'تم الحذف' : 'Deleted');
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (loading) {
    return <div className="p-4 space-y-3">
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
    </div>;
  }

  return (
    <div className="p-4 space-y-5">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t('accounts')}</h1>
          <p className="text-sm text-slate-500">{accounts.length} {t('accounts')}</p>
        </div>
        <Button onClick={() => setModal({ open: true })} size="sm" className="rounded-full">
          <Plus className="w-4 h-4" /> {t('add')}
        </Button>
      </header>

      {/* Total */}
      <Card className="p-5 bg-gradient-to-br from-blue-600 to-blue-700 text-white border-0">
        <p className="text-sm text-blue-100">{t('totalBalance')}</p>
        <p className="text-3xl font-bold mt-1">{fmt(totalBalance, baseCurrency)}</p>
      </Card>

      {/* Accounts list */}
      <div className="space-y-3">
        {accounts.map(a => {
          const Icon = getIcon(a.icon);
          const type = TYPES.find(t => t.value === a.type);
          return (
            <Card key={a.id} className="p-4 flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white shrink-0" style={{ background: a.color }}>
                <Icon className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm">{a.name}</p>
                  {a.isDefault && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{t('default')}</span>}
                </div>
                <p className="text-xs text-slate-400">{type ? (lang === 'ar' ? type.labelAr : type.labelEn) : a.type} • {a.currency}</p>
              </div>
              <div className="text-end shrink-0">
                <p className="font-bold text-sm">{fmt(a.balance, a.currency)}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => setModal({ open: true, data: a })} className="p-1.5 text-slate-400 hover:text-blue-600">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => handleDelete(a.id)} className="p-1.5 text-slate-400 hover:text-red-500">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      <AccountModal
        key={modal.data?.id || 'new'}
        open={modal.open}
        onOpenChange={o => setModal(m => ({ ...m, open: o }))}
        initial={modal.data}
        onSave={handleSave}
      />
    </div>
  );
}

function AccountModal({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: Account | null;
  onSave: (data: any) => void;
}) {
  const { t, lang } = useT();
  // initialized once per mount (component remounts via key when `initial` changes)
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState(initial?.type || 'CASH');
  const [currency, setCurrency] = useState<Currency>(initial ? (initial.currency as Currency) : 'EGP');
  const [balance, setBalance] = useState(initial ? initial.balance.toString() : '');
  const [color, setColor] = useState(initial?.color || COLORS[0]);
  const [icon, setIcon] = useState(initial?.icon || ICONS[0]);
  const [isDefault, setIsDefault] = useState(initial?.isDefault || false);

  const submit = () => {
    if (!name || !type || !currency) return;
    onSave({
      id: initial?.id,
      name, type, currency,
      balance: parseFloat(balance) || 0,
      color, icon, isDefault,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? t('editAccount') : t('addAccount')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <Label>{t('account')}</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="..." />
          </div>
          <div className="space-y-1.5">
            <Label>{t('type')}</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPES.map(t => <SelectItem key={t.value} value={t.value}>{lang === 'ar' ? t.labelAr : t.labelEn}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>{t('currency')}</Label>
              <Select value={currency} onValueChange={(v: any) => setCurrency(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('balance')}</Label>
              <Input type="number" inputMode="decimal" value={balance} onChange={e => setBalance(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-8 h-8 rounded-full border-2 transition"
                  style={{ background: c, borderColor: color === c ? '#1e293b' : 'transparent', outline: color === c ? `2px solid ${c}` : 'none' }}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Icon</Label>
            <div className="flex gap-2 flex-wrap">
              {ICONS.map(i => {
                const I = getIcon(i);
                return (
                  <button
                    key={i}
                    onClick={() => setIcon(i)}
                    className="w-9 h-9 rounded-lg flex items-center justify-center border-2 transition"
                    style={{ borderColor: icon === i ? color : 'transparent', background: icon === i ? `${color}20` : 'transparent', color }}
                  >
                    <I className="w-4 h-4" />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
            <Label htmlFor="default-toggle" className="cursor-pointer">{t('makeDefault')}</Label>
            <Switch id="default-toggle" checked={isDefault} onCheckedChange={setIsDefault} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button onClick={submit}>{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
