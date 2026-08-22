'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  FolderKanban,
  BookOpen,
  DollarSign,
  Package,
  PanelLeft,
  LogOut,
  User,
  Building2,
  Handshake,
  CheckSquare,
  TicketCheck,
  FileText,
  CreditCard,
  HelpCircle,
  Shield,
  Moon,
  Sun,
  Loader2,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { useAppStore } from '@/store/app-store';
import { useDebounce } from '@/hooks/use-debounce';
import { type ModuleId } from '@/lib/constants';
import { navigationFor } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*  Cross-module search                                                        */
/* -------------------------------------------------------------------------- */
/**
 * ── Why the palette searches the business, not just the menu ──────────────
 *
 * `/api/search` has always existed: it queries leads, companies, projects,
 * tasks, tickets, pages and products in parallel, filters each one to the
 * modules the caller's role may open, and returns a single ranked list. No
 * screen had ever called it. The palette — the one surface in the product
 * whose entire purpose is "find the thing" — filtered a hard-coded list of
 * eleven menu entries client-side.
 *
 * So the answer to "where does this customer live?" was: know which module,
 * open it, find its tab, and search again there. Three navigations to reach a
 * record the platform could already find in one query.
 */

interface SearchHit {
  type: string;
  module: ModuleId;
  id: string;
  title: string;
  subtitle: string | null;
  meta: string | null;
}

/** The word a person would use for each result type, and its mark. */
const HIT_KINDS: Record<string, { label: string; icon: React.ElementType }> = {
  lead: { label: 'Leads', icon: Users },
  contact: { label: 'Contacts', icon: User },
  company: { label: 'Companies', icon: Building2 },
  deal: { label: 'Deals', icon: Handshake },
  project: { label: 'Projects', icon: FolderKanban },
  task: { label: 'Tasks', icon: CheckSquare },
  ticket: { label: 'Tickets', icon: TicketCheck },
  invoice: { label: 'Invoices', icon: DollarSign },
  page: { label: 'Pages', icon: BookOpen },
  product: { label: 'Products', icon: Package },
};

/** Groups in the order a search is usually meant: people and work first. */
const HIT_ORDER = [
  'company', 'contact', 'lead', 'deal', 'project', 'task', 'ticket', 'invoice', 'page', 'product',
];

