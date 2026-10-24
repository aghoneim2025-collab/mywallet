// نظام العملات المتعدد مع تحويل
// أسعار الصرف قابلة للتحديث عبر الإعدادات (#9)

export type Currency = 'EGP' | 'SAR' | 'USD' | 'EUR' | 'AED';

// سعر الصرف مقابل EGP (1 وحدة من العملة = كم EGP)
// القيم الافتراضية - يمكن تحديثها من الإعدادات
export const DEFAULT_EXCHANGE_RATES: Record<Currency, number> = {
  EGP: 1,
  SAR: 13.0,
  USD: 48.5,
  EUR: 52.0,
  AED: 13.2,
};

// الأسعار الحالية - تتحدث من localStorage أو الإعدادات
export let EXCHANGE_RATES: Record<Currency, number> = { ...DEFAULT_EXCHANGE_RATES };

// تحديث الأسعار من الإعدادات
export function updateExchangeRates(rates: Partial<Record<Currency, number>>) {
  EXCHANGE_RATES = { ...EXCHANGE_RATES, ...rates };
}

// تحميل الأسعار من localStorage (client-side)
export function loadExchangeRates(): Record<Currency, number> {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem('mw-exchange-rates');
      if (saved) {
        const parsed = JSON.parse(saved);
        EXCHANGE_RATES = { ...DEFAULT_EXCHANGE_RATES, ...parsed };
      }
    } catch {}
  }
  return EXCHANGE_RATES;
}

// حفظ الأسعار في localStorage
export function saveExchangeRates(rates: Record<Currency, number>) {
  EXCHANGE_RATES = rates;
  if (typeof window !== 'undefined') {
    localStorage.setItem('mw-exchange-rates', JSON.stringify(rates));
  }
}

export const CURRENCY_SYMBOLS: Record<Currency, { ar: string; en: string }> = {
  EGP: { ar: 'ج.م', en: 'E£' },
  SAR: { ar: '﷼', en: 'SAR' },
  USD: { ar: '$', en: '$' },
  EUR: { ar: '€', en: '€' },
  AED: { ar: 'د.إ', en: 'AED' },
};

// تحويل مبلغ من عملة لأخرى عبر EGP كعملة وسيطة
export function convert(amount: number, from: Currency, to: Currency): number {
  if (from === to) return amount;
  const inEgp = amount * EXCHANGE_RATES[from];
  return inEgp / EXCHANGE_RATES[to];
}

// تنسيق المبلغ مع رمز العملة
export function formatMoney(
  amount: number,
  currency: Currency,
  lang: 'ar' | 'en' = 'ar'
): string {
  const sym = CURRENCY_SYMBOLS[currency][lang];
  const formatted = new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  const sign = amount < 0 ? '-' : '';
  return lang === 'ar'
    ? `${sign}${formatted} ${sym}`
    : `${sign}${sym} ${formatted}`;
}

// اختصار رقم كبير (مثلا 15000 -> 15K)
export function compactNumber(amount: number, lang: 'ar' | 'en' = 'ar'): string {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount);
}
