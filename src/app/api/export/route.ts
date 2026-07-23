import { db } from '@/lib/db';
import { error } from '@/lib/api-response';
import { exportSchema } from '@/lib/validations';
import { NextResponse } from 'next/server';

function escapeCSV(val: unknown): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(escapeCSV).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCSV(row[h])).join(','));
  }
  return lines.join('\n');
}

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      Object.assign(out, flatten(v as Record<string, unknown>, key));
    } else {
      out[key] = v instanceof Date ? v.toISOString() : v;
    }
  }
  return out;
}

const moduleMap: Record<string, { model: any; sortKey: string }> = {
  leads: { model: 'lead', sortKey: 'createdAt' },
  contacts: { model: 'contact', sortKey: 'createdAt' },
  companies: { model: 'company', sortKey: 'createdAt' },
  deals: { model: 'deal', sortKey: 'createdAt' },
  projects: { model: 'project', sortKey: 'createdAt' },
  tasks: { model: 'projectTask', sortKey: 'createdAt' },
  tickets: { model: 'supportTicket', sortKey: 'createdAt' },
  invoices: { model: 'invoice', sortKey: 'createdAt' },
  expenses: { model: 'expense', sortKey: 'createdAt' },
  products: { model: 'product', sortKey: 'createdAt' },
  warehouses: { model: 'warehouse', sortKey: 'createdAt' },
  events: { model: 'calendarEvent', sortKey: 'startDate' },
  users: { model: 'user', sortKey: 'createdAt' },
  pages: { model: 'workspacePage', sortKey: 'createdAt' },
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const validated = exportSchema.parse(body);
    const { module: mod, format } = validated;

    const config = moduleMap[mod];
    if (!config) {
      return error(`Unknown module: ${mod}. Valid: ${Object.keys(moduleMap).join(', ')}`, 400);
    }

     
    const rows = await (db as any)[config.model].findMany({
      orderBy: { [config.sortKey]: 'desc' },
      take: 10000,
    });

    const flatRows = rows.map((r: Record<string, unknown>) => {
      const { id, ...rest } = r;
      return flatten(rest);
    });

    if (format === 'csv') {
      const csv = toCSV(flatRows);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${mod}-export.csv"`,
        },
      });
    }

    return error('Unsupported format', 400);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    return error(e.message || 'Export failed', 500);
  }
}