'use client';
import { useState, useEffect } from 'react';
import { BottomNav, type TabKey } from '@/components/bottom-nav';
import { FAB } from '@/components/fab';
import { HomeScreen } from '@/components/home-screen';
import { CategoriesScreen } from '@/components/categories-screen';
import { AccountsScreen } from '@/components/accounts-screen';
import { ReportsScreen } from '@/components/reports-screen';
import { SettingsScreen } from '@/components/settings-screen';
import { BudgetScreen } from '@/components/budget-screen';
import { TransactionModal } from '@/components/transaction-modal';
import { TransferModal } from '@/components/transfer-modal';
import { AuthScreen } from '@/components/auth-screen';
import { getStoredToken, setStoredToken } from '@/lib/auth-storage';

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [txModal, setTxModal] = useState<{ open: boolean; type: 'EXPENSE' | 'INCOME'; initial?: any }>({ open: false, type: 'EXPENSE' });
  const [transferModal, setTransferModal] = useState(false);

  // Check auth on mount - try stored Bearer token first, fall back to cookie
  useEffect(() => {
    const stored = getStoredToken();
    const fetchOpts: RequestInit = stored
      ? { headers: { Authorization: `Bearer ${stored}` } }
      : {};
    fetch('/api/auth/session', fetchOpts)
      .then(r => r.json())
      .then(d => {
        if (d.data) setAuthed(true);
        else {
          // Session has no data — clear any stale token
          setStoredToken(null);
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const openAddExpense = () => setTxModal({ open: true, type: 'EXPENSE' });
  const openAddIncome = () => setTxModal({ open: true, type: 'INCOME' });
  const openEditTx = (tx: any) => setTxModal({ open: true, type: tx.type === 'INCOME' ? 'INCOME' : 'EXPENSE', initial: tx });
  const openTransfer = () => setTransferModal(true);

  const [reloadKey, setReloadKey] = useState(0);
  const handleSaved = () => setReloadKey(k => k + 1);

  const handleLogout = () => {
    // Clear stored token client-side + call logout API (clears cookie)
    setStoredToken(null);
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setAuthed(false);
    setActiveTab('home');
  };

  // Show loading while checking auth
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-blue-600">
        <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  // Show auth screen if not logged in
  if (!authed) {
    return <AuthScreen onAuth={() => { setAuthed(true); setReloadKey(k => k + 1); }} />;
  }

  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-1 pb-24">
        {activeTab === 'home' && (
          <HomeScreen key={`h-${reloadKey}`} onEditTx={openEditTx} onOpenAccounts={() => setActiveTab('accounts')} />
        )}
        {activeTab === 'categories' && <CategoriesScreen key={`c-${reloadKey}`} />}
        {activeTab === 'accounts' && <AccountsScreen key={`a-${reloadKey}`} />}
        {activeTab === 'reports' && <ReportsScreen key={`r-${reloadKey}`} />}
        {activeTab === 'settings' && (
          <>
            <SettingsScreen onLogout={handleLogout} />
            <div className="px-4 pb-4">
              <BudgetScreen key={`b-${reloadKey}`} />
            </div>
          </>
        )}
      </main>

      <FAB onAddExpense={openAddExpense} onAddIncome={openAddIncome} onTransfer={openTransfer} />
      <BottomNav active={activeTab} onChange={setActiveTab} />

      <TransactionModal
        open={txModal.open}
        onOpenChange={(o) => setTxModal(m => ({ ...m, open: o }))}
        initial={txModal.initial || { type: txModal.type }}
        onSaved={handleSaved}
      />
      <TransferModal open={transferModal} onOpenChange={setTransferModal} onSaved={handleSaved} />
    </div>
  );
}
