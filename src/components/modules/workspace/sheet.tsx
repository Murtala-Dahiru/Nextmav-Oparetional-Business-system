'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Plus, Trash2, ChevronDown, Type, Hash, CalendarDays, ListChecks,
  CheckSquare, User, Link2, Coins, Loader2, ArrowUpDown, ArrowUp, ArrowDown,
  Filter, Pin, PinOff, EyeOff, Eye, Sigma, AlignLeft, AlignCenter, AlignRight,
  FunctionSquare, Search, X, Copy, Table as TableIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { formatCurrency, formatDay } from '@/lib/format';
import { cn } from '@/lib/utils';


import { evaluateFormula, formulaReferences } from './formula';
import type { SheetColumn, SheetRow, DirectoryMember } from './types';

/**
 * ===========================================================================
 *  The spreadsheet
 * ===========================================================================
 *
 *  -- What this replaces ---------------------------------------------------
 *
 *  A `<table>` of `<input>` elements. Every cell was reachable only by
 *  clicking it, there was no selection, arrow keys moved the caret inside a
 *  cell rather than between cells, copy and paste worked one cell at a time,
 *  columns could not be resized, nothing could be sorted or filtered, and a
 *  sheet wider than the screen scrolled its header away.
 *
 *  It was a form that happened to be laid out in a grid. This is a grid.
 *
 *  -- What did not change --------------------------------------------------
 *
 *  The data model. Columns are rows in `workspace_sheet_columns`, a row's
 *  values are jsonb keyed by column id, cells commit on blur and on Enter, and
 *  every write goes through the same `target: 'row' | 'column'` endpoint. The
 *  five columns 0035 adds - alignment, decimals, a formula, an aggregate and
 *  a freeze flag - are all *presentation* of data that was already stored.
 *
 *  -- Sorting and filtering are views, not writes --------------------------
 *
 *  Sorting reorders what is drawn and leaves `position` alone. That is the
 *  difference between "show me the biggest first" and "renumber my rows", and
 *  a grid that silently did the second the first time somebody clicked a
 *  header would be one nobody could undo. The header says when a sort is on.
 */

/* -------------------------------------------------------------------------- */
/*  Column types                                                              */
/* -------------------------------------------------------------------------- */

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

const AGGREGATES = [
  { value: 'none', label: 'No total' },
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Lowest' },
  { value: 'max', label: 'Highest' },
  { value: 'count', label: 'Row count' },
  { value: 'filled', label: 'Filled cells' },
] as const;

function typeIcon(type: SheetColumn['type']) {
  return COLUMN_TYPES.find(t => t.value === type)?.icon ?? Type;
}

const NUMERIC = new Set(['number', 'currency']);

/** Where a value sits in its cell, unless the column says otherwise. */
function alignOf(column: SheetColumn): 'left' | 'center' | 'right' {
  if (column.align) return column.align;
  if (NUMERIC.has(column.type)) return 'right';
  if (column.type === 'checkbox') return 'center';
  return 'left';
}

