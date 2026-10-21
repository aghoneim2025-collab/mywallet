'use client';
import { useEffect } from 'react';
import { useSettings } from '@/lib/store';
import { ServiceWorkerRegistrar } from '@/components/sw-registrar';

export function Providers({ children }: { children: React.ReactNode }) {
  const lang = useSettings(s => s.lang);
  const theme = useSettings(s => s.theme);

  useEffect(() => {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    const html = document.documentElement;
    const apply = (t: 'light' | 'dark') => {
      if (t === 'dark') html.classList.add('dark');
      else html.classList.remove('dark');
    };
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      apply(mq.matches ? 'dark' : 'light');
      const handler = (e: MediaQueryListEvent) => apply(e.matches ? 'dark' : 'light');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    apply(theme);
  }, [theme]);

  return (
    <>
      <ServiceWorkerRegistrar />
      {children}
    </>
  );
}
