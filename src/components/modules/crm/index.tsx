'use client';

import * as React from 'react';
import {
  LayoutGrid, Target, Users, Building2, Handshake, Columns3, Sparkles, Upload,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useFocusRequest } from '@/hooks/use-focus-request';
import { useAppStore } from '@/store/app-store';
import { ExportButton } from '@/components/shared/export-button';

import { CrmHome } from './home';
import { LeadsSection } from './leads';
import { ContactsSection } from './contacts';
import { CompaniesSection } from './companies';
import { DealsSection } from './deals';
import { PipelineSection } from './pipeline';
import { ActivitiesSection } from './activities';
import { ImportCenter } from './import-center';
import type { CrmSection } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CRM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The shape of the module ──────────────────────────────────────────────
 *
 * Eight sections, each a screen in its own right, with Home as the way in.
 * They are deliberately *not* merged: a salesperson working a lead list, a
 * manager reading a forecast and somebody importing a spreadsheet are three
 * different jobs, and a single scrolling page that tried to serve all three
 * would serve none of them.
 *
 * ── Why sections are still local state ───────────────────────────────────
 *
 * Every module in this product holds its own sub-navigation in `useState`, and
 * lifting CRM's into the sidebar alone would make it the only one that behaves
 * that way. The design system's carried-forward list names this: sub-items are
 * lifted for all thirteen at once, or not at all. What changed here is that
 * the section bar is a real navigation - a row of named destinations with a
 * current one - rather than a `TabsList` of pills.
 *
 * ── Cross-module arrivals ────────────────────────────────────────────────
 *
 * `useFocusRequest` delivers "open this record" from the command palette, the
 * dashboard's attention queue, a project's client panel and the notification
 * tray. The id is held here rather than in the section, because a request for
 * a deal can arrive while Leads is showing: the section switches first, and
 * the id goes down as a prop to a component that is only then mounted.
 */

const SECTIONS: { id: CrmSection; label: string; icon: React.ElementType }[] = [
  { id: 'home', label: 'Home', icon: LayoutGrid },
  { id: 'leads', label: 'Leads', icon: Target },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'companies', label: 'Companies', icon: Building2 },
  { id: 'deals', label: 'Deals', icon: Handshake },
  { id: 'pipeline', label: 'Pipeline', icon: Columns3 },
  { id: 'activities', label: 'Activities', icon: Sparkles },
  { id: 'import', label: 'Import', icon: Upload },
];

export default function CrmModule() {
  const [section, setSection] = React.useState<CrmSection>('home');

  const [focusLead, setFocusLead] = React.useState<string | null>(null);
  const [focusContact, setFocusContact] = React.useState<string | null>(null);
  const [focusCompany, setFocusCompany] = React.useState<string | null>(null);
  const [focusDeal, setFocusDeal] = React.useState<string | null>(null);

  const allows = useAppStore(s => s.allows);
  const mayImport = allows('crm', 'create');

  const go = React.useCallback((next: CrmSection, focus?: { type: string; id: string }) => {
    setSection(next);
    if (!focus) return;
    if (focus.type === 'lead') setFocusLead(focus.id);
    if (focus.type === 'contact') setFocusContact(focus.id);
    if (focus.type === 'company') setFocusCompany(focus.id);
    if (focus.type === 'deal') setFocusDeal(focus.id);
  }, []);

  useFocusRequest('crm', ({ type, id }) => {
    switch (type) {
      case 'lead': go('leads', { type, id }); break;
      case 'contact': go('contacts', { type, id }); break;
      case 'company': go('companies', { type, id }); break;
      case 'deal': go('deals', { type, id }); break;
    }
  });

  const visible = SECTIONS.filter(s => s.id !== 'import' || mayImport);

  return (
    <div className="flex-1 overflow-auto">
      {/*
        The section bar.

        Sticky, because these screens scroll a long way and losing the way back
        to Home behind a thousand pixels of pipeline is the commonest complaint
        about a module laid out this way. It sits on the page's own background
        with a hairline under it, so it reads as part of the frame rather than
        as another card.
      */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-3 px-4 md:px-6">
          <nav
            aria-label="CRM sections"
            className="-mb-px flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {visible.map(s => {
              const on = s.id === section;
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-3 text-[13px] font-medium transition-colors',
                    on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className={cn('size-3.5', on ? 'opacity-100' : 'opacity-70')} />
                  {s.label}
                  {/*
                    The indicator is a child of the button rather than a shared
                    animated element: a sliding underline has to measure the
                    row, and this row scrolls horizontally on a phone, where a
                    measured position is wrong the moment somebody swipes.
                  */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute inset-x-1.5 bottom-0 h-[2px] rounded-t-full transition-colors',
                      on ? 'bg-foreground' : 'bg-transparent',
                    )}
                  />
                </button>
              );
            })}
          </nav>

          {/*
            Export belongs to the data, so it sits with the navigation rather
            than beside a section heading, where it competed with that
            section's own primary action.
          */}
          <div className="hidden shrink-0 py-2 sm:block">
            <ExportButton
              module="crm"
              datasets={[
                { key: 'leads', label: 'Leads' },
                { key: 'deals', label: 'Deals' },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="p-4 md:p-6">
        {section === 'home' && <CrmHome onGo={go} />}

        {section === 'leads' && (
          <LeadsSection focusId={focusLead} onFocusHandled={() => setFocusLead(null)} />
        )}

        {section === 'contacts' && (
          <ContactsSection focusId={focusContact} onFocusHandled={() => setFocusContact(null)} />
        )}

        {section === 'companies' && (
          <CompaniesSection focusId={focusCompany} onFocusHandled={() => setFocusCompany(null)} />
        )}

        {section === 'deals' && (
          <DealsSection focusId={focusDeal} onFocusHandled={() => setFocusDeal(null)} />
        )}

        {section === 'pipeline' && <PipelineSection />}

        {section === 'activities' && <ActivitiesSection />}

        {section === 'import' && mayImport && <ImportCenter onGo={go} />}
      </div>
    </div>
  );
}
