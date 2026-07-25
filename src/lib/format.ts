import { DEFAULT_CURRENCY, currencyOf } from '@/lib/locale';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Active presentation settings
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These formatters are called from roughly fifty places across the modules,
 * none of which passed a currency — so every figure in the application used
 * this file's `'USD'` default and its hardcoded `'en-US'`, no matter what the
 * organization had configured.
 *
 * Threading the currency through fifty call sites would mean every component
 * that renders a number also has to obtain it, and one missed call site puts
 * the workspace back to showing two currencies at once. Holding it here
 * instead means a single assignment when the session resolves, and every
 * existing call site becomes correct without being touched.
 *
 * Module state is sound for this because these run in the browser, where there
 * is exactly one signed-in organization at a time. `configureFormatting` is
 * called by the store as soon as the session is known, and again whenever the
 * setting changes.
 */
let activeCurrency = DEFAULT_CURRENCY;
let activeLocale = currencyOf(DEFAULT_CURRENCY).locale;

export function configureFormatting(opts: { currency?: string | null; locale?: string | null }) {
  if (opts.currency) {
    activeCurrency = opts.currency.toUpperCase().trim();
    // The locale follows the currency unless one is given explicitly, which is
    // what makes naira render as ₦1,500.00 with Nigerian date order rather
    // than as NGN 1,500.00 in American order.
    activeLocale = opts.locale ?? currencyOf(activeCurrency).locale;
  } else if (opts.locale) {
    activeLocale = opts.locale;
  }
}

/** What money is currently being rendered in. Exposed for tests and labels. */
export function activeCurrencyCode(): string {
  return activeCurrency;
}

export function activeLocaleCode(): string {
  return activeLocale;
}

/**
 * Money.
 *
 * Fraction digits are no longer forced to zero. That was defensible for
 * dollars in a dashboard tile and is wrong for an invoice line, and it made
 * ₦1,500.50 and ₦1,500.49 render identically.
 */
export function formatCurrency(amount: number, currency?: string): string {
  const code = currency ?? activeCurrency;
  const def = currencyOf(code);
  try {
    return new Intl.NumberFormat(activeLocale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: def.decimals,
      maximumFractionDigits: def.decimals,
    }).format(amount ?? 0);
  } catch {
    // An unsupported code would otherwise throw inside render and take the
    // whole module down through the error boundary.
    return `${def.symbol}${(amount ?? 0).toLocaleString(activeLocale)}`;
  }
}

/** Money without the decimals, for tiles where the pennies are noise. */
export function formatCurrencyCompact(amount: number, currency?: string): string {
  const code = currency ?? activeCurrency;
  try {
    return new Intl.NumberFormat(activeLocale, {
      style: 'currency', currency: code, maximumFractionDigits: 0,
    }).format(amount ?? 0);
  } catch {
    return formatCurrency(amount, code);
  }
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(activeLocale).format(n ?? 0);
}

/**
 * Dates, in the organization's own order.
 *
 * en-NG gives 25/07/2026 where en-US gives 7/25/2026 — the same string means
 * two different days, so this is a correctness matter rather than a cosmetic
 * one for anyone reading a Nigerian invoice.
 */
export function formatDate(date: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(activeLocale, opts ?? { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Unambiguous all-numeric form, for dense tables. */
export function formatDateNumeric(date: string | Date): string {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(activeLocale, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(date: string | Date): string {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(activeLocale, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function formatRelativeTime(date: string | Date): string {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

export function getInitials(firstName: string, lastName: string): string {
  return `${(firstName?.[0] ?? '').toUpperCase()}${(lastName?.[0] ?? '').toUpperCase()}`;
}

/**
 * Initials from a single display name.
 *
 * The directory view resolves one `full_name` rather than the two columns
 * `getInitials` expects, and splitting it at the call site to feed that
 * function produced "" for anyone recorded under a single name.
 */
export function initialsOf(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}

export function truncate(str: string, length: number): string {
  if (!str) return '';
  return str.length > length ? str.slice(0, length) + '...' : str;
}