'use client';
import { useState } from 'react';
import { BottomNav, type TabKey } from '@/components/bottom-nav';
import { FAB } from '@/components/fab';
import { Dashboard } from '@/components/dashboard';
import { TransactionsScreen } from '@/components/transactions-screen';
import { BudgetScreen } from '@/components/budget-screen';
import { ReportsScreen } from '@/components/reports-screen';
import { AccountsScreen } from '@/components/accounts-screen';
import { SettingsScreen } from '@/components/settings-screen';
import { TransactionModal } from '@/components/transaction-modal';
import { ArrowRight } from 'lucide-react';
import { useT } from '@/hooks/use-t';

type Screen = TabKey | 'accounts';

export default function Home() {
  const { t } = useT();
  const [activeTab, setActiveTab] = useState<Screen>('dashboard');
  const [txModal, setTxModal] = useState<{ open: boolean; type: 'EXPENSE' | 'INCOME'; initial?: any }>({ open: false, type: 'EXPENSE' });

  const openAddExpense = () => setTxModal({ open: true, type: 'EXPENSE' });
  const openAddIncome = () => setTxModal({ open: true, type: 'INCOME' });
  const openEditTx = (tx: any) => setTxModal({ open: true, type: tx.type, initial: tx });

  const [reloadKey, setReloadKey] = useState(0);
  const handleSaved = () => setReloadKey(k => k + 1);

  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-1 pb-24">
        {activeTab === 'dashboard' && (
          <Dashboard
            key={`d-${reloadKey}`}
            onAddExpense={openAddExpense}
            onAddIncome={openAddIncome}
            onEditTx={openEditTx}
            onOpenAccounts={() => setActiveTab('accounts')}
          />
        )}
        {activeTab === 'transactions' && (
          <TransactionsScreen key={`t-${reloadKey}`} onEditTx={openEditTx} />
        )}
        {activeTab === 'budget' && <BudgetScreen key={`b-${reloadKey}`} />}
        {activeTab === 'reports' && <ReportsScreen key={`r-${reloadKey}`} />}
        {activeTab === 'accounts' && (
          <div>
            <div className="px-4 pt-4 flex items-center gap-2">
              <button
                onClick={() => setActiveTab('dashboard')}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label={t('dashboard')}
              >
                <ArrowRight className="w-5 h-5 rtl:rotate-180" />
              </button>
            </div>
            <AccountsScreen key={`a-${reloadKey}`} />
          </div>
        )}
        {activeTab === 'settings' && <SettingsScreen />}
      </main>

      {/* FAB hidden on accounts sub-screen to avoid conflict */}
      {activeTab !== 'accounts' && (
        <FAB onAddExpense={openAddExpense} onAddIncome={openAddIncome} />
      )}

      <BottomNav active={activeTab === 'accounts' ? 'dashboard' : activeTab} onChange={setActiveTab} />

      <TransactionModal
        open={txModal.open}
        onOpenChange={(o) => setTxModal(m => ({ ...m, open: o }))}
        initial={txModal.initial || { type: txModal.type }}
        onSaved={handleSaved}
      />
    </div>
  );
}
