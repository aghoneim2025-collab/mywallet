'use client';
import { Home, ArrowLeftRight, PiggyBank, BarChart3, Settings } from 'lucide-react';
import { useT } from '@/hooks/use-t';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/use-media-query';

export type TabKey = 'dashboard' | 'transactions' | 'budget' | 'reports' | 'settings';

const tabs: { key: TabKey; icon: React.ElementType }[] = [
  { key: 'dashboard', icon: Home },
  { key: 'transactions', icon: ArrowLeftRight },
  { key: 'budget', icon: PiggyBank },
  { key: 'reports', icon: BarChart3 },
  { key: 'settings', icon: Settings },
];

export function BottomNav({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  const { t } = useT();
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const labels: Record<TabKey, string> = {
    dashboard: t('dashboard'),
    transactions: t('transactions'),
    budget: t('budget'),
    reports: t('reports'),
    settings: t('settings'),
  };

  return (
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 z-40 pb-safe shadow-[0_-4px_12px_rgba(0,0,0,0.05)]"
      role="navigation"
      aria-label="Bottom navigation"
    >
      <div className="flex items-stretch justify-around h-16 px-2">
        {tabs.map(({ key, icon: Icon }) => {
          const isActive = active === key;
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 flex-1 min-w-0 rounded-lg transition-all',
                'active:scale-95 active:bg-slate-100 dark:active:bg-slate-800',
                isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
              )}
              aria-label={labels[key]}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className={cn('w-5 h-5', isActive && 'stroke-[2.5]')} />
              <span className="text-[10px] font-medium leading-none truncate max-w-full px-1">
                {labels[key]}
              </span>
              {isActive && (
                <span className="absolute -top-px h-0.5 w-8 bg-blue-600 dark:bg-blue-400 rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