const STATIC_PAGES = [
  { label: 'Pricing', icon: CreditCard, go: '/pricing' },
  { label: 'Features', icon: FileText, go: '/features' },
  { label: 'Help Center', icon: HelpCircle, go: '/help' },
  { label: 'Documentation', icon: FileText, go: '/docs' },
  { label: 'Status Page', icon: Shield, go: '/status' },
] as const;

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [searching, setSearching] = React.useState(false);

  const {
    activeModule, setActiveModule, setSearchOpen, logout, setSidebarCollapsed,
    visibleModules, openRecord, activeRole,
  } = useAppStore();

  // The palette is a navigation surface like any other: it must only offer
  // modules this role can actually open.
  const allowedModuleIds = new Set(visibleModules());
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  // Debounced so typing a customer's name is one query, not eight. 200ms is
  // below the threshold where a list feels like it is lagging behind the
  // keyboard, and above the rate at which a fast typist would fire per-letter.
  const debouncedQuery = useDebounce(query, 200);

  // Keyboard shortcut: Ctrl+K or Cmd+K
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // Also listen to the store's searchOpen
  React.useEffect(() => {
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.searchOpen && !prev.searchOpen) setOpen(true);
      if (!state.searchOpen && prev.searchOpen) setOpen(false);
    });
    return unsub;
  }, []);

  /**
   * Run the search.
   *
   * Aborted on every new term so a slow response for "nor" cannot land after
   * the response for "northwind" and repopulate the list with stale results —
   * the failure mode that makes a search box feel haunted.
   */
  React.useEffect(() => {
    const term = debouncedQuery.trim();
    if (!open || term.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    setSearching(true);

    fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(body => setHits(body?.data?.results ?? []))
      .catch(() => { /* aborted, or offline: the static commands still work */ })
      .finally(() => setSearching(false));

    return () => controller.abort();
  }, [debouncedQuery, open]);

  const handleClose = React.useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setSearchOpen(false);
      // Cleared on close so reopening the palette is a fresh start rather than
      // the previous search still on screen.
      setQuery('');
      setHits([]);
    }
  }, [setSearchOpen]);

  const runCommand = React.useCallback((command: () => void) => {
    handleClose(false);
    command();
  }, [handleClose]);

  const term = query.trim();
  const isSearching = term.length >= 2;

  // Grouped for display; the endpoint returns one flat ranked list.
  const grouped = React.useMemo(() => {
    const by = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      if (!by.has(hit.type)) by.set(hit.type, []);
      by.get(hit.type)!.push(hit);
    }
    return HIT_ORDER.filter(t => by.has(t)).map(t => [t, by.get(t)!] as const);
  }, [hits]);

  /**
   * Static entries are filtered here rather than by cmdk.
   *
   * cmdk's own filter is off (`shouldFilter={false}`), because it would drop
   * server results whose label does not repeat the term — searching an email
   * address, an SKU or a ticket number returns rows that match on a column the
   * user never sees, and those are the searches worth having.
   */
  const matches = React.useCallback(
    (text: string) => !isSearching || text.toLowerCase().includes(term.toLowerCase()),
    [isSearching, term],
  );

  /**
   * The same navigation the sidebar renders, filtered by what is typed.
   *
   * Read from `lib/navigation.ts` rather than from a second copy of the module
   * list, so a group added there appears in both surfaces or in neither. The
   * headings are the group names — "Collaboration", "Operations" — which is
   * also what makes a search for a half-remembered module useful: typing
   * "port" shows Client Portal under Customers, and the heading is the
   * confirmation that it is the right one.
   */
  const navSections = navigationFor([...allowedModuleIds], activeRole)
    .map(section => ({
      ...section,
      items: section.items.filter(item => matches(item.label) || matches(item.summary)),
    }))
    .filter(section => section.items.length > 0);

  return (
    <CommandDialog open={open} onOpenChange={handleClose} shouldFilter={false}>
      <CommandInput
        placeholder="Search customers, projects, tickets… or type a command"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {isSearching && searching ? (
            <span className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Searching…
            </span>
          ) : (
            'No results found.'
          )}
        </CommandEmpty>

        {/* ── Records, from every module the role can open ─────────────── */}
        {grouped.map(([type, rows]) => {
          const kind = HIT_KINDS[type] ?? { label: type, icon: FileText };
          const Icon = kind.icon;
          return (
            <CommandGroup key={type} heading={kind.label}>
              {rows.map(hit => (
                <CommandItem
                  key={`${type}-${hit.id}`}
                  value={`${type}-${hit.id}`}
                  onSelect={() => runCommand(() => openRecord(hit.module, hit.type, hit.id))}
                >
                  <Icon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{hit.title}</span>
                  {hit.subtitle && (
                    <span className="ml-2 truncate text-xs text-muted-foreground">
                      {hit.subtitle}
                    </span>
                  )}
                  {hit.meta && (
                    <CommandShortcut className="capitalize">
                      {String(hit.meta).replace(/_/g, ' ')}
                    </CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}

        {grouped.length > 0 && <CommandSeparator />}

        {/* Navigation, in the product's own grouping */}
        {navSections.map((section) => (
          <CommandGroup key={section.id} heading={section.label ?? 'Go to'}>
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeModule === item.id;
              return (
                <CommandItem
                  key={item.id}
                  value={`module-${item.id}`}
                  onSelect={() => runCommand(() => setActiveModule(item.id))}
                  className={cn(isActive && 'bg-accent')}
                >
                  <Icon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{item.label}</span>
                  {isActive && <span className="ml-auto text-xs text-muted-foreground">Current</span>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}

        {/* Pages, actions and account are commands rather than data, so they
            stay out of the way once the user is plainly searching for a
            record — but remain reachable by name. */}
        {STATIC_PAGES.some(p => matches(p.label)) && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Pages">
              {STATIC_PAGES.filter(p => matches(p.label)).map(p => (
                <CommandItem key={p.go} value={`page-${p.go}`} onSelect={() => runCommand(() => router.push(p.go))}>
                  <p.icon className="mr-2 h-4 w-4" />
                  <span>{p.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {(matches('Toggle Sidebar') || matches('Toggle Theme')) && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              {matches('Toggle Sidebar') && (
                <CommandItem
                  value="action-sidebar"
                  onSelect={() => runCommand(() => setSidebarCollapsed(!useAppStore.getState().sidebarCollapsed))}
                >
                  <PanelLeft className="mr-2 h-4 w-4" />
                  <span>Toggle Sidebar</span>
                  <CommandShortcut>[</CommandShortcut>
                </CommandItem>
              )}
              {matches('Toggle Theme') && (
                <CommandItem
                  value="action-theme"
                  onSelect={() => runCommand(() => setTheme(theme === 'dark' ? 'light' : 'dark'))}
                >
                  {theme === 'dark' ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                  <span>Toggle Theme</span>
                  {/*
                    The `⇧D` hint that used to be here was for a shortcut
                    nothing listened for — the same defect as the `[` beside
                    Toggle Sidebar, which is now implemented in the sidebar.
                    This one is not worth implementing: a bare letter key is a
                    poor global binding, and appearance is now a three-way
                    choice in the account menu rather than a flip. A shortcut
                    that does nothing is worse than no shortcut, because it
                    teaches people the product is unreliable.
                  */}
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}

        {(matches('Profile') || matches('Log out')) && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Account">
              {matches('Profile') && (
                <CommandItem value="account-profile" onSelect={() => runCommand(() => router.push('/settings'))}>
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </CommandItem>
              )}
              {matches('Log out') && (
                <CommandItem value="account-logout" onSelect={() => runCommand(() => logout())}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