/* -------------------------------------------------------------------------- */
/*  Reading and writing a value                                               */
/* -------------------------------------------------------------------------- */

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  const n = Number(String(value ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * What a cell shows.
 *
 * Formatting lives here and not in the editor, so a cell being typed into
 * shows the raw number and a cell at rest shows the formatted one - which is
 * the only arrangement where "1234.5" can be typed and "₦1,234.50" read back.
 */
function display(
  column: SheetColumn,
  value: unknown,
  members: DirectoryMember[],
): string {
  if (value === null || value === undefined || value === '') return '';

  if (column.type === 'member') {
    return members.find(m => m.memberId === value)?.fullName ?? '';
  }
  if (column.type === 'date') return formatDay(String(value));
  if (column.type === 'currency') {
    const n = asNumber(value);
    const text = formatCurrency(n);
    // The column's own decimal setting wins over the currency's default two,
    // because a budget in whole naira is a column of ".00" nobody reads past.
    if (column.decimals === null || column.decimals === undefined) return text;
    return text.replace(/([.,])\d+$/, column.decimals > 0
      ? `$1${n.toFixed(column.decimals).split('.')[1]}`
      : '');
  }
  if (column.type === 'number') {
    const n = asNumber(value);
    return column.decimals === null || column.decimals === undefined
      ? String(value)
      : n.toFixed(column.decimals);
  }
  return String(value);
}

/* -------------------------------------------------------------------------- */
/*  Props                                                                     */
/* -------------------------------------------------------------------------- */

interface SheetProps {
  pageId: string;
  columns: SheetColumn[];
  rows: SheetRow[];
  members: DirectoryMember[];
  canEdit: boolean;
  onChanged: (next: { columns: SheetColumn[]; rows: SheetRow[] }) => void;
}

type Cursor = { row: number; col: number } | null;

export function Sheet({ pageId, columns, rows, members, canEdit, onChanged }: SheetProps) {
  const [busy, setBusy] = React.useState(false);
  const [columnDialog, setColumnDialog] = React.useState<{ mode: 'new' | 'edit'; column?: SheetColumn } | null>(null);

  // -- View state: none of this is written back -----------------------------
  const [sort, setSort] = React.useState<{ columnId: string; dir: 'asc' | 'desc' } | null>(null);
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [search, setSearch] = React.useState('');
  const [filterBar, setFilterBar] = React.useState(false);

  // -- Selection ------------------------------------------------------------
  const [cursor, setCursor] = React.useState<Cursor>(null);
  const [anchor, setAnchor] = React.useState<Cursor>(null);
  const [editing, setEditing] = React.useState<{ row: number; col: number; seed?: string } | null>(null);

  const gridRef = React.useRef<HTMLDivElement | null>(null);

  const request = React.useCallback(async (init: RequestInit & { query?: string }) => {
    const res = await fetch(`/api/workspace/pages/${pageId}/sheet${init.query ?? ''}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'Request failed');
    return json.data;
  }, [pageId]);

  const reload = React.useCallback(async () => {
    const data = await request({ method: 'GET' });
    onChanged({ columns: data.columns ?? [], rows: data.rows ?? [] });
  }, [request, onChanged]);

  /* ---------------------------------------------------------------------- */
  /*  What is actually drawn                                                */
  /* ---------------------------------------------------------------------- */

  const visible = React.useMemo(
    () => columns.filter(c => !c.isHidden).sort((a, b) => a.position - b.position),
    [columns],
  );

  const frozenCount = React.useMemo(
    () => {
      // Only a leading run of frozen columns can be frozen: a sticky column in
      // the middle of a scrolling region slides over its neighbours, which
      // looks like a rendering fault rather than a feature.
      let n = 0;
      for (const column of visible) { if (!column.isFrozen) break; n++; }
      return n;
    },
    [visible],
  );

  const columnNames = React.useMemo(() => visible.map(c => c.name), [visible]);

  /**
   * Every row's computed columns, resolved left to right.
   *
   * A formula sees the stored cells plus whatever earlier formula columns have
   * already produced, which is what lets `Margin` be `=Revenue - Cost` and
   * `Margin %` be `=Margin / Revenue * 100`. It cannot see columns to its
   * right, so a cycle cannot be written.
   */
  const computed = React.useMemo(() => {
    const out = new Map<string, Map<string, { value: number | null; error?: string }>>();
    const formulaColumns = visible.filter(c => c.formula);
    if (!formulaColumns.length) return out;

    for (const row of rows) {
      const inputs: Record<string, number> = {};
      for (const column of visible) {
        if (!column.formula) {
          const raw = row.cells?.[column.id];
          if (raw !== undefined && raw !== null && raw !== '') {
            inputs[column.name.toLowerCase()] = asNumber(raw);
          }
          continue;
        }
        const result = evaluateFormula(column.formula, columnNames, inputs);
        if (result.value !== null) inputs[column.name.toLowerCase()] = result.value;
        const forRow = out.get(row.id) ?? new Map();
        forRow.set(column.id, result);
        out.set(row.id, forRow);
      }
    }
    return out;
  }, [rows, visible, columnNames]);

  const cellValue = React.useCallback((row: SheetRow, column: SheetColumn): unknown => {
    if (column.formula) {
      const result = computed.get(row.id)?.get(column.id);
      return result?.value ?? null;
    }
    return row.cells?.[column.id];
  }, [computed]);

  const shown = React.useMemo(() => {
    let list = rows;

    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter(row => visible.some(column => {
        const text = display(column, cellValue(row, column), members).toLowerCase();
        return text.includes(term);
      }));
    }

    for (const [columnId, wanted] of Object.entries(filters)) {
      if (!wanted) continue;
      const column = visible.find(c => c.id === columnId);
      if (!column) continue;
      const needle = wanted.toLowerCase();
      list = list.filter(row => {
        const text = display(column, cellValue(row, column), members).toLowerCase();
        // A select filter is exact; free text is a contains, because nobody
        // types a whole cell to narrow a list.
        return column.type === 'select' || column.type === 'checkbox'
          ? text === needle
          : text.includes(needle);
      });
    }

    if (sort) {
      const column = visible.find(c => c.id === sort.columnId);
      if (column) {
        const factor = sort.dir === 'asc' ? 1 : -1;
        list = [...list].sort((a, b) => {
          const av = cellValue(a, column);
          const bv = cellValue(b, column);
          const empty = (v: unknown) => v === null || v === undefined || v === '';
          // Empty always sorts last, in both directions. A descending sort
          // that opens on forty blank rows has answered nothing.
          if (empty(av) && empty(bv)) return 0;
          if (empty(av)) return 1;
          if (empty(bv)) return -1;
          if (NUMERIC.has(column.type) || column.formula) {
            return (asNumber(av) - asNumber(bv)) * factor;
          }
          return display(column, av, members)
            .localeCompare(display(column, bv, members), undefined, { numeric: true }) * factor;
        });
      }
    }

    return list;
  }, [rows, visible, filters, search, sort, members, cellValue]);

  /* ---------------------------------------------------------------------- */
  /*  Writing                                                               */
  /* ---------------------------------------------------------------------- */

  const saveCells = React.useCallback(async (
    edits: { rowId: string; columnId: string; value: unknown }[],
  ) => {
    if (!edits.length) return;

    const byRow = new Map<string, Record<string, unknown>>();
    for (const edit of edits) {
      byRow.set(edit.rowId, { ...(byRow.get(edit.rowId) ?? {}), [edit.columnId]: edit.value });
    }

    // Local first, so the grid does not flash back to the old value while the
    // request is in flight.
    onChanged({
      columns,
      rows: rows.map(r => (byRow.has(r.id) ? { ...r, cells: { ...r.cells, ...byRow.get(r.id) } } : r)),
    });

    try {
      // One request per row rather than per cell: pasting a block of forty
      // values into eight rows is eight requests, not forty.
      await Promise.all([...byRow.entries()].map(([rowId, cells]) =>
        request({ method: 'PATCH', body: JSON.stringify({ target: 'row', rowId, cells }) })));
    } catch (err: any) {
      toast.error(err.message || 'That change could not be saved');
      reload().catch(() => undefined);
    }
  }, [columns, rows, request, onChanged, reload]);

  const addRow = React.useCallback(async (count = 1) => {
    setBusy(true);
    try {
      const created: SheetRow[] = [];
      for (let i = 0; i < count; i++) {
        created.push(await request({ method: 'POST', body: JSON.stringify({ target: 'row' }) }));
      }
      onChanged({ columns, rows: [...rows, ...created] });
      return created;
    } catch (err: any) {
      toast.error(err.message || 'Could not add a row');
      return [];
    } finally {
      setBusy(false);
    }
  }, [columns, rows, request, onChanged]);

  const deleteRows = React.useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const keep = rows.filter(r => !ids.includes(r.id));
    onChanged({ columns, rows: keep });
    try {
      await Promise.all(ids.map(id => request({ method: 'DELETE', query: `?rowId=${id}` })));
    } catch (err: any) {
      toast.error(err.message || 'Could not delete');
      reload().catch(() => undefined);
    }
  }, [columns, rows, request, onChanged, reload]);

  const patchColumn = React.useCallback(async (column: SheetColumn, values: Record<string, unknown>) => {
    onChanged({
      columns: columns.map(c => (c.id === column.id ? { ...c, ...values } as SheetColumn : c)),
      rows,
    });
    try {
      await request({
        method: 'PATCH',
        body: JSON.stringify({ target: 'column', columnId: column.id, ...values }),
      });
    } catch (err: any) {
      toast.error(err.message || 'Could not update the column');
      reload().catch(() => undefined);
    }
  }, [columns, rows, request, onChanged, reload]);

  /**
   * Freezing is a boundary, not a per-column toggle.
   *
   * Only a leading run can be frozen - a sticky column in the middle of a
   * scrolling region slides over its neighbours and reads as a rendering
   * fault - so "freeze up to here" sets the flag on everything from the left
   * edge to this column, and unfreezing clears it from here rightwards. A
   * plain toggle would let somebody freeze the fourth column alone and see
   * something that looks broken.
   */
  const freezeThrough = React.useCallback(async (index: number, on: boolean) => {
    const affected = visible
      .map((column, i) => ({ column, i }))
      .filter(({ column, i }) => (on ? i <= index : i >= index) && column.isFrozen !== on);
    if (!affected.length) return;

    onChanged({
      columns: columns.map(c => (
        affected.some(a => a.column.id === c.id) ? { ...c, isFrozen: on } : c
      )),
      rows,
    });

    try {
      await Promise.all(affected.map(({ column }) => request({
        method: 'PATCH',
        body: JSON.stringify({ target: 'column', columnId: column.id, isFrozen: on }),
      })));
    } catch (err: any) {
      toast.error(err.message || 'Could not change the frozen columns');
      reload().catch(() => undefined);
    }
  }, [visible, columns, rows, request, onChanged, reload]);

  const deleteColumn = React.useCallback(async (column: SheetColumn) => {
    try {
      await request({ method: 'DELETE', query: `?columnId=${column.id}` });
      await reload();
      toast.success(`Removed "${column.name}"`);
    } catch (err: any) {
      toast.error(err.message || 'Could not delete the column');
    }
  }, [request, reload]);

  const submitColumn = React.useCallback(async (values: {
    name: string; type: SheetColumn['type']; options: string[];
    formula: string | null; aggregate: string; align: string | null; decimals: number | null;
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

  /* ---------------------------------------------------------------------- */
  /*  Selection and the keyboard                                            */
  /* ---------------------------------------------------------------------- */

  const range = React.useMemo(() => {
    if (!cursor) return null;
    const other = anchor ?? cursor;
    return {
      top: Math.min(cursor.row, other.row),
      bottom: Math.max(cursor.row, other.row),
      left: Math.min(cursor.col, other.col),
      right: Math.max(cursor.col, other.col),
    };
  }, [cursor, anchor]);

  const inRange = React.useCallback((row: number, col: number) => (
    !!range && row >= range.top && row <= range.bottom && col >= range.left && col <= range.right
  ), [range]);

  const move = React.useCallback((dRow: number, dCol: number, extend: boolean) => {
    setCursor(prev => {
      const from = prev ?? { row: 0, col: 0 };
      const next = {
        row: Math.max(0, Math.min(shown.length - 1, from.row + dRow)),
        col: Math.max(0, Math.min(visible.length - 1, from.col + dCol)),
      };
      if (!extend) setAnchor(null);
      else if (!anchor) setAnchor(from);
      return next;
    });
  }, [shown.length, visible.length, anchor]);

  /**
   * The selection as tab-separated text.
   *
   * TSV rather than CSV because that is what a spreadsheet puts on the
   * clipboard and what Excel, Numbers and Google Sheets all read back without
   * a dialog asking about delimiters.
   */
  const selectionText = React.useCallback(() => {
    if (!range) return '';
    const lines: string[] = [];
    for (let r = range.top; r <= range.bottom; r++) {
      const row = shown[r];
      if (!row) continue;
      const cells: string[] = [];
      for (let c = range.left; c <= range.right; c++) {
        const column = visible[c];
        if (!column) continue;
        cells.push(display(column, cellValue(row, column), members).replace(/[\t\n]/g, ' '));
      }
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  }, [range, shown, visible, members, cellValue]);

  /**
   * Paste a block, growing the sheet if it does not fit.
   *
   * A person copying twelve rows out of Excel into a nine-row sheet means to
   * end up with twelve rows. Refusing the overflow, or silently dropping it,
   * is the behaviour that makes people stop trusting a grid.
   */
  const pasteAt = React.useCallback(async (text: string, at: { row: number; col: number }) => {
    const block = text.replace(/\r/g, '').split('\n').filter((line, i, all) => line !== '' || i < all.length - 1);
    if (!block.length) return;

    const needed = at.row + block.length - shown.length;
    let target = shown;
    if (needed > 0) {
      const created = await addRow(needed);
      if (created.length < needed) return;
      target = [...shown, ...created];
    }

    const edits: { rowId: string; columnId: string; value: unknown }[] = [];
    block.forEach((line, r) => {
      const row = target[at.row + r];
      if (!row) return;
      line.split('\t').forEach((raw, c) => {
        const column = visible[at.col + c];
        if (!column || column.formula) return;
        edits.push({ rowId: row.id, columnId: column.id, value: coerce(column, raw) });
      });
    });

    await saveCells(edits);
    toast.success(`Pasted ${block.length} ${block.length === 1 ? 'row' : 'rows'}`);
  }, [shown, visible, addRow, saveCells]);

  const onGridKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (editing) return;
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'c') {
      const text = selectionText();
      if (text) {
        void navigator.clipboard.writeText(text).catch(() => undefined);
        e.preventDefault();
      }
      return;
    }

    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setAnchor({ row: 0, col: 0 });
      setCursor({ row: shown.length - 1, col: visible.length - 1 });
      return;
    }

    if (mod && e.key.toLowerCase() === 'v') {
      if (!canEdit || !cursor) return;
      e.preventDefault();
      void navigator.clipboard.readText()
        .then(text => pasteAt(text, cursor))
        .catch(() => toast.error('The clipboard could not be read. Use Ctrl+V in the cell instead.'));
      return;
    }

    const keys: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    };
    if (keys[e.key]) {
      e.preventDefault();
      const [dr, dc] = keys[e.key];
      if (mod) {
        // Jump to the edge, the way a spreadsheet does.
        setAnchor(e.shiftKey ? (anchor ?? cursor) : null);
        setCursor(prev => ({
          row: dr === 0 ? (prev?.row ?? 0) : dr < 0 ? 0 : shown.length - 1,
          col: dc === 0 ? (prev?.col ?? 0) : dc < 0 ? 0 : visible.length - 1,
        }));
        return;
      }
      move(dr, dc, e.shiftKey);
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      move(0, e.shiftKey ? -1 : 1, false);
      return;
    }

    if (e.key === 'Home') { e.preventDefault(); setAnchor(null); setCursor(p => ({ row: p?.row ?? 0, col: 0 })); return; }
    if (e.key === 'End') { e.preventDefault(); setAnchor(null); setCursor(p => ({ row: p?.row ?? 0, col: visible.length - 1 })); return; }

    if (e.key === 'Enter' || e.key === 'F2') {
      if (!cursor || !canEdit) return;
      const column = visible[cursor.col];
      if (!column || column.formula) return;
      e.preventDefault();
      setEditing({ row: cursor.row, col: cursor.col });
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit && range) {
      e.preventDefault();
      const edits: { rowId: string; columnId: string; value: unknown }[] = [];
      for (let r = range.top; r <= range.bottom; r++) {
        for (let c = range.left; c <= range.right; c++) {
          const row = shown[r];
          const column = visible[c];
          if (row && column && !column.formula) {
            edits.push({ rowId: row.id, columnId: column.id, value: '' });
          }
        }
      }
      void saveCells(edits);
      return;
    }

    /*
      Typing a printable character starts editing with that character.

      Without it, entering a value means clicking the cell, clicking again to
      focus the input, then typing - which is the single thing that makes a
      grid feel unlike a spreadsheet.
    */
    if (!mod && !e.altKey && e.key.length === 1 && canEdit && cursor) {
      const column = visible[cursor.col];
      if (!column || column.formula || column.type === 'checkbox') return;
      e.preventDefault();
      setEditing({ row: cursor.row, col: cursor.col, seed: e.key });
    }
  }, [editing, cursor, anchor, range, shown, visible, canEdit, move, selectionText, pasteAt, saveCells]);

  /* ---------------------------------------------------------------------- */
  /*  Column widths                                                         */
  /* ---------------------------------------------------------------------- */

  /**
   * A drag on the header's right edge.
   *
   * The width is kept in local state while the pointer is down and written
   * once on release: one PATCH per drag rather than one per pixel.
   */
  const [dragging, setDragging] = React.useState<{ id: string; startX: number; startWidth: number } | null>(null);
  const [draftWidth, setDraftWidth] = React.useState<Record<string, number>>({});

  React.useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const next = Math.max(60, Math.min(900, dragging.startWidth + (e.clientX - dragging.startX)));
      setDraftWidth(prev => ({ ...prev, [dragging.id]: next }));
    };
    const onUp = () => {
      const width = draftWidthRef.current[dragging.id];
      const column = columns.find(c => c.id === dragging.id);
      if (column && width && width !== column.width) void patchColumn(column, { width });
      setDragging(null);
      setDraftWidth({});
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, columns, patchColumn]);

  // The pointerup handler is registered once and would otherwise close over the
  // widths as they were when the drag began.
  const draftWidthRef = React.useRef(draftWidth);
  React.useEffect(() => { draftWidthRef.current = draftWidth; }, [draftWidth]);

  const widthOf = (column: SheetColumn) => draftWidth[column.id] ?? column.width;

  /** How far from the left a frozen column sits. */
  const frozenOffset = React.useCallback((index: number) => {
    let offset = 44; // the row-number gutter
    for (let i = 0; i < index; i++) offset += widthOf(visible[i]);
    return offset;
  }, [visible, draftWidth]);

  /* ---------------------------------------------------------------------- */
  /*  Totals                                                                */
  /* ---------------------------------------------------------------------- */

  const totals = React.useMemo(() => {
    const out = new Map<string, string>();
    for (const column of visible) {
      if (column.aggregate === 'none') continue;
      const values = shown.map(row => cellValue(row, column));
      const filled = values.filter(v => v !== null && v !== undefined && v !== '');

      if (column.aggregate === 'count') { out.set(column.id, String(shown.length)); continue; }
      if (column.aggregate === 'filled') { out.set(column.id, String(filled.length)); continue; }

      const numbers = filled.map(asNumber);
      if (!numbers.length) { out.set(column.id, '-'); continue; }

      const value =
        column.aggregate === 'sum' ? numbers.reduce((a, b) => a + b, 0)
          : column.aggregate === 'avg' ? numbers.reduce((a, b) => a + b, 0) / numbers.length
            : column.aggregate === 'min' ? Math.min(...numbers)
              : Math.max(...numbers);

      /*
        A total is formatted by the same rules as the cells above it.

        `display` already knows what the column's decimals setting means, and
        a footer that prints ₦323,600,000.00 under a column of ₦148,000,000 is
        the small inconsistency that makes a grid look assembled rather than
        designed.
      */
      out.set(column.id, display(column, value, members));
    }
    return out;
  }, [visible, shown, cellValue, members]);

  /* ---------------------------------------------------------------------- */
  /*  Render                                                                */
  /* ---------------------------------------------------------------------- */

  if (!columns.length) {
    return (
      <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
        <TableIcon className="mx-auto mb-3 size-6 text-muted-foreground" />
        <p className="text-[13.5px] font-medium">This sheet has no columns yet</p>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-muted-foreground">
          A column is a field: a name, an amount, a date, an owner. Add the first one and the
          grid appears under it.
        </p>
        {canEdit && (
          <Button size="sm" className="mt-4 gap-1.5" onClick={() => setColumnDialog({ mode: 'new' })}>
            <Plus className="size-3.5" /> Add a column
          </Button>
        )}
        <ColumnDialog
          key={columnDialog ? 'open' : 'closed'}
          state={columnDialog}
          columns={columns}
          onClose={() => setColumnDialog(null)}
          onSubmit={submitColumn}
          isSaving={busy}
        />
      </div>
    );
  }

  const activeFilters = Object.values(filters).filter(Boolean).length + (search.trim() ? 1 : 0);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {/* -- Toolbar -- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find in this sheet"
            className="h-8 pl-8 text-[13px]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <Button
          variant={filterBar ? 'secondary' : 'outline'} size="sm" className="h-8 gap-1.5 text-[12.5px]"
          onClick={() => setFilterBar(v => !v)}
        >
          <Filter className="size-3.5" />
          Filters
          {activeFilters > 0 && (
            <span className="rounded bg-foreground px-1 text-[10px] font-semibold tabular-nums text-background">
              {activeFilters}
            </span>
          )}
        </Button>

        {sort && (
          <button
            type="button"
            onClick={() => setSort(null)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {sort.dir === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
            {visible.find(c => c.id === sort.columnId)?.name ?? 'Sorted'}
            <X className="size-3" />
          </button>
        )}

        <span className="ml-auto text-[11.5px] tabular-nums text-muted-foreground">
          {shown.length === rows.length
            ? `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`
            : `${shown.length} of ${rows.length} rows`}
          {!canEdit && <span className="ml-2">Read only</span>}
        </span>

        {canEdit && (
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12.5px]"
            onClick={() => setColumnDialog({ mode: 'new' })}>
            <Plus className="size-3.5" /> Column
          </Button>
        )}
      </div>

      {/* -- The grid -- */}
      <div
        ref={gridRef}
        tabIndex={0}
        role="grid"
        aria-rowcount={shown.length + 1}
        aria-colcount={visible.length}
        onKeyDown={onGridKeyDown}
        className={cn(
          'relative max-h-[70vh] overflow-auto rounded-md border border-border bg-card',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]',
          // Momentum scrolling on iOS, and a scrollbar that does not sit over
          // the last column on Windows.
          '[scrollbar-gutter:stable]',
        )}
      >
        <table className="w-max border-collapse text-[13px]">
          <thead className="sticky top-0 z-20">
            <tr>
              <th
                className="sticky left-0 z-30 w-11 border-b border-r border-border bg-muted px-0 py-0 text-center"
                style={{ minWidth: 44 }}
              >
                <span className="sr-only">Row</span>
              </th>
              {visible.map((column, index) => {
                const Icon = column.formula ? FunctionSquare : typeIcon(column.type);
                const sorted = sort?.columnId === column.id ? sort.dir : null;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    className={cn(
                      'relative border-b border-r border-border bg-muted p-0 text-left align-middle font-medium',
                      index < frozenCount && 'sticky z-20',
                    )}
                    style={{
                      width: widthOf(column),
                      minWidth: widthOf(column),
                      ...(index < frozenCount ? { left: frozenOffset(index) } : {}),
                    }}
                  >
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      <button
                        type="button"
                        onClick={() => setSort(prev => (
                          prev?.columnId === column.id
                            ? (prev.dir === 'asc' ? { columnId: column.id, dir: 'desc' } : null)
                            : { columnId: column.id, dir: 'asc' }
                        ))}
                        className="min-w-0 flex-1 truncate text-left text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground transition-colors hover:text-foreground"
                        title={column.formula ? `${column.name} = ${column.formula.replace(/^=/, '')}` : column.name}
                      >
                        {column.name}
                      </button>
                      {sorted
                        ? (sorted === 'asc'
                          ? <ArrowUp className="size-3 shrink-0 text-foreground" />
                          : <ArrowDown className="size-3 shrink-0 text-foreground" />)
                        : null}

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`${column.name} options`}
                            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 [th:hover_&]:opacity-100"
                          >
                            <ChevronDown className="size-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-56">
                          <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                            {column.name}
                          </DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => setSort({ columnId: column.id, dir: 'asc' })}>
                            <ArrowUp className="mr-2 size-3.5" /> Sort A to Z
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSort({ columnId: column.id, dir: 'desc' })}>
                            <ArrowDown className="mr-2 size-3.5" /> Sort Z to A
                          </DropdownMenuItem>
                          {sort?.columnId === column.id && (
                            <DropdownMenuItem onClick={() => setSort(null)}>
                              <ArrowUpDown className="mr-2 size-3.5" /> Clear sort
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {canEdit && (
                            <>
                              <DropdownMenuItem onClick={() => freezeThrough(index, !column.isFrozen)}>
                                {column.isFrozen
                                  ? <><PinOff className="mr-2 size-3.5" /> Unfreeze from here</>
                                  : <><Pin className="mr-2 size-3.5" /> Freeze up to here</>}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => patchColumn(column, { isHidden: true })}>
                                <EyeOff className="mr-2 size-3.5" /> Hide
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setColumnDialog({ mode: 'edit', column })}>
                                Edit column
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => deleteColumn(column)}
                              >
                                <Trash2 className="mr-2 size-3.5" /> Delete column
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* The resize handle. Wider than it looks, so it is
                        catchable with a mouse and with a thumb. */}
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${column.name}`}
                      onPointerDown={(e) => {
                        if (!canEdit) return;
                        e.preventDefault();
                        setDragging({ id: column.id, startX: e.clientX, startWidth: column.width });
                      }}
                      className={cn(
                        'absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize',
                        'after:absolute after:inset-y-0 after:left-1 after:w-px after:bg-transparent',
                        'hover:after:bg-[--ring]',
                        dragging?.id === column.id && 'after:bg-[--ring]',
                        !canEdit && 'hidden',
                      )}
                    />
                  </th>
                );
              })}
              {canEdit && <th className="w-10 border-b border-border bg-muted" />}
            </tr>

            {filterBar && (
              <tr>
                <th className="sticky left-0 z-30 border-b border-r border-border bg-card" />
                {visible.map((column, index) => (
                  <th
                    key={column.id}
                    className={cn('border-b border-r border-border bg-card p-1', index < frozenCount && 'sticky z-20')}
                    style={index < frozenCount ? { left: frozenOffset(index) } : undefined}
                  >
                    {column.type === 'select' ? (
                      <select
                        value={filters[column.id] ?? ''}
                        onChange={(e) => setFilters(p => ({ ...p, [column.id]: e.target.value }))}
                        className="h-7 w-full rounded border border-input bg-background px-1.5 text-[12px]"
                      >
                        <option value="">All</option>
                        {(column.options ?? []).map(option => (
                          <option key={option} value={option.toLowerCase()}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={filters[column.id] ?? ''}
                        onChange={(e) => setFilters(p => ({ ...p, [column.id]: e.target.value }))}
                        placeholder="Filter"
                        aria-label={`Filter ${column.name}`}
                        className="h-7 w-full rounded border border-input bg-background px-1.5 text-[12px] outline-none focus:border-[--ring]"
                      />
                    )}
                  </th>
                ))}
                {canEdit && <th className="border-b border-border bg-card" />}
              </tr>
            )}
          </thead>

          <tbody>
            {shown.map((row, rowIndex) => (
              <tr key={row.id} className="group">
                <td
                  className={cn(
                    'sticky left-0 z-10 border-b border-r border-border bg-card px-0 py-0 text-center',
                    'text-[11px] tabular-nums text-muted-foreground',
                    range && rowIndex >= range.top && rowIndex <= range.bottom && 'bg-accent',
                  )}
                  style={{ minWidth: 44 }}
                >
                  <div className="flex items-center justify-center gap-0.5">
                    <span className="group-hover:hidden">{rowIndex + 1}</span>
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`Delete row ${rowIndex + 1}`}
                        onClick={() => deleteRows([row.id])}
                        className="hidden rounded p-1 text-muted-foreground transition-colors hover:text-destructive group-hover:block"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </div>
                </td>

                {visible.map((column, colIndex) => {
                  const isCursor = cursor?.row === rowIndex && cursor?.col === colIndex;
                  const isEditing = editing?.row === rowIndex && editing?.col === colIndex;
                  const selected = inRange(rowIndex, colIndex);
                  const formulaError = column.formula
                    ? computed.get(row.id)?.get(column.id)?.error
                    : undefined;

                  return (
                    <td
                      key={column.id}
                      role="gridcell"
                      aria-selected={selected}
                      onMouseDown={(e) => {
                        if (e.shiftKey) { setAnchor(anchor ?? cursor); }
                        else { setAnchor(null); }
                        setCursor({ row: rowIndex, col: colIndex });
                        setEditing(null);
                        gridRef.current?.focus();
                      }}
                      onDoubleClick={() => {
                        if (canEdit && !column.formula && column.type !== 'checkbox') {
                          setEditing({ row: rowIndex, col: colIndex });
                        }
                      }}
                      className={cn(
                        'relative border-b border-r border-border p-0 align-middle',
                        colIndex < frozenCount && 'sticky z-10 bg-card',
                        selected && !isCursor && 'bg-[--ring]/8',
                        isCursor && 'z-[15]',
                        column.formula && 'bg-muted/30',
                      )}
                      style={{
                        width: widthOf(column),
                        minWidth: widthOf(column),
                        ...(colIndex < frozenCount ? { left: frozenOffset(colIndex) } : {}),
                      }}
                    >
                      {isCursor && (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 z-10 ring-2 ring-inset ring-[--ring]"
                        />
                      )}
                      <Cell
                        column={column}
                        value={cellValue(row, column)}
                        members={members}
                        readOnly={!canEdit || !!column.formula}
                        editing={isEditing}
                        seed={isEditing ? editing?.seed : undefined}
                        error={formulaError}
                        align={alignOf(column)}
                        onStartEdit={() => canEdit && !column.formula && setEditing({ row: rowIndex, col: colIndex })}
                        onCommit={(value, advance) => {
                          setEditing(null);
                          gridRef.current?.focus();
                          if (advance) move(1, 0, false);
                          const previous = row.cells?.[column.id];
                          if (previous === value || (previous == null && value === '')) return;
                          void saveCells([{ rowId: row.id, columnId: column.id, value }]);
                        }}
                        onCancel={() => { setEditing(null); gridRef.current?.focus(); }}
                      />
                    </td>
                  );
                })}
                {canEdit && <td className="border-b border-border" />}
              </tr>
            ))}

            {!shown.length && (
              <tr>
                <td
                  colSpan={visible.length + (canEdit ? 2 : 1)}
                  className="px-4 py-10 text-center text-[12.5px] text-muted-foreground"
                >
                  {rows.length
                    ? 'Nothing matches those filters.'
                    : 'No rows yet. Add one below to start.'}
                </td>
              </tr>
            )}
          </tbody>

          {totals.size > 0 && (
            <tfoot className="sticky bottom-0 z-20">
              <tr>
                <td className="sticky left-0 z-30 border-r border-t border-border bg-muted" style={{ minWidth: 44 }}>
                  <Sigma className="mx-auto size-3 text-muted-foreground" />
                </td>
                {visible.map((column, index) => (
                  <td
                    key={column.id}
                    className={cn(
                      'border-r border-t border-border bg-muted px-2.5 py-1.5 text-[12px] font-medium tabular-nums',
                      index < frozenCount && 'sticky z-20',
                    )}
                    style={{
                      textAlign: alignOf(column),
                      ...(index < frozenCount ? { left: frozenOffset(index) } : {}),
                    }}
                  >
                    {totals.get(column.id) ?? ''}
                  </td>
                ))}
                {canEdit && <td className="border-t border-border bg-muted" />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* -- Below the grid -- */}
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12.5px]"
              onClick={() => addRow(1)} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Row
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-[12.5px] text-muted-foreground"
              onClick={() => addRow(10)} disabled={busy}>
              Add 10
            </Button>
          </>
        )}

        {columns.some(c => c.isHidden) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[12.5px] text-muted-foreground">
                <Eye className="size-3.5" />
                {columns.filter(c => c.isHidden).length} hidden
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {columns.filter(c => c.isHidden).map(column => (
                <DropdownMenuItem key={column.id} onClick={() => patchColumn(column, { isHidden: false })}>
                  <Eye className="mr-2 size-3.5" /> Show {column.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {range && (range.top !== range.bottom || range.left !== range.right) && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(selectionText())
                .then(() => toast.success('Copied'))
                .catch(() => toast.error('The clipboard is not available here.'));
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Copy className="size-3.5" />
            Copy {(range.bottom - range.top + 1) * (range.right - range.left + 1)} cells
          </button>
        )}

        <p className="ml-auto hidden text-[11.5px] text-muted-foreground lg:block">
          Arrow keys move, Enter edits, Ctrl+C and Ctrl+V copy and paste
        </p>
      </div>

      <ColumnDialog
        key={columnDialog ? `${columnDialog.mode}-${columnDialog.column?.id ?? 'new'}` : 'closed'}
        state={columnDialog}
        columns={columns}
        onClose={() => setColumnDialog(null)}
        onSubmit={submitColumn}
        isSaving={busy}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  One cell                                                                  */
/* -------------------------------------------------------------------------- */

/** Turn typed text into the value a column of this type should store. */
function coerce(column: SheetColumn, raw: string): unknown {
  const text = raw.trim();
  if (!text) return '';
  if (NUMERIC.has(column.type)) {
    const n = Number(text.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : '';
  }
  if (column.type === 'checkbox') return /^(true|yes|y|1|✓)$/i.test(text);
  return text;
}

function Cell({
  column, value, members, readOnly, editing, seed, error, align,
  onStartEdit, onCommit, onCancel,
}: {
  column: SheetColumn;
  value: unknown;
  members: DirectoryMember[];
  readOnly: boolean;
  editing: boolean;
  seed?: string;
  error?: string;
  align: 'left' | 'center' | 'right';
  onStartEdit: () => void;
  onCommit: (value: unknown, advance: boolean) => void;
  onCancel: () => void;
}) {
  const padding = 'px-2.5 py-[7px]';
  const justify = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';

  /*
    Discrete types commit immediately and have no editing state.

    There is no partial value to protect in a checkbox or a picker, and
    waiting for a blur that may never come is how a change gets lost.
  */
  if (column.type === 'checkbox') {
    return (
      <div className={cn('flex items-center', padding, justify)}>
        <Checkbox
          checked={value === true || value === 'true'}
          disabled={readOnly}
          onCheckedChange={(checked) => onCommit(checked === true, false)}
        />
      </div>
    );
  }

  if ((column.type === 'select' || column.type === 'member') && !readOnly) {
    const options = column.type === 'select'
      ? (column.options ?? []).map(o => ({ value: o, label: o }))
      : members.map(m => ({ value: m.memberId, label: m.fullName }));

    return (
      <Select
        value={value ? String(value) : '_empty'}
        onValueChange={(next) => onCommit(next === '_empty' ? '' : next, false)}
      >
        <SelectTrigger className="h-8 rounded-none border-0 bg-transparent px-2.5 text-[13px] shadow-none focus:ring-0">
          <SelectValue placeholder="" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_empty">{column.type === 'member' ? 'Unassigned' : 'Empty'}</SelectItem>
          {options.map(option => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (editing) {
    return (
      <CellInput
        column={column}
        initial={seed ?? (value === null || value === undefined ? '' : String(value))}
        align={align}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );
  }

  const text = display(column, value, members);

  return (
    <div
      onClick={() => { if (!readOnly) onStartEdit(); }}
      className={cn(
        'flex min-h-[32px] items-center truncate', padding, justify,
        error && 'text-destructive',
        column.formula && !error && 'text-foreground',
      )}
      title={error ? error : text}
    >
      {error ? (
        <span className="text-[12px]">Formula error</span>
      ) : column.type === 'url' && text ? (
        <a
          href={/^https?:/i.test(text) ? text : `https://${text}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="truncate underline decoration-[--ring] underline-offset-2"
        >
          {text}
        </a>
      ) : (
        <span className="truncate">{text}</span>
      )}
    </div>
  );
}

/**
 * The editor inside a cell.
 *
 * Mounted only while the cell is being edited, which is what lets it keep its
 * own draft without a focus guard: the previous grid kept a draft in every one
 * of its cells all the time and had to compare against the last seen server
 * value during render to avoid yanking the caret out from under whoever was
 * typing.
 */
function CellInput({
  column, initial, align, onCommit, onCancel,
}: {
  column: SheetColumn;
  initial: string;
  align: 'left' | 'center' | 'right';
  onCommit: (value: unknown, advance: boolean) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = React.useState(initial);
  const ref = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    // A seeded edit continues from the character that started it; a deliberate
    // edit selects everything, so typing replaces and an arrow key does not.
    if (initial && initial.length <= 1) input.setSelectionRange(initial.length, initial.length);
    else input.select();
  }, [initial]);

  const inputType = column.type === 'date' ? 'date'
    : NUMERIC.has(column.type) ? 'number'
      : column.type === 'url' ? 'url' : 'text';

  return (
    <input
      ref={ref}
      type={inputType}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(coerce(column, draft), false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onCommit(coerce(column, draft), true); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        if (e.key === 'Tab') { e.preventDefault(); onCommit(coerce(column, draft), false); }
        // Arrow keys belong to the text while a cell is open, or the caret
        // cannot be moved inside a value being corrected.
        e.stopPropagation();
      }}
      style={{ textAlign: align }}
      className="h-8 w-full bg-background px-2.5 text-[13px] outline-none ring-2 ring-inset ring-[--ring]"
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Column dialog                                                             */
/* -------------------------------------------------------------------------- */

function ColumnDialog({
  state, columns, onClose, onSubmit, isSaving,
}: {
  state: { mode: 'new' | 'edit'; column?: SheetColumn } | null;
  columns: SheetColumn[];
  onClose: () => void;
  onSubmit: (values: {
    name: string; type: SheetColumn['type']; options: string[];
    formula: string | null; aggregate: string; align: string | null; decimals: number | null;
  }) => void;
  isSaving: boolean;
}) {
  const [name, setName] = React.useState(state?.column?.name ?? '');
  const [type, setType] = React.useState<SheetColumn['type']>(state?.column?.type ?? 'text');
  const [options, setOptions] = React.useState((state?.column?.options ?? []).join('\n'));
  const [formula, setFormula] = React.useState(state?.column?.formula ?? '');
  const [aggregate, setAggregate] = React.useState<string>(state?.column?.aggregate ?? 'none');
  const [align, setAlign] = React.useState<string>(state?.column?.align ?? 'auto');
  const [decimals, setDecimals] = React.useState<string>(
    state?.column?.decimals === null || state?.column?.decimals === undefined
      ? 'auto' : String(state.column.decimals),
  );

  const others = columns.filter(c => c.id !== state?.column?.id).map(c => c.name);

  /**
   * A formula cannot name its own column.
   *
   * Checked as it is typed rather than on submit, because the mistake is easy
   * to make and the failure - a column of zeroes - does not look like an error.
   */
  const selfReference = formula.trim() && name.trim()
    && formulaReferences(formula, [...others, name.trim()])
      .some(ref => ref.toLowerCase() === name.trim().toLowerCase());

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{state?.mode === 'edit' ? 'Edit column' : 'New column'}</DialogTitle>
          <DialogDescription>
            The type decides how a cell is entered and shown. A formula makes the column
            read-only and works it out from the others.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="column-name">Name</Label>
              <Input id="column-name" value={name} autoFocus
                onChange={(e) => setName(e.target.value)} placeholder="e.g. Amount" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as SheetColumn['type'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COLUMN_TYPES.map(({ value, label, icon: Icon }) => (
                    <SelectItem key={value} value={value}>
                      <span className="flex items-center gap-2"><Icon className="size-3.5" /> {label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {type === 'select' && (
            <div className="space-y-1.5">
              <Label htmlFor="column-options">Choices</Label>
              <textarea
                id="column-options"
                value={options}
                onChange={(e) => setOptions(e.target.value)}
                rows={4}
                placeholder={'Not started\nIn progress\nDone'}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px]"
              />
              <p className="text-[11.5px] text-muted-foreground">One per line.</p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Align</Label>
              <Select value={align} onValueChange={setAlign}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Automatic</SelectItem>
                  <SelectItem value="left"><span className="flex items-center gap-2"><AlignLeft className="size-3.5" /> Left</span></SelectItem>
                  <SelectItem value="center"><span className="flex items-center gap-2"><AlignCenter className="size-3.5" /> Centre</span></SelectItem>
                  <SelectItem value="right"><span className="flex items-center gap-2"><AlignRight className="size-3.5" /> Right</span></SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Decimals</Label>
              <Select value={decimals} onValueChange={setDecimals} disabled={!NUMERIC.has(type)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Automatic</SelectItem>
                  {[0, 1, 2, 3, 4].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Total</Label>
              <Select value={aggregate} onValueChange={setAggregate}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AGGREGATES.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="column-formula">Formula</Label>
            <Input
              id="column-formula"
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="= Budget - Actual"
              className="font-mono text-[13px]"
            />
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {selfReference
                ? <span className="text-destructive">A formula cannot use its own column.</span>
                : others.length
                  ? <>Use column names and <code className="font-mono">+ - * / ( )</code>, plus ROUND, ABS, MIN, MAX.
                    Available: {others.slice(0, 6).join(', ')}{others.length > 6 ? '...' : ''}</>
                  : 'Add another column first, then this one can be worked out from it.'}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!name.trim() || isSaving || !!selfReference}
            onClick={() => onSubmit({
              name: name.trim(),
              type,
              options: type === 'select'
                ? options.split('\n').map(o => o.trim()).filter(Boolean)
                : [],
              formula: formula.trim() ? formula.trim() : null,
              aggregate,
              align: align === 'auto' ? null : align,
              decimals: decimals === 'auto' ? null : Number(decimals),
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
