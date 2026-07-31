'use client';

import * as React from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppStore } from '@/store/app-store';
import type { ModuleId } from '@/lib/constants';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Export, from the module that owns the data.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  `/api/export` serves seven datasets as RFC 4180 CSV, requires the `export`
 *  capability on the dataset's own module — deliberately separate from `view`,
 *  because a spreadsheet of the customer list leaves the platform's access
 *  controls permanently — and filters every row through RLS. No screen called
 *  it.
 *
 *  What the CRM had instead was a button that downloaded a string literal:
 *  two invented rows, "Sarah Jenkins, Acme Corp", identical for every tenant.
 *  That is worse than no export at all. A missing feature is visible; a button
 *  that hands you a plausible file of data that is not yours is not.
 *
 *  ── Why fetch-then-blob rather than an href ──────────────────────────────
 *
 *  Pointing a link at the endpoint means a refusal — a role without `export`
 *  gets 403 with a written reason — renders as raw JSON in a new tab. Fetching
 *  lets the refusal arrive as the sentence the server wrote it as.
 */

export interface ExportDataset {
  /** The `?dataset=` name the endpoint knows. */
  key: string;
  /** What the menu calls it. */
  label: string;
}

export function ExportButton({
  module,
  datasets,
  size = 'sm',
  variant = 'outline',
  className,
}: {
  module: ModuleId;
  datasets: ExportDataset[];
  size?: 'sm' | 'default';
  variant?: 'outline' | 'ghost' | 'default';
  className?: string;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const allows = useAppStore(s => s.allows);

  /**
   * Hidden from roles that cannot export.
   *
   * Rendering it and letting the server refuse would be an interface that
   * offers something it will not do. The server still enforces it — this is
   * presentation, never the access decision.
   */
  if (!allows(module, 'export') || datasets.length === 0) return null;

  const run = async (dataset: ExportDataset) => {
    setBusy(dataset.key);
    try {
      const res = await fetch(`/api/export?dataset=${encodeURIComponent(dataset.key)}`);

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message || `Could not export ${dataset.label.toLowerCase()}`);
      }

      const blob = await res.blob();

      // The server names the file — it knows the workspace slug and the date,
      // and two exports taken on different days must not overwrite each other.
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const named = /filename="?([^"]+)"?/.exec(disposition)?.[1];

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = named || `${dataset.key}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`${dataset.label} exported`);
    } catch (err: any) {
      toast.error(err.message || 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  const icon = busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />;

  // One dataset needs no menu — an extra click to choose from a list of one.
  if (datasets.length === 1) {
    return (
      <Button
        variant={variant} size={size} className={className}
        disabled={!!busy} onClick={() => run(datasets[0])}
      >
        {icon}
        <span className="ml-1.5">Export</span>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className={className} disabled={!!busy}>
          {icon}
          <span className="ml-1.5">Export</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {datasets.map(d => (
          <DropdownMenuItem key={d.key} onClick={() => run(d)} disabled={busy === d.key}>
            {d.label} (CSV)
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
