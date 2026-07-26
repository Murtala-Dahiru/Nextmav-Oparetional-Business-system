'use client';

import * as React from 'react';
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataTableFilterOption {
  value: string;
  label: string;
}

export interface DataTableFilter {
  key: string;
  label: string;
  options: DataTableFilterOption[];
}

export interface DataTableProps<TData, TValue> {
  /** Column definitions */
  columns: ColumnDef<TData, TValue>[];
  /** Row data */
  data: TData[];
  /** The column accessor key to search against (client-side) */
  searchKey?: string;
  /** Placeholder text for the search input */
  searchPlaceholder?: string;
  /** Filter dropdowns */
  filters?: DataTableFilter[];
  /** Show a loading skeleton instead of rows */
  isLoading?: boolean;
  /** Message shown when data is empty */
  emptyMessage?: string;
  /** Lucide icon component shown in the empty state */
  emptyIcon?: React.ElementType;
  /** Enable pagination controls (default: true) */
  enablePagination?: boolean;

  // Server-side props -------------------------------------------------------
  /** Total row count on the server */
  total?: number;
  /** Current page index (0-based) */
  page?: number;
  /** Rows per page */
  pageSize?: number;
  /** Available page size options */
  pageSizeOptions?: number[];
  /** Callback when page changes */
  onPageChange?: (page: number) => void;
  /** Callback when page size changes */
  onPageSizeChange?: (size: number) => void;
  /** Callback when search text changes (providing this enables server-side search) */
  onSearchChange?: (value: string) => void;
  /** Callback when a filter changes */
  onFilterChange?: (filters: ColumnFiltersState) => void;
  /** Callback when sort changes */
  onSortChange?: (sorting: SortingState) => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingRows({ columns }: { columns: number }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: columns }).map((_, j) => (
            <TableCell key={j}>
              <Skeleton className="h-5 w-full max-w-[120px]" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// DataTable
// ---------------------------------------------------------------------------

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder = 'Search...',
  filters = [],
  isLoading = false,
  emptyMessage = 'No data found.',
  emptyIcon: EmptyIcon,
  enablePagination = true,
  // Server-side
  total,
  page,
  pageSize,
  pageSizeOptions = [10, 20, 50],
  onPageChange,
  onPageSizeChange,
  onSearchChange,
  onFilterChange,
  onSortChange,
}: DataTableProps<TData, TValue>) {
  const isServerSide = !!onSearchChange;

  // State -------------------------------------------------------------------
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});

  // Debounced search --------------------------------------------------------
  const [searchInput, setSearchInput] = React.useState('');
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchInput = React.useCallback(
    (value: string) => {
      setSearchInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (isServerSide) {
          onSearchChange(value);
        } else {
          // Client-side: filter on searchKey column
          if (searchKey) {
            const existing = columnFilters.filter((f) => f.id !== searchKey);
            setColumnFilters(value ? [...existing, { id: searchKey, value }] : existing);
          }
        }
      }, 300);
    },
    [isServerSide, onSearchChange, searchKey, columnFilters],
  );

  // Clear search ------------------------------------------------------------
  const clearSearch = React.useCallback(() => {
    setSearchInput('');
    if (isServerSide) {
      onSearchChange('');
    } else if (searchKey) {
      setColumnFilters((prev) => prev.filter((f) => f.id !== searchKey));
    }
  }, [isServerSide, onSearchChange, searchKey]);

  // Sorting -----------------------------------------------------------------
  const handleSortingChange = React.useCallback(
    (updater: SortingState | ((prev: SortingState) => SortingState)) => {
      const newSorting = typeof updater === 'function' ? updater(sorting) : updater;
      setSorting(newSorting);
      onSortChange?.(newSorting);
    },
    [sorting, onSortChange],
  );

  // Filter change -----------------------------------------------------------
  const handleFilterChange = React.useCallback(
    (updater: ColumnFiltersState | ((prev: ColumnFiltersState) => ColumnFiltersState)) => {
      const newFilters = typeof updater === 'function' ? updater(columnFilters) : updater;
      setColumnFilters(newFilters);
      onFilterChange?.(newFilters);
    },
    [columnFilters, onFilterChange],
  );

  // Remove a specific filter ------------------------------------------------
  const removeFilter = React.useCallback(
    (filterKey: string) => {
      handleFilterChange((prev) => prev.filter((f) => f.id !== filterKey));
    },
    [handleFilterChange],
  );

  // Table instance ----------------------------------------------------------
  const table = useReactTable({
    data,
    columns,
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: handleFilterChange,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    ...(isServerSide
      ? {
          // Server-side: manual filtering / sorting / pagination
          manualPagination: true,
          manualSorting: true,
          manualFiltering: true,
          pageCount: total && pageSize ? Math.ceil(total / pageSize) : -1,
        }
      : {
          // Client-side
          getFilteredRowModel: getFilteredRowModel(),
          getSortedRowModel: getSortedRowModel(),
          getPaginationRowModel: getPaginationRowModel(),
        }),
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      /**
       * ── Why this is a conditional spread and not `pagination: … : undefined`
       *
       * It used to read:
       *
       *     pagination: page !== undefined && pageSize !== undefined
       *       ? { pageIndex: page, pageSize }
       *       : undefined
       *
       * TanStack Table treats a key that is *present* in `state` as
       * controlled, whatever its value. Setting it to `undefined` therefore
       * did not fall back to `initialState` — it pinned pagination state to
       * undefined, and the next read of `table.getState().pagination.pageIndex`
       * threw:
       *
       *     Cannot read properties of undefined (reading 'pageIndex')
       *
       * Which took down every table rendered without server-side pagination
       * props, via the module error boundary. HR → Leave Management was the
       * visible casualty; the fault was in this file, not in HR, and any table
       * added later without those props would have hit it too.
       *
       * Omitting the key entirely is what actually leaves pagination
       * uncontrolled, so `initialState` applies and the client-side row model
       * pages normally.
       */
      ...(page !== undefined && pageSize !== undefined
        ? { pagination: { pageIndex: page, pageSize } }
        : {}),
    },
    initialState: {
      pagination: { pageSize: pageSize ?? 10 },
    },
    enableRowSelection: false,
  });

  // Derived values ----------------------------------------------------------
  const activeFilters = columnFilters;
  const visibleColumnsCount = table.getAllColumns().filter((c) => c.getIsVisible()).length;

  // Pagination helpers (works for both modes) -------------------------------
  /**
   * Read pagination defensively.
   *
   * The state above now guarantees this object exists, so these fallbacks are
   * belt-and-braces — but a table is the last place a null dereference should
   * be able to blank a whole module, and the cost of the `?.` is nothing.
   */
  const tablePagination = table.getState().pagination;
  const currentPageIndex = isServerSide ? (page ?? 0) : (tablePagination?.pageIndex ?? 0);
  const currentPageSize = isServerSide ? (pageSize ?? 10) : (tablePagination?.pageSize ?? 10);
  const totalPages = isServerSide
    ? (total && pageSize ? Math.ceil(total / pageSize) : 0)
    : table.getPageCount();

  const canGoPrevious = currentPageIndex > 0;
  const canGoNext = currentPageIndex < totalPages - 1;

  const handlePreviousPage = React.useCallback(() => {
    if (isServerSide) onPageChange?.(currentPageIndex - 1);
    else table.previousPage();
  }, [isServerSide, currentPageIndex, onPageChange, table]);

  const handleNextPage = React.useCallback(() => {
    if (isServerSide) onPageChange?.(currentPageIndex + 1);
    else table.nextPage();
  }, [isServerSide, currentPageIndex, onPageChange, table]);

  const handlePageSize = React.useCallback(
    (value: string) => {
      const size = Number(value);
      if (isServerSide) {
        onPageSizeChange?.(size);
        onPageChange?.(0); // reset to first page
      } else {
        table.setPageSize(size);
      }
    },
    [isServerSide, onPageSizeChange, onPageChange, table],
  );

  // Cleanup -----------------------------------------------------------------
  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Render ------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Toolbar: search, filters, column visibility */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: search + filter dropdowns */}
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          {/* Search input */}
          <div className="relative max-w-sm flex-1">
            <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              placeholder={searchPlaceholder}
              value={searchInput}
              onChange={(e) => handleSearchInput(e.target.value)}
              className="pl-9 pr-8"
              aria-label="Search table"
            />
            {searchInput && (
              <button
                onClick={clearSearch}
                className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 transition-colors"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Filter dropdowns */}
          {filters.map((filter) => {
            const activeValue = columnFilters.find((f) => f.id === filter.key)?.value as string | undefined;
            return (
              <Select
                key={filter.key}
                value={activeValue ?? '_all'}
                onValueChange={(value) => {
                  if (value === '_all') {
                    removeFilter(filter.key);
                  } else {
                    handleFilterChange((prev) => {
                      const others = prev.filter((f) => f.id !== filter.key);
                      return [...others, { id: filter.key, value }];
                    });
                  }
                }}
              >
                <SelectTrigger className="w-[160px]" aria-label={`Filter by ${filter.label}`}>
                  <SlidersHorizontal className="mr-1.5 size-3.5" />
                  <SelectValue placeholder={filter.label} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All {filter.label}</SelectItem>
                  {filter.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })}
        </div>

        {/* Right: active filter badges + column visibility toggle */}
        <div className="flex items-center gap-2">
          {/* Active filter badges */}
          {activeFilters.map((f) => {
            const filterDef = filters.find((fd) => fd.key === f.id);
            const label = filterDef
              ? filterDef.options.find((o) => o.value === f.value)?.label ?? String(f.value)
              : String(f.value);
            return (
              <span
                key={f.id}
                className="bg-muted text-foreground inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium"
              >
                {filterDef?.label ?? f.id}: {label}
                <button
                  onClick={() => removeFilter(f.id)}
                  className="text-muted-foreground hover:text-foreground ml-0.5 rounded-sm"
                  aria-label={`Remove filter ${f.id}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}

          {/* Column visibility toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="ml-auto">
                <MoreHorizontal className="size-4" />
                <span className="hidden sm:inline">Columns</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) => column.toggleVisibility(!!value)}
                  >
                    {column.id.replace(/([A-Z])/g, ' $1').trim()}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <Table aria-busy={isLoading}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  return (
                    <TableHead
                      key={header.id}
                      style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                      aria-sort={
                        header.column.getIsSorted() === 'asc'
                          ? 'ascending'
                          : header.column.getIsSorted() === 'desc'
                            ? 'descending'
                            : undefined
                      }
                      className={cn(canSort && 'cursor-pointer select-none')}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <div className="flex items-center gap-1.5">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          <ArrowUpDown className="text-muted-foreground size-3.5 shrink-0" />
                        )}
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <LoadingRows columns={visibleColumnsCount} />
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={visibleColumnsCount} className="h-48">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    {EmptyIcon && (
                      <EmptyIcon className="text-muted-foreground/50 size-10" />
                    )}
                    <p className="text-muted-foreground text-sm">{emptyMessage}</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {enablePagination && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-sm">
            {isServerSide && total !== undefined
              ? `Showing ${currentPageIndex * currentPageSize + 1}–${Math.min((currentPageIndex + 1) * currentPageSize, total)} of ${total}`
              : `Page ${currentPageIndex + 1} of ${totalPages}`}
          </p>

          <div className="flex items-center gap-3">
            {/* Rows per page */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">Rows</span>
              <Select value={String(currentPageSize)} onValueChange={handlePageSize}>
                <SelectTrigger className="h-8 w-[70px]" aria-label="Rows per page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizeOptions.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Prev / Next */}
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={handlePreviousPage}
                disabled={!canGoPrevious}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={handleNextPage}
                disabled={!canGoNext}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}