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
import { TransferModal } from '@/components/transfer-modal';
import { useT } from '@/hooks/use-t';

export default function Home() {
  const { t } = useT();
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [txModal, setTxModal] = useState<{ open: boolean; type: 'EXPENSE' | 'INCOME'; initial?: any }>({ open: false, type: 'EXPENSE' });
  const [transferModal, setTransferModal] = useState(false);

  const openAddExpense = () => setTxModal({ open: true, type: 'EXPENSE' });
  const openAddIncome = () => setTxModal({ open: true, type: 'INCOME' });
  const openEditTx = (tx: any) => setTxModal({ open: true, type: tx.type === 'INCOME' ? 'INCOME' : 'EXPENSE', initial: tx });
  const openTransfer = () => setTransferModal(true);

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
        {activeTab === 'accounts' && (
          <AccountsScreen key={`a-${reloadKey}`} />
        )}
        {activeTab === 'reports' && <ReportsScreen key={`r-${reloadKey}`} />}
        {activeTab === 'settings' && (
          <>
            <SettingsScreen />
            <div className="px-4 pb-4">
              <BudgetScreen key={`b-${reloadKey}`} />
            </div>
          </>
        )}
      </main>

      <FAB
        onAddExpense={openAddExpense}
        onAddIncome={openAddIncome}
        onTransfer={openTransfer}
      />

      <BottomNav active={activeTab} onChange={setActiveTab} />

      <TransactionModal
        open={txModal.open}
        onOpenChange={(o) => setTxModal(m => ({ ...m, open: o }))}
        initial={txModal.initial || { type: txModal.type }}
        onSaved={handleSaved}
      />

      <TransferModal
        open={transferModal}
        onOpenChange={setTransferModal}
        onSaved={handleSaved}
      />
    </div>
  );
}
