'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, Building2, User, Handshake, Target, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { getList, listQuery } from './data';
import { personName } from './ui';
import type { Company, Contact, Deal, Lead } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Choosing the record something is about
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * A `<Select>` populated by `?pageSize=100`. Two problems, and the second one
 * is the serious one:
 *
 *   · A workspace with more than a hundred companies could not attach an
 *     activity to the hundred-and-first, and there was no indication that the
 *     list was partial - the customer simply was not in it.
 *   · The list was the hundred most recently *created*, which is close to the
 *     worst possible hundred: the customers somebody is logging calls against
 *     are the established ones.
 *
 * This searches the server on every keystroke, which is what the CRM's list
 * endpoints are already built for. The first twenty are shown unfiltered so
 * the control is useful before anybody types.
 *
 * ── Why one picker across four record types ──────────────────────────────
 *
 * `crm_activities` hangs off a lead, a contact, a company or a deal and the
 * database requires at least one. The old dialog offered companies and
 * contacts in one flat list and silently dropped leads and deals - so an
 * activity could not be logged against the deal it was about, which is the
 * commonest case there is. The kind travels with the value.
 */

export type LinkKind = 'company' | 'contact' | 'deal' | 'lead';

export interface LinkValue {
  kind: LinkKind;
  id: string;
  label: string;
  /**
   * The company this record belongs to, where it has one.
   *
   * ── Why an activity carries two links ──────────────────────────────────
   *
   * A call about a deal is also a call with that deal's customer, and Company
   * 360 reads the timeline by company. Setting only the deal meant every call
   * logged from a deal was invisible on the customer's own history, so the
   * screen whose entire purpose is "everything we know about this customer"
   * was missing most of what anybody had actually done.
   *
   * `crm_activities` is polymorphic and its CHECK requires *at least* one
   * link, not exactly one. Filling both is what the table was designed for.
   */
  companyId?: string | null;
}

const KIND_META: Record<LinkKind, { noun: string; icon: React.ElementType; path: string }> = {
  company: { noun: 'Company', icon: Building2, path: '/api/crm/companies' },
  contact: { noun: 'Contact', icon: User, path: '/api/crm/contacts' },
  deal: { noun: 'Deal', icon: Handshake, path: '/api/crm/deals' },
  lead: { noun: 'Lead', icon: Target, path: '/api/crm/leads' },
};

function labelOf(kind: LinkKind, row: any): string {
  if (kind === 'company') return (row as Company).name;
  if (kind === 'deal') return (row as Deal).name;
  return personName(row as Contact | Lead) || (row as Contact).email || 'Unnamed';
}

/** A short line under the name, so two people with one name are told apart. */
function hintOf(kind: LinkKind, row: any): string {
  if (kind === 'company') return [row.industry, row.city].filter(Boolean).join(' · ');
  if (kind === 'deal') return row.company?.name ?? '';
  if (kind === 'contact') return row.company?.name || row.email || '';
  return row.companyName || row.email || '';
}

export function LinkPicker({
  value, onChange, kinds = ['company', 'contact', 'deal', 'lead'],
  placeholder = 'Choose a record', className, allowNone = true,
}: {
  value: LinkValue | null;
  onChange: (value: LinkValue | null) => void;
  kinds?: LinkKind[];
  placeholder?: string;
  className?: string;
  allowNone?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<Record<LinkKind, { id: string; label: string; hint: string; companyId: string | null }[]>>(
    { company: [], contact: [], deal: [], lead: [] },
  );
  const [loading, setLoading] = React.useState(false);

  /**
   * One search across the chosen kinds, debounced.
   *
   * `cancelled` rather than an AbortController because four requests race and
   * the only thing that matters is that a slower earlier query cannot overwrite
   * a faster later one - the classic search-box defect where the results
   * flicker back to what you typed two letters ago.
   */
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const found = await Promise.all(kinds.map(async kind => {
          const q = listQuery({ pageSize: 20, search: query || undefined, sort: 'updated_at', sortDir: 'desc' });
          const res = await getList<any>(`${KIND_META[kind].path}?${q}`);
          return [kind, res.data.map(row => ({
            id: row.id,
            label: labelOf(kind, row),
            hint: hintOf(kind, row),
            companyId: kind === 'company' ? row.id : (row.company?.id ?? row.companyId ?? null),
          }))] as const;
        }));
        if (cancelled) return;
        setResults(prev => ({ ...prev, ...Object.fromEntries(found) }));
      } catch {
        // A picker that cannot reach the server shows nothing to choose from,
        // which the empty state below says plainly.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 220 : 0);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, query, kinds.join(',')]);

  const Icon = value ? KIND_META[value.kind].icon : ChevronsUpDown;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('h-9 w-full justify-between px-3 text-[13px] font-normal', className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Icon className={cn('size-3.5 shrink-0', value ? 'text-muted-foreground' : 'text-muted-foreground/60')} />
            <span className={cn('truncate', !value && 'text-muted-foreground')}>
              {value ? value.label : placeholder}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 size-3.5 shrink-0 text-muted-foreground/60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search customers, contacts, deals"
            value={query}
            onValueChange={setQuery}
            className="text-[13px]"
          />
          <CommandList className="max-h-72">
            {loading && (
              <div className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Searching
              </div>
            )}

            {!loading && kinds.every(k => results[k].length === 0) && (
              <CommandEmpty className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">
                {query ? `Nothing matches "${query}".` : 'Nothing to choose from yet.'}
              </CommandEmpty>
            )}

            {allowNone && value && (
              <CommandGroup>
                <CommandItem
                  value="__none"
                  onSelect={() => { onChange(null); setOpen(false); }}
                  className="text-[13px] text-muted-foreground"
                >
                  Clear this link
                </CommandItem>
              </CommandGroup>
            )}

            {kinds.map(kind => {
              const rows = results[kind];
              if (!rows.length) return null;
              const Meta = KIND_META[kind].icon;

              return (
                <CommandGroup key={kind} heading={`${KIND_META[kind].noun}s`}>
                  {rows.map(row => {
                    const on = value?.kind === kind && value.id === row.id;
                    return (
                      <CommandItem
                        key={`${kind}:${row.id}`}
                        value={`${kind}:${row.id}`}
                        onSelect={() => {
                          onChange({ kind, id: row.id, label: row.label, companyId: row.companyId });
                          setOpen(false);
                        }}
                        className="gap-2 text-[13px]"
                      >
                        <Meta className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{row.label}</span>
                          {row.hint && (
                            <span className="block truncate text-[11.5px] text-muted-foreground">{row.hint}</span>
                          )}
                        </span>
                        {on && <Check className="size-3.5 shrink-0 text-[var(--chart-1)]" />}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** The body fields an activity needs to name what it is about. */
export function linkBody(value: LinkValue | null): Record<string, string | null> {
  return {
    companyId: value?.kind === 'company' ? value.id : (value?.companyId ?? null),
    contactId: value?.kind === 'contact' ? value.id : null,
    dealId: value?.kind === 'deal' ? value.id : null,
    leadId: value?.kind === 'lead' ? value.id : null,
  };
}
