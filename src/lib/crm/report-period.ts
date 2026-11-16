import { z } from 'zod';

const day = 86_400_000;
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Date-only arithmetic: browser time zone and DST must not move a reporting boundary. */
export function reportPeriod(from: string, to: string) {
  if (!z.iso.date().safeParse(from).success || !z.iso.date().safeParse(to).success || from > to) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if ((end - start) / day > 730) return null;
  const days = (end - start) / day + 1;
  return { days, previousFrom: iso(start - days * day), previousTo: iso(start - day) };
}

export function reportPreset(today: string, preset: 'month' | 'quarter' | 'year' | '30days') {
  if (!z.iso.date().safeParse(today).success) throw new Error('Invalid organization date');
  const month = Number(today.slice(5, 7));
  const from = preset === '30days' ? iso(Date.parse(`${today}T00:00:00Z`) - 29 * day)
    : preset === 'year' ? `${today.slice(0, 4)}-01-01`
    : preset === 'quarter' ? `${today.slice(0, 4)}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
    : `${today.slice(0, 7)}-01`;
  return { from, to: today };
}
