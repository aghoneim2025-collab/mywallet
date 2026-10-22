'use client';
import { Plus, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight } from 'lucide-react';
import { useState } from 'react';
import { useT } from '@/hooks/use-t';
import { cn } from '@/lib/utils';

interface FABProps {
  onAddExpense: () => void;
  onAddIncome: () => void;
  onTransfer: () => void;
}

export function FAB({ onAddExpense, onAddIncome, onTransfer }: FABProps) {
  const [open, setOpen] = useState(false);
  const { t } = useT();

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
      <div className="relative max-w-md w-screen flex justify-end pe-4 pointer-events-none">
        {/* overlay */}
        {open && (
          <button
            className="fixed inset-0 bg-black/30 backdrop-blur-[2px] pointer-events-auto"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          />
        )}

        {/* submenu items */}
        <div
          className={cn(
            'absolute bottom-16 end-4 flex flex-col gap-2 items-end transition-all pointer-events-auto',
            open ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
          )}
        >
          <button
            onClick={() => { setOpen(false); onTransfer(); }}
            className="flex items-center gap-2 bg-slate-700 hover:bg-slate-800 text-white px-4 py-2.5 rounded-full shadow-lg active:scale-95 transition-all"
          >
            <ArrowLeftRight className="w-5 h-5" />
            <span className="text-sm font-semibold">{t('transfer') || (document.documentElement.lang === 'ar' ? 'تحويل' : 'Transfer')}</span>
          </button>
          <button
            onClick={() => { setOpen(false); onAddIncome(); }}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 rounded-full shadow-lg active:scale-95 transition-all"
          >
            <ArrowUpCircle className="w-5 h-5" />
            <span className="text-sm font-semibold">{t('addIncome')}</span>
          </button>
          <button
            onClick={() => { setOpen(false); onAddExpense(); }}
            className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2.5 rounded-full shadow-lg active:scale-95 transition-all"
          >
            <ArrowDownCircle className="w-5 h-5" />
            <span className="text-sm font-semibold">{t('addExpense')}</span>
          </button>
        </div>

        {/* main button */}
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            'pointer-events-auto w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-xl active:scale-95 transition-all flex items-center justify-center',
            open && 'rotate-45 bg-slate-700'
          )}
          aria-label={t('add')}
          aria-expanded={open}
        >
          <Plus className="w-7 h-7 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
}
