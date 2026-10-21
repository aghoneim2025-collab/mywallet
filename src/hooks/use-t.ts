'use client';
import { useSettings } from '@/lib/store';
import { t as translate, type TranslationKey } from '@/lib/i18n';

export function useT() {
  const lang = useSettings(s => s.lang);
  return {
    lang,
    t: (key: TranslationKey) => translate(lang, key),
    dir: lang === 'ar' ? 'rtl' : 'ltr',
  };
}
