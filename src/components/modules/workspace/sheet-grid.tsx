'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus, Trash2, ChevronDown, Type, Hash, CalendarDays, ListChecks,
  CheckSquare, User, Link2, Coins, Loader2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/shared/empty-state';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { SheetColumn, SheetRow, DirectoryMember } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A business spreadsheet that persists.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What this replaces ───────────────────────────────────────────────────
 *
 *  The Spreadsheet tab rendered four hard-coded rows — "Target Revenue",
 *  "Q3 Headcount" — inside a table with a badge reading "Auto-saved". Nothing
 *  was saved, no cell was editable, and no column could be added. It was a
 *  picture of a spreadsheet.
 *
 *  ── How this one works ───────────────────────────────────────────────────
 *
 *  Columns are rows in `workspace_sheet_columns`; a row's values are a jsonb
 *  object keyed by column id. Keying by id rather than by name is what makes
 *  renaming a column free — no row is rewritten — and what stops a rename from
 *  orphaning every value beneath it.
 *
 *  Cells commit on blur and on Enter rather than on every keystroke. Saving per
 *  character would be one request per letter typed; saving only on an explicit
 *  button would lose work, because nobody presses save in a grid.
 */

const COLUMN_TYPES = [
  { value: 'text', label: 'Text', icon: Type },
  { value: 'number', label: 'Number', icon: Hash },
  { value: 'currency', label: 'Currency', icon: Coins },
  { value: 'date', label: 'Date', icon: CalendarDays },
  { value: 'select', label: 'Single select', icon: ListChecks },
  { value: 'checkbox', label: 'Checkbox', icon: CheckSquare },
  { value: 'member', label: 'Person', icon: User },
  { value: 'url', label: 'Link', icon: Link2 },
] as const;

function typeIcon(type: SheetColumn['type']) {
  return COLUMN_TYPES.find(t => t.value === type)?.icon ?? Type;
}

interface SheetGridProps {
  pageId: string;
  columns: SheetColumn[];
  rows: SheetRow[];
  members: DirectoryMember[];
  /** False for a page the caller may read but not change. */
  canEdit: boolean;
  onChanged: (next: { columns: SheetColumn[]; rows: SheetRow[] }) => void;
}

