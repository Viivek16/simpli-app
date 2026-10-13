/**
 * Trip currency — display only.
 *
 * One currency per trip, stored server-side in `trip_currency` so every member of a
 * galaxy sees the same symbol. Amounts are NEVER converted: changing a trip's currency
 * relabels the existing numbers, it does not re-price them.
 *
 * Trips with no row default to INR, which is what every trip created before this
 * existed was implicitly using.
 *
 * Pure on purpose — no React, no connection — so `ledger.check.ts` can run it on
 * bare node. The live lookup lives in `hooks/useTripCurrency.ts`.
 */
export const DEFAULT_CURRENCY = 'INR';

export interface Currency { code: string; symbol: string; label: string; }

// Major global currencies. `symbol` is for the picker and the formatting fallback;
// formatted output takes its glyph from `code` via Intl.
export const CURRENCIES: Currency[] = [
  { code: 'INR', symbol: '₹',  label: 'Indian Rupee' },
  { code: 'USD', symbol: '$',  label: 'US Dollar' },
  { code: 'EUR', symbol: '€',  label: 'Euro' },
  { code: 'GBP', symbol: '£',  label: 'British Pound' },
  { code: 'SGD', symbol: 'S$', label: 'Singapore Dollar' },
  { code: 'AED', symbol: 'AED', label: 'UAE Dirham' },
  { code: 'LKR', symbol: 'Rs', label: 'Sri Lankan Rupee' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian Dollar' },
  { code: 'CHF', symbol: 'Fr', label: 'Swiss Franc' },
  { code: 'JPY', symbol: '¥',  label: 'Japanese Yen' },
  { code: 'CNY', symbol: 'CN¥',label: 'Chinese Yuan' },
  { code: 'HKD', symbol: 'HK$',label: 'Hong Kong Dollar' },
  { code: 'THB', symbol: '฿',  label: 'Thai Baht' },
  { code: 'MYR', symbol: 'RM', label: 'Malaysian Ringgit' },
  { code: 'IDR', symbol: 'Rp', label: 'Indonesian Rupiah' },
  { code: 'VND', symbol: '₫',  label: 'Vietnamese Dong' },
  { code: 'PHP', symbol: '₱',  label: 'Philippine Peso' },
  { code: 'KRW', symbol: '₩',  label: 'South Korean Won' },
  { code: 'NZD', symbol: 'NZ$',label: 'New Zealand Dollar' },
  { code: 'SAR', symbol: 'SAR', label: 'Saudi Riyal' },
  { code: 'QAR', symbol: 'QAR', label: 'Qatari Riyal' },
  { code: 'ZAR', symbol: 'R',  label: 'South African Rand' },
  { code: 'BRL', symbol: 'R$', label: 'Brazilian Real' },
  { code: 'TRY', symbol: '₺',  label: 'Turkish Lira' },
  { code: 'NPR', symbol: 'रू', label: 'Nepalese Rupee' },
];

const BY_CODE = new Map(CURRENCIES.map(c => [c.code, c]));

export const currencyMeta = (code: string): Currency =>
  BY_CODE.get(code) || BY_CODE.get(DEFAULT_CURRENCY)!;

/**
 * en-US naming is what keeps the dollar family apart — it renders SGD as "SGD",
 * AUD as "A$", HKD as "HK$", CNY as "CN¥". Under each currency's own locale they
 * all collapse to a bare "$" or "¥", so a Singapore trip would read as US dollars.
 * INR is the exception: en-IN costs nothing in ambiguity (₹ is unique) and buys
 * back the lakh/crore digit grouping Indian users expect.
 */
const localeFor = (code: string) => (code === 'INR' ? 'en-IN' : 'en-US');

/**
 * Format an amount in a trip's currency. Always 2 decimals — the ledger stores
 * 2-decimal precision, and showing a different number of digits per currency would
 * make rows of the same trip disagree with each other.
 */
export const money = (v: number, code: string = DEFAULT_CURRENCY): string => {
  const c = currencyMeta(code);
  try {
    return new Intl.NumberFormat(localeFor(c.code), {
      style: 'currency', currency: c.code,
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(v);
  } catch {
    // Unknown code on an old runtime — never let formatting take the UI down.
    return `${c.symbol}${v.toFixed(2)}`;
  }
};
