'use client';
import { useState, useEffect, useCallback } from 'react';
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

// P0.10: typed session-check result so we can distinguish the four cases
// the API now returns:
//   - 'authed'        → 200 with user data → user is logged in
//   - 'unauth'        → 200 with null data → session really ended (clear token)
//   - 'db-down'       → 503 → DB unreachable, keep token, show retry UI
//   - 'server-error'  → 500 → unexpected, keep token, show retry UI
type SessionState = 'loading' | 'authed' | 'unauth' | 'db-down' | 'server-error';

export default function Home() {
  // P0.10: replaced `authed: boolean` + `checking: boolean` with a single
  // typed state. This makes it impossible to accidentally render the auth
  // screen when the DB is down (was the P0.9 bug — `authed=false` + `checking=false`
  // fell through to the AuthScreen, even though we should have shown "retry").
  const [session, setSession] = useState<SessionState>('loading');
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [txModal, setTxModal] = useState<{ open: boolean; type: 'EXPENSE' | 'INCOME'; initial?: any }>({ open: false, type: 'EXPENSE' });
  const [transferModal, setTransferModal] = useState(false);

  const checkSession = useCallback(async () => {
    setSession('loading');
    const stored = getStoredToken();
    const fetchOpts: RequestInit = stored
      ? { headers: { Authorization: `Bearer ${stored}` } }
      : {};
    try {
      const r = await fetch('/api/auth/session', fetchOpts);
      if (r.status === 503) {
        // DB outage. Keep token, show retry UI.
        setSession('db-down');
        return;
      }
      if (r.status === 500) {
        // Unexpected server error. Keep token, show retry UI.
        setSession('server-error');
        return;
      }
      const d = await r.json();
      if (d.data) {
        setSession('authed');
      } else {
        // 200 with null data → real session ended. Clear token.
        setStoredToken(null);
        setSession('unauth');
      }
    } catch {
      // Network error (server unreachable). Keep token, show retry UI.
      setSession('server-error');
    }
  }, []);

  // Check auth on mount.
  useEffect(() => { checkSession(); }, [checkSession]);

  const openAddExpense = () => setTxModal({ open: true, type: 'EXPENSE' });
  const openAddIncome = () => setTxModal({ open: true, type: 'INCOME' });
  const openEditTx = (tx: any) => setTxModal({ open: true, type: tx.type === 'INCOME' ? 'INCOME' : 'EXPENSE', initial: tx });
  const openTransfer = () => setTransferModal(true);

  const [reloadKey, setReloadKey] = useState(0);
  const handleSaved = () => setReloadKey(k => k + 1);

  const handleLogout = () => {
    setStoredToken(null);
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setSession('unauth');
    setActiveTab('home');
  };

  // P0.10: loading state — spinner only.
  if (session === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-blue-600">
        <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  // P0.10: DB outage / server error UI — show a retry button, NOT the auth screen.
  // Keeps the stored token intact so when the user retries and DB comes back,
  // they're logged in automatically without re-entering credentials.
  if (session === 'db-down' || session === 'server-error') {
    const isDbDown = session === 'db-down';
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="w-20 h-20 rounded-3xl bg-amber-100 dark:bg-amber-950 flex items-center justify-center mx-auto">
            <svg className="w-10 h-10 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              {isDbDown ? 'الخدمة غير متاحة مؤقتًا' : 'حدث خطأ غير متوقع'}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
              {isDbDown
                ? 'تعذّر الوصول إلى قاعدة البيانات. توكنك محفوظ — حاول مرة أخرى ولن تحتاج لإعادة تسجيل الدخول.'
                : 'حدث خطأ في الخادم. توكنك محفوظ — حاول مرة أخرى ولن تحتاج لإعادة تسجيل الدخول.'}
            </p>
          </div>
          <button
            onClick={() => checkSession()}
            className="w-full h-12 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  // P0.10: 'unauth' → show auth screen.
  if (session === 'unauth') {
    return (
      <AuthScreen
        onAuth={() => {
          setSession('authed');
          setReloadKey(k => k + 1);
        }}
      />
    );
  }

  // P0.10: 'authed' → main app.
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
