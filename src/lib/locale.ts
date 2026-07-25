/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Currency, locale and country — one definition, used everywhere.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `organizations.currency` has existed since the first migration and was
 * written correctly by the settings screen. Nothing ever read it: every one of
 * the fifty-odd `formatCurrency()` calls in the application relied on the
 * function's `'USD'` default, so an organization could set its currency to
 * naira, see it saved, and watch every figure in every module carry on showing
 * dollars.
 *
 * This module holds the supported set and the rules for turning a currency
 * into a locale. `format.ts` reads the active values; `app-store` sets them
 * from the session. Nothing else needs to know.
 */

export interface CurrencyDefinition {
  code: string;
  name: string;
  symbol: string;
  /** Locale used to format money, dates and numbers for this market. */
  locale: string;
  /** ISO 3166-1 alpha-2, for the address form's country default. */
  country: string;
  /** Kobo, cents, pence. Zero for currencies not conventionally subdivided. */
  decimals: number;
}

/**
 * The currencies this platform supports.
 *
 * NGN is first because Nigeria is the initial market, and the list is ordered
 * rather than alphabetical so the default sits at the top of the dropdown.
 * Adding a market means adding a row here — no other file needs changing.
 */
export const CURRENCIES: readonly CurrencyDefinition[] = [
  { code: 'NGN', name: 'Nigerian Naira',   symbol: '₦',  locale: 'en-NG', country: 'NG', decimals: 2 },
  { code: 'USD', name: 'US Dollar',        symbol: '$',  locale: 'en-US', country: 'US', decimals: 2 },
  { code: 'GBP', name: 'Pound Sterling',   symbol: '£',  locale: 'en-GB', country: 'GB', decimals: 2 },
  { code: 'EUR', name: 'Euro',             symbol: '€',  locale: 'en-IE', country: 'IE', decimals: 2 },
  { code: 'GHS', name: 'Ghanaian Cedi',    symbol: '₵',  locale: 'en-GH', country: 'GH', decimals: 2 },
  { code: 'KES', name: 'Kenyan Shilling',  symbol: 'KSh', locale: 'en-KE', country: 'KE', decimals: 2 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', locale: 'en-ZA', country: 'ZA', decimals: 2 },
  { code: 'CAD', name: 'Canadian Dollar',  symbol: 'C$', locale: 'en-CA', country: 'CA', decimals: 2 },
] as const;

/** The market this product was built for. */
export const DEFAULT_CURRENCY = 'NGN';

export const CURRENCY_CODES = CURRENCIES.map(c => c.code);

export function isSupportedCurrency(code: unknown): code is string {
  return typeof code === 'string' && CURRENCY_CODES.includes(code.toUpperCase().trim());
}

/**
 * Resolve a currency code to its definition.
 *
 * Falls back to the default rather than throwing: a stored code that is no
 * longer supported should degrade to showing the wrong symbol, not take down
 * every screen that renders a number.
 */
export function currencyOf(code: string | null | undefined): CurrencyDefinition {
  const wanted = (code ?? '').toUpperCase().trim();
  return (
    CURRENCIES.find(c => c.code === wanted) ??
    CURRENCIES.find(c => c.code === DEFAULT_CURRENCY)!
  );
}

/** The locale a currency implies, unless the organization overrides it. */
export function localeFor(code: string | null | undefined): string {
  return currencyOf(code).locale;
}

/**
 * Nigerian phone numbers.
 *
 * The previous validation assumed North American numbering. Nigerian mobile
 * numbers are 11 digits nationally (0803 123 4567) or 13 in international form
 * (+234 803 123 4567), and people type them both ways, with and without
 * spaces. Both are accepted and normalised to one stored shape.
 */
const NG_MOBILE = /^(?:\+?234|0)(70|71|80|81|90|91|70|91)\d{8}$/;

export function normalizeNigerianPhone(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, '');
  if (!NG_MOBILE.test(digits)) return null;

  // Store one way: +234 without the trunk zero, so numbers compare equal
  // regardless of how they were typed.
  const national = digits.replace(/^\+?234/, '').replace(/^0/, '');
  return `+234${national}`;
}

/**
 * Loose validation for any supported country.
 *
 * Nigerian numbers get the specific rule above; everything else is checked for
 * plausibility only. Rejecting a valid foreign number is worse than accepting
 * an odd-looking one, and this is a directory field rather than something that
 * gets dialled automatically.
 */
export function isPlausiblePhone(raw: string, country = 'NG'): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true; // Optional field.
  if (country === 'NG' && /^(?:\+?234|0)\d/.test(trimmed.replace(/[\s()-]/g, ''))) {
    return normalizeNigerianPhone(trimmed) !== null;
  }
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/** Countries offered in the address form, default first. */
export const COUNTRIES: readonly { code: string; name: string }[] = [
  { code: 'NG', name: 'Nigeria' },
  { code: 'GH', name: 'Ghana' },
  { code: 'KE', name: 'Kenya' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'IE', name: 'Ireland' },
] as const;

export const DEFAULT_COUNTRY = 'NG';

/**
 * Nigerian states, for the address form.
 *
 * Nigeria uses states rather than provinces or counties, and a free-text field
 * here produces "Lagos", "lagos state" and "LAG" in the same column.
 */
export const NIGERIAN_STATES: readonly string[] = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
  'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'Federal Capital Territory', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano',
  'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun',
  'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe',
  'Zamfara',
] as const;
