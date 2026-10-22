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
import { Plus, Pencil, Trash2, TrendingUp, TrendingDown, Wallet, Search } from 'lucide-react';
import { useT } from '@/hooks/use-t';
import { useSettings } from '@/lib/store';
import { api } from '@/lib/api';
import { convert, formatMoney, type Currency } from '@/lib/currency';
import { DynamicIcon } from '@/lib/icons';
import { getIcon } from '@/lib/icons';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

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

// Group order and metadata
const ACCOUNT_GROUPS: { type: string; arLabel: string; enLabel: string; icon: string; isAsset: boolean }[] = [
  { type: 'CASH', arLabel: 'كاش', enLabel: 'Cash', icon: 'wallet', isAsset: true },
  { type: 'BANK', arLabel: 'بنوك', enLabel: 'Banks', icon: 'landmark', isAsset: true },
  { type: 'E_WALLET', arLabel: 'محافظ إلكترونية', enLabel: 'E-Wallets', icon: 'smartphone', isAsset: true },
  { type: 'CARD', arLabel: 'بطاقات ائتمان', enLabel: 'Cards', icon: 'credit-card', isAsset: true },
  { type: 'SAVINGS', arLabel: 'حسابات توفير', enLabel: 'Savings', icon: 'piggy-bank', isAsset: true },
  { type: 'INVESTMENT', arLabel: 'استثمارات', enLabel: 'Investments', icon: 'trending-up', isAsset: true },
  { type: 'EXTERNAL', arLabel: 'حسابات خارجية', enLabel: 'External', icon: 'external-link', isAsset: true },
  { type: 'LOAN', arLabel: 'قروض وسلف', enLabel: 'Loans', icon: 'hand-coins', isAsset: false },
];

const ICONS = ['wallet', 'credit-card', 'landmark', 'smartphone', 'piggy-bank', 'banknote',
  'trending-up', 'gem', 'bitcoin', 'diamond', 'home', 'car', 'plane', 'gift',
  'shield', 'briefcase', 'building-2', 'coin', 'dollar-sign', 'euro', 'pound-sterling'];
const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4',
  '#EC4899', '#14B8A6', '#F97316', '#84CC16', '#A855F7', '#0EA5E9'];

