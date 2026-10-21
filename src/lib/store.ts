'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Currency } from '@/lib/currency';

interface SettingsState {
  lang: 'ar' | 'en';
  baseCurrency: Currency;
  theme: 'light' | 'dark' | 'system';
  setLang: (l: 'ar' | 'en') => void;
  setBaseCurrency: (c: Currency) => void;
  setTheme: (t: 'light' | 'dark' | 'system') => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      lang: 'ar',
      baseCurrency: 'EGP',
      theme: 'light',
      setLang: (lang) => set({ lang }),
      setBaseCurrency: (baseCurrency) => set({ baseCurrency }),
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'mw-settings' }
  )
);