export function SheetGrid({ pageId, columns, rows, members, canEdit, onChanged }: SheetGridProps) {
  const [busy, setBusy] = useState(false);
  const [columnDialog, setColumnDialog] = useState<{ mode: 'new' | 'edit'; column?: SheetColumn } | null>(null);

  const request = useCallback(async (init: RequestInit & { query?: string }) => {
    const res = await fetch(`/api/workspace/pages/${pageId}/sheet${init.query ?? ''}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'Request failed');
    return json.data;
  }, [pageId]);

  const reload = useCallback(async () => {
    const data = await request({ method: 'GET' });
    onChanged({ columns: data.columns ?? [], rows: data.rows ?? [] });
  }, [request, onChanged]);

  // ─── Cells ───────────────────────────────────────────────────────────────

  /**
   * Write one cell.
   *
   * The row is updated locally first so the grid does not flash back to the old
   * value while the request is in flight, and re-read from the response so a
   * server-side normalisation (an emptied cell being dropped) is reflected.
   */
  const saveCell = useCallback(async (row: SheetRow, columnId: string, value: unknown) => {
    const previous = row.cells?.[columnId];
    if (previous === value || (previous == null && value === '')) return;

    onChanged({
      columns,
      rows: rows.map(r => r.id === row.id ? { ...r, cells: { ...r.cells, [columnId]: value } } : r),
    });

    try {
      await request({
        method: 'PATCH',
        body: JSON.stringify({ target: 'row', rowId: row.id, cells: { [columnId]: value } }),
      });
    } catch (err: any) {
      toast.error(err.message || 'That change could not be saved');
      reload().catch(() => undefined);
    }
  }, [columns, rows, request, onChanged, reload]);

  const addRow = useCallback(async () => {
    setBusy(true);
    try {
      const created = await request({ method: 'POST', body: JSON.stringify({ target: 'row' }) });
      onChanged({ columns, rows: [...rows, created] });
    } catch (err: any) {
      toast.error(err.message || 'Could not add a row');
    } finally {
      setBusy(false);
    }
  }, [columns, rows, request, onChanged]);

  const deleteRow = useCallback(async (row: SheetRow) => {
    try {
      await request({ method: 'DELETE', query: `?rowId=${row.id}` });
      onChanged({ columns, rows: rows.filter(r => r.id !== row.id) });
    } catch (err: any) {
      toast.error(err.message || 'Could not delete the row');
    }
  }, [columns, rows, request, onChanged]);

  const deleteColumn = useCallback(async (column: SheetColumn) => {
    try {
      await request({ method: 'DELETE', query: `?columnId=${column.id}` });
      await reload();
      toast.success(`Removed "${column.name}"`);
    } catch (err: any) {
      toast.error(err.message || 'Could not delete the column');
    }
  }, [request, reload]);

  const submitColumn = useCallback(async (values: {
    name: string; type: SheetColumn['type']; options: string[];
  }) => {
    setBusy(true);
    try {
      if (columnDialog?.mode === 'edit' && columnDialog.column) {
        await request({
          method: 'PATCH',
          body: JSON.stringify({ target: 'column', columnId: columnDialog.column.id, ...values }),
        });
      } else {
        await request({ method: 'POST', body: JSON.stringify({ target: 'column', ...values }) });
      }
      await reload();
      setColumnDialog(null);
    } catch (err: any) {
      toast.error(err.message || 'Could not save the column');
    } finally {
      setBusy(false);
    }
  }, [columnDialog, request, reload]);

  // ─── Render ──────────────────────────────────────────────────────────────

  if (!columns.length) {
    return (
      <EmptyState
        icon={ListChecks}
        title="This sheet has no columns yet"
        description="Add a column to start recording data."
        action={canEdit ? { label: 'Add column', onClick: () => setColumnDialog({ mode: 'new' }) } : undefined}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'row' : 'rows'} · {columns.length} columns
          {!canEdit && <span className="ml-2 italic">Read only</span>}
        </p>
        {canEdit && (
          <Button variant="outline" size="sm" className="gap-1.5"
            onClick={() => setColumnDialog({ mode: 'new' })}>
            <Plus className="size-3.5" /> Column
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/60">
              <th className="w-10 border-r p-2 text-center text-xs font-medium text-muted-foreground">#</th>
              {columns.map((column) => {
                const Icon = typeIcon(column.type);
                return (
                  <th key={column.id} className="border-r p-0 text-left font-medium"
                      style={{ minWidth: column.width }}>
                    <div className="flex items-center gap-1.5 px-2.5 py-2">
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate text-xs">{column.name}</span>
                      {canEdit && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-5 shrink-0">
                              <ChevronDown className="size-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setColumnDialog({ mode: 'edit', column })}>
                              Edit column
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive"
                              onClick={() => deleteColumn(column)}>
                              <Trash2 className="mr-2 size-3.5" /> Delete column
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </th>
                );
              })}
              {canEdit && <th className="w-10 p-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id} className="border-b last:border-0 hover:bg-accent/30">
                <td className="border-r p-2 text-center font-mono text-xs text-muted-foreground">
                  {index + 1}
                </td>
                {columns.map((column) => (
                  <td key={column.id} className="border-r p-0 align-middle">
                    <Cell
                      column={column}
                      value={row.cells?.[column.id]}
                      members={members}
                      readOnly={!canEdit}
                      onCommit={(value) => saveCell(row, column.id, value)}
                    />
                  </td>
                ))}
                {canEdit && (
                  <td className="p-1 text-center">
                    <Button variant="ghost" size="icon"
                      className="size-6 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteRow(row)} title="Delete row">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + (canEdit ? 2 : 1)}
                    className="p-6 text-center text-sm text-muted-foreground">
                  No rows yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <Button variant="outline" size="sm" className="gap-1.5" onClick={addRow} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Row
        </Button>
      )}

      <ColumnDialog
        key={columnDialog ? `${columnDialog.mode}-${columnDialog.column?.id ?? 'new'}` : 'closed'}
        state={columnDialog}
        onClose={() => setColumnDialog(null)}
        onSubmit={submitColumn}
        isSaving={busy}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Cell editors
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One cell.
 *
 * Text-like types keep local state while focused so the caret does not jump to
 * the end on every render, and commit on blur or Enter. Discrete types
 * (checkbox, select, person) commit immediately: there is no partial state to
 * protect, and waiting for a blur that may never come loses the change.
 */
function Cell({
  column, value, members, readOnly, onCommit,
}: {
  column: SheetColumn;
  value: unknown;
  members: DirectoryMember[];
  readOnly: boolean;
  onCommit: (value: unknown) => void;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  /**
   * Focus is state rather than a ref because it is read during render below,
   * and because focusing already causes a render — there is nothing to save by
   * hiding it in a ref.
   */
  const [isFocused, setIsFocused] = useState(false);

  /**
   * Take the server's value back, unless this cell is being typed in.
   *
   * Adjusted during render rather than in an effect: an effect here cascades a
   * second render for every cell on every refresh, and the guard on focus is
   * what stops a save round-trip from yanking the caret out from under whoever
   * is mid-word.
   */
  const [lastSeen, setLastSeen] = useState(value);
  if (!isFocused && value !== lastSeen) {
    setLastSeen(value);
    setDraft(value == null ? '' : String(value));
  }

  if (column.type === 'checkbox') {
    return (
      <div className="flex items-center justify-center py-2">
        <Checkbox
          checked={value === true || value === 'true'}
          disabled={readOnly}
          onCheckedChange={(checked) => onCommit(checked === true)}
        />
      </div>
    );
  }

  if (column.type === 'select') {
    const options = Array.isArray(column.options) ? column.options : [];
    if (readOnly) {
      return <div className="px-2.5 py-2">{value ? <Badge variant="outline">{String(value)}</Badge> : null}</div>;
    }
    return (
      <Select
        value={value ? String(value) : '_empty'}
        onValueChange={(next) => onCommit(next === '_empty' ? '' : next)}
      >
        <SelectTrigger className="h-9 rounded-none border-0 bg-transparent px-2.5 shadow-none focus:ring-0">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_empty">—</SelectItem>
          {options.map(option => (
            <SelectItem key={option} value={option}>{option}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (column.type === 'member') {
    if (readOnly) {
      const person = members.find(m => m.memberId === value);
      return <div className="px-2.5 py-2 text-sm">{person?.fullName ?? '—'}</div>;
    }
    return (
      <Select
        value={value ? String(value) : '_empty'}
        onValueChange={(next) => onCommit(next === '_empty' ? '' : next)}
      >
        <SelectTrigger className="h-9 rounded-none border-0 bg-transparent px-2.5 shadow-none focus:ring-0">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_empty">Unassigned</SelectItem>
          {members.map(member => (
            <SelectItem key={member.memberId} value={member.memberId}>{member.fullName}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (readOnly) {
    return (
      <div className="px-2.5 py-2 text-sm">
        {column.type === 'currency' && value !== '' && value != null
          ? formatCurrency(Number(value) || 0)
          : (value == null ? '' : String(value))}
      </div>
    );
  }

  const inputType = column.type === 'date' ? 'date'
    : column.type === 'number' || column.type === 'currency' ? 'number'
    : column.type === 'url' ? 'url'
    : 'text';

  return (
    <input
      type={inputType}
      value={draft}
      onFocus={() => setIsFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setIsFocused(false);
        onCommit(inputType === 'number' && draft !== '' ? Number(draft) : draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value == null ? '' : String(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cn(
        'w-full bg-transparent px-2.5 py-2 text-sm outline-none',
        'focus:bg-emerald-50/60 focus:ring-1 focus:ring-inset focus:ring-emerald-500',
        'dark:focus:bg-emerald-950/20',
      )}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Column dialog
// ═══════════════════════════════════════════════════════════════════════════

function ColumnDialog({
  state, onClose, onSubmit, isSaving,
}: {
  state: { mode: 'new' | 'edit'; column?: SheetColumn } | null;
  onClose: () => void;
  onSubmit: (values: { name: string; type: SheetColumn['type']; options: string[] }) => void;
  isSaving: boolean;
}) {
  // Initialised from props rather than synced by an effect; the caller remounts
  // this with a `key` when the target column changes.
  const [name, setName] = useState(state?.column?.name ?? '');
  const [type, setType] = useState<SheetColumn['type']>(state?.column?.type ?? 'text');
  const [options, setOptions] = useState((state?.column?.options ?? []).join('\n'));

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state?.mode === 'edit' ? 'Edit column' : 'New column'}</DialogTitle>
          <DialogDescription>
            The type decides how each cell is entered and displayed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="column-name">Name</Label>
            <Input id="column-name" value={name} autoFocus
              onChange={(e) => setName(e.target.value)} placeholder="e.g. Amount" />
          </div>

          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as SheetColumn['type'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {COLUMN_TYPES.map(({ value, label, icon: Icon }) => (
                  <SelectItem key={value} value={value}>
                    <span className="flex items-center gap-2">
                      <Icon className="size-3.5" /> {label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type === 'select' && (
            <div className="space-y-2">
              <Label htmlFor="column-options">Choices</Label>
              <textarea
                id="column-options"
                value={options}
                onChange={(e) => setOptions(e.target.value)}
                rows={4}
                placeholder={'Not started\nIn progress\nDone'}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              <p className="text-xs text-muted-foreground">One per line.</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!name.trim() || isSaving}
            onClick={() => onSubmit({
              name: name.trim(),
              type,
              options: type === 'select'
                ? options.split('\n').map(o => o.trim()).filter(Boolean)
                : [],
            })}
          >
            {isSaving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            {state?.mode === 'edit' ? 'Save' : 'Add column'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
