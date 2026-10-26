// نظام العملات المتعدد مع تحويل
// أسعار الصرف قابلة للتحديث عبر الإعدادات (#9)
//
// P0.15: KNOWN LIMITATION — server/client rate divergence.
// `EXCHANGE_RATES` is module-level, initialized from `DEFAULT_EXCHANGE_RATES`.
// The CLIENT (browser) can override via `loadExchangeRates()` from localStorage.
// The SERVER always uses `DEFAULT_EXCHANGE_RATES` (no server-side rate store).
//
// This means: when the user updates rates via the settings UI, those rates
// are saved to localStorage (client only). The server continues to use the
// defaults. So:
//   - Stats endpoint (/api/stats) uses DEFAULT rates when computing totals.
//   - Client-side display uses localStorage rates.
//   - The two DIVERGE.
//
// The P0.12 snapshot fields mitigate this for TRANSACTION REVERSAL (each
// transaction stores its own sourceAmount/destAmount/exchangeRateUsed at
// create time, so reversal is idempotent regardless of current rates).
//
// But stats/budget aggregation still uses current rates and may be wrong
// if the user has customized rates. Proper fix: store rates in DB (per-user
// or global), have both client and server fetch from the same source.
// This is a TODO for a future iteration.

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

// P0.15: server-side rate source. Currently returns DEFAULT rates.
// TODO: replace with DB-backed implementation that fetches per-user or
// global rates from a Setting table (which would need to be re-added
// to the schema with userId scoping, per the P0.11 audit).
export function getServerExchangeRates(): Record<Currency, number> {
  // For now, return defaults. When a DB-backed store is implemented,
  // this will fetch from the DB (cached per-request).
  return DEFAULT_EXCHANGE_RATES;
}

// P0.15: server-side convert(). Uses server-side rates (currently defaults).
// Use this in API routes (transactions, transfer, stats, budgets) instead
// of the client-side `convert()` so server and client don't diverge.
// Note: for transaction REVERSAL, always use the snapshot fields
// (sourceAmount, destAmount, exchangeRateUsed) — never re-convert.
export function convertServer(amount: number, from: Currency, to: Currency): number {
  if (from === to) return amount;
  const rates = getServerExchangeRates();
  const inEgp = amount * rates[from];
  return inEgp / rates[to];
}

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
        // P0.11/P0.15: validate parsed rates (NaN/Infinity/negative → skip)
        const validated: Partial<Record<Currency, number>> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
          validated[k as Currency] = v;
        }
        EXCHANGE_RATES = { ...DEFAULT_EXCHANGE_RATES, ...validated };
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
// P0.15: this is the CLIENT-side convert (uses localStorage rates).
// For SERVER-side use (API routes), prefer `convertServer()` instead.
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
  // P0.11 fix: use 'ar-u-nu-latn' (Arabic with Latin numerals) instead of 'ar-EG'
  // — many finance users expect Western digits even in Arabic UIs.
  const formatted = new Intl.NumberFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-US', {
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