const TYPES = [
  { value: 'CASH', labelAr: 'نقدي', labelEn: 'Cash' },
  { value: 'BANK', labelAr: 'بنك', labelEn: 'Bank' },
  { value: 'E_WALLET', labelAr: 'محفظة إلكترونية', labelEn: 'E-Wallet' },
  { value: 'CARD', labelAr: 'بطاقة ائتمان', labelEn: 'Credit Card' },
  { value: 'SAVINGS', labelAr: 'حساب توفير', labelEn: 'Savings' },
  { value: 'INVESTMENT', labelAr: 'استثمار', labelEn: 'Investment' },
  { value: 'LOAN', labelAr: 'قرض/سلفة', labelEn: 'Loan' },
  { value: 'EXTERNAL', labelAr: 'حساب خارجي', labelEn: 'External' },
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
  const [search, setSearch] = useState('');
  const [detailAccountId, setDetailAccountId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api<{ data: Account[] }>('/api/accounts');
      setAccounts(r.data);
    } catch (e: any) {
      toast.error(e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Convert balance to display currency
  const convertToBase = (balance: number, fromCurrency: string) =>
    convert(balance, fromCurrency as Currency, baseCurrency);

  // Filter accounts by search
  const filteredAccounts = accounts.filter(a => {
    if (!search) return true;
    const q = search.toLowerCase();
    return a.name.toLowerCase().includes(q) ||
      a.currency.toLowerCase().includes(q) ||
      a.type.toLowerCase().includes(q);
  });

  // Group accounts
  const groupedAccounts = ACCOUNT_GROUPS.map(group => ({
    ...group,
    accounts: filteredAccounts.filter(a => a.type === group.type),
  })).filter(g => g.accounts.length > 0);

  // Calculate totals
  const totalAssets = accounts
    .filter(a => !['LOAN'].includes(a.type))
    .reduce((s, a) => s + convertToBase(a.balance, a.currency), 0);
  const totalLiabilities = accounts
    .filter(a => a.type === 'LOAN' && a.balance < 0)
    .reduce((s, a) => s + Math.abs(convertToBase(a.balance, a.currency)), 0);
  const net = totalAssets - totalLiabilities;

  const fmt = (n: number, cur: Currency = baseCurrency) => formatMoney(n, cur, lang);

  const handleSave = async (data: any) => {
    try {
      if (data.id) {
        await api(`/api/accounts/${data.id}`, { method: 'PUT', body: JSON.stringify(data) });
        toast.success(lang === 'ar' ? 'تم التعديل' : 'Updated');
      } else {
        await api('/api/accounts', { method: 'POST', body: JSON.stringify(data) });
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
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-32 w-full rounded-2xl" />
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5 pb-4">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t('accounts')}</h1>
          <p className="text-xs text-slate-500">{accounts.length} {t('accounts')}</p>
        </div>
        <Button onClick={() => setModal({ open: true })} size="sm" className="rounded-full bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4" /> {t('add')}
        </Button>
      </header>

      {/* Search box */}
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={lang === 'ar' ? 'بحث بالاسم أو العملة...' : 'Search by name or currency...'}
          className="ps-9"
        />
      </div>

      {/* Summary Card: Assets / Liabilities / Net */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
              {lang === 'ar' ? 'الأصول' : 'Assets'}
            </span>
          </div>
          <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300 truncate">{fmt(totalAssets)}</p>
        </Card>
        <Card className="p-3 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingDown className="w-3.5 h-3.5 text-red-600" />
            <span className="text-[10px] font-semibold text-red-700 dark:text-red-400">
              {lang === 'ar' ? 'الخصوم' : 'Liabilities'}
            </span>
          </div>
          <p className="text-sm font-bold text-red-700 dark:text-red-300 truncate">{fmt(totalLiabilities)}</p>
        </Card>
        <Card className="p-3 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900">
          <div className="flex items-center gap-1.5 mb-1">
            <Wallet className="w-3.5 h-3.5 text-blue-600" />
            <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-400">
              {lang === 'ar' ? 'الصافي' : 'Net'}
            </span>
          </div>
          <p className={cn("text-sm font-bold truncate", net >= 0 ? "text-blue-700 dark:text-blue-300" : "text-red-700 dark:text-red-300")}>
            {fmt(net)}
          </p>
        </Card>
      </div>

      {/* Grouped accounts */}
      {groupedAccounts.map(group => {
        const groupTotal = group.accounts.reduce(
          (s, a) => s + convertToBase(a.balance, a.currency),
          0
        );
        const GroupIcon = getIcon(group.icon);
        return (
          <div key={group.type} className="space-y-2">
            {/* Group header */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-7 h-7 rounded-lg flex items-center justify-center text-white",
                  group.isAsset ? "bg-blue-600" : "bg-red-600"
                )}>
                  <GroupIcon className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold">{lang === 'ar' ? group.arLabel : group.enLabel}</h3>
                <span className="text-xs text-slate-400">({group.accounts.length})</span>
              </div>
              <span className={cn(
                "text-xs font-semibold",
                groupTotal >= 0 ? "text-slate-600 dark:text-slate-300" : "text-red-600 dark:text-red-400"
              )}>
                {fmt(groupTotal)}
              </span>
            </div>

            {/* Accounts in this group */}
            <Card className="divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
              {group.accounts.map(a => {
                const Icon = getIcon(a.icon);
                const isNegative = a.balance < 0;
                return (
                  <div key={a.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                    <button
                      onClick={() => setDetailAccountId(a.id)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-start"
                    >
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
                        style={{ background: a.color }}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-sm truncate">{a.name}</p>
                          {a.isDefault && (
                            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full shrink-0">
                              {t('default')}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">
                          {a.currency} • {TYPES.find(t => t.value === a.type)?.[lang === 'ar' ? 'labelAr' : 'labelEn']}
                        </p>
                      </div>
                    </button>
                    <div className="text-end shrink-0">
                      <p className={cn(
                        "font-bold text-sm",
                        isNegative ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-slate-100"
                      )}>
                        {formatMoney(a.balance, a.currency as Currency, lang)}
                      </p>
                      {a.currency !== baseCurrency && (
                        <p className="text-[10px] text-slate-400">≈ {fmt(convertToBase(a.balance, a.currency))}</p>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setModal({ open: true, data: a }); }}
                      className="p-1.5 text-slate-300 hover:text-blue-600 shrink-0"
                      aria-label={t('edit')}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(a.id)}
                      className="p-1.5 text-slate-300 hover:text-red-500 shrink-0"
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

      {/* Empty state */}
      {accounts.length === 0 && (
        <Card className="p-8 text-center">
          <Wallet className="w-12 h-12 mx-auto text-slate-300 mb-2" />
          <p className="text-sm text-slate-500">
            {lang === 'ar' ? 'لا توجد حسابات بعد. اضغط زر + لإضافة حساب جديد.' : 'No accounts yet. Tap + to add one.'}
          </p>
        </Card>
      )}

      <AccountModal
        key={modal.data?.id || 'new'}
        open={modal.open}
        onOpenChange={o => setModal(m => ({ ...m, open: o }))}
        initial={modal.data}
        onSave={handleSave}
      />

      {/* Account detail dialog */}
      {detailAccountId && (
        <AccountDetailModal
          accountId={detailAccountId}
          onClose={() => setDetailAccountId(null)}
          onEditTx={() => {/* TODO: implement edit from detail */}}
        />
      )}
    </div>
  );
}

/** Account detail view - shows account info + recent transactions */
function AccountDetailModal({
  accountId,
  onClose,
  onEditTx,
}: {
  accountId: string;
  onClose: () => void;
  onEditTx?: (tx: any) => void;
}) {
  const { t, lang } = useT();
  const baseCurrency = useSettings(s => s.baseCurrency);
  const [account, setAccount] = useState<Account | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<{ data: Account[] }>('/api/accounts'),
      api<{ data: any[] }>(`/api/transactions?accountId=${accountId}&limit=200`),
    ]).then(([accs, txs]) => {
      const acc = accs.data.find(a => a.id === accountId) || null;
      setAccount(acc);
      setTransactions(txs.data);
    }).finally(() => setLoading(false));
  }, [accountId]);

  const fmt = (n: number, cur: any = baseCurrency) => formatMoney(n, cur, lang);
  const convertToBase = (balance: number, fromCurrency: string) =>
    convert(balance, fromCurrency as Currency, baseCurrency);

  // Calculate totals for this account
  const totalIncome = transactions
    .filter(t => t.type === 'INCOME')
    .reduce((s, t) => s + convertToBase(t.amount, t.currency), 0);
  const totalExpense = transactions
    .filter(t => t.type === 'EXPENSE')
    .reduce((s, t) => s + convertToBase(t.amount, t.currency), 0);
  const totalTransfers = transactions
    .filter(t => t.type === 'TRANSFER')
    .reduce((s, t) => s + convertToBase(t.amount, t.currency), 0);

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {account && (
              <>
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
                  style={{ background: account.color }}
                >
                  {(() => {
                    const I = getIcon(account.icon);
                    return <I className="w-4 h-4" />;
                  })()}
                </div>
                {account.name}
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center">
            <Skeleton className="h-32 w-full" />
          </div>
        ) : account ? (
          <>
            {/* Account balance */}
            <Card className="p-5 bg-gradient-to-br from-blue-600 to-blue-700 text-white border-0">
              <p className="text-xs text-blue-100">{lang === 'ar' ? 'الرصيد الحالي' : 'Current Balance'}</p>
              <p className="text-3xl font-bold mt-1">
                {formatMoney(account.balance, account.currency as Currency, lang)}
              </p>
              {account.currency !== baseCurrency && (
                <p className="text-xs text-blue-200 mt-1">
                  ≈ {fmt(convertToBase(account.balance, account.currency))}
                </p>
              )}
            </Card>

            {/* Mini summary */}
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-center">
                <p className="text-[10px] text-emerald-700 dark:text-emerald-400">{lang === 'ar' ? 'دخل' : 'Income'}</p>
                <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300 truncate">{fmt(totalIncome)}</p>
              </div>
              <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 text-center">
                <p className="text-[10px] text-red-700 dark:text-red-400">{lang === 'ar' ? 'مصروف' : 'Expense'}</p>
                <p className="text-xs font-bold text-red-700 dark:text-red-300 truncate">{fmt(totalExpense)}</p>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-center">
                <p className="text-[10px] text-slate-700 dark:text-slate-300">{lang === 'ar' ? 'تحويل' : 'Transfer'}</p>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">{fmt(totalTransfers)}</p>
              </div>
            </div>

            {/* Transactions list */}
            <div className="mt-4">
              <h3 className="text-sm font-semibold mb-2">
                {transactions.length} {lang === 'ar' ? 'معاملة' : 'transactions'}
              </h3>
              <div className="max-h-72 overflow-y-auto -mx-2">
                {transactions.length === 0 ? (
                  <p className="text-center text-sm text-slate-400 py-4">{t('noTransactionsYet')}</p>
                ) : (
                  transactions.slice(0, 50).map(tx => {
                    const Icon = getIcon(tx.category?.icon || 'tag');
                    const isIncome = tx.type === 'INCOME';
                    const isTransfer = tx.type === 'TRANSFER';
                    return (
                      <div key={tx.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg transition">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0"
                          style={{ background: isTransfer ? '#64748B' : tx.category?.color || '#64748B' }}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {isTransfer
                              ? (lang === 'ar' ? 'تحويل' : 'Transfer')
                              : (lang === 'ar' ? tx.category?.nameAr : tx.category?.nameEn)}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {new Date(tx.date).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {tx.note ? ` • ${tx.note}` : ''}
                          </p>
                        </div>
                        <span className={cn(
                          'text-xs font-semibold shrink-0',
                          isIncome
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : isTransfer
                              ? 'text-slate-600 dark:text-slate-300'
                              : 'text-red-600 dark:text-red-400'
                        )}>
                          {isIncome ? '+' : isTransfer ? '⇄ ' : '-'}{fmt(tx.amount, tx.currency)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="text-center text-sm text-slate-400 py-4">{lang === 'ar' ? 'الحساب غير موجود' : 'Account not found'}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AccountModal({
  open, onOpenChange, initial, onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: Account | null;
  onSave: (data: any) => void;
}) {
  const { t, lang } = useT();
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState(initial?.type || 'CASH');
  const [currency, setCurrency] = useState<Currency>(initial?.currency as Currency || 'EGP');
  const [balance, setBalance] = useState(initial ? initial.balance.toString() : '');
  const [color, setColor] = useState(initial?.color || COLORS[0]);
  const [icon, setIcon] = useState(initial?.icon || 'wallet');
  const [isDefault, setIsDefault] = useState(initial?.isDefault || false);

  const submit = () => {
    if (!name || !type || !currency) {
      toast.error(lang === 'ar' ? 'أدخل الاسم والنوع والعملة' : 'Enter name, type, currency');
      return;
    }
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
          <div className="flex justify-center py-2">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-white"
              style={{ background: color }}
            >
              <DynamicIcon name={icon} className="w-7 h-7" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('account')}</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="..." />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>{t('type')}</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map(t => <SelectItem key={t.value} value={t.value}>{lang === 'ar' ? t.labelAr : t.labelEn}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('currency')}</Label>
              <Select value={currency} onValueChange={(v: any) => setCurrency(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('balance')}</Label>
            <Input type="number" inputMode="decimal" value={balance} onChange={e => setBalance(e.target.value)} placeholder="0.00" />
          </div>

          <div className="space-y-1.5">
            <Label>{lang === 'ar' ? 'اللون' : 'Color'}</Label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'w-8 h-8 rounded-full border-2 transition',
                    color === c ? 'border-slate-900 dark:border-white scale-110' : 'border-transparent'
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{lang === 'ar' ? 'الأيقونة' : 'Icon'}</Label>
            <div className="grid grid-cols-8 gap-1.5 max-h-44 overflow-y-auto p-1 border border-slate-200 dark:border-slate-800 rounded-lg">
              {ICONS.map(i => {
                const I = getIcon(i);
                const sel = icon === i;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setIcon(i)}
                    className={cn(
                      'aspect-square rounded-lg flex items-center justify-center transition border-2',
                      sel
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                        : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
                    )}
                    style={sel ? { color } : undefined}
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
          <Button onClick={submit} className="bg-blue-600 hover:bg-blue-700">{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
