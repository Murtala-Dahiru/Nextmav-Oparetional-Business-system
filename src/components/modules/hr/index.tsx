'use client';

import * as React from 'react';
import {
  LayoutGrid, Users, Network, Clock, CalendarDays, Gauge,
  Briefcase, ListChecks, Wallet, MessageSquareWarning,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { useFocusRequest } from '@/hooks/use-focus-request';
import { ExportButton } from '@/components/shared/export-button';

import AttendanceTab from './attendance-tab';
import PerformanceTab from './performance-tab';
import { HrHome } from './home';
import { PeopleDirectory } from './people';
import { EmployeeProfile } from './profile';
import { Organisation } from './org';
import { Recruitment } from './recruitment';
import { Journeys } from './journeys';
import { Leave } from './leave';
import { Pay } from './pay';
import { Cases } from './cases';
import type { Section } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HR — the People Operating System
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The shape of the module ──────────────────────────────────────────────
 *
 * Ten sections, in the order the employee lifecycle runs:
 *
 *   Home         the workforce, read in one screen
 *   People       the directory, and Employee 360 behind it
 *   Organisation departments, teams, and the reporting line
 *   Recruitment  openings, candidates, interviews, offers, hiring
 *   Journeys     onboarding, offboarding, exits, templates
 *   Attendance   unchanged engine, better screen
 *   Leave        balances, approvals, and who else is away
 *   Performance  goals, cycles and reviews (Phase 5)
 *   Pay          compensation, payroll runs, payslips
 *   Cases        the HR case desk
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * Seven tabs in a `TabsList`, opening on a paginated employee table, with
 * three of the seven - Recruitment, Payroll, Case Desk - rendered entirely
 * from `useState` arrays that stored nothing. Every organisation on the
 * platform saw the same three candidates, the same three salaries and the same
 * three cases.
 *
 * ── Why a section bar rather than tabs ───────────────────────────────────
 *
 * Ten `TabsTrigger` pills wrap onto two rows at every width below `xl`, and a
 * pill that has moved to the second row is a destination people stop finding.
 * The bar is sticky and scrolls horizontally, which is what the Projects and
 * Communication modules settled on for the same reason.
 *
 * Sections stay in `useState` rather than moving into the sidebar: the design
 * system's carried-forward list is explicit that sub-items are lifted for all
 * thirteen modules at once or not at all, and lifting only this one would make
 * it the module that behaves differently.
 *
 * ── What is rendered is never an access decision ─────────────────────────
 *
 * `allows()` mirrors the server's capability summary and decides which
 * sections are drawn and which buttons appear. Every one of those endpoints
 * checks again, and RLS checks under that - so a section somebody reaches
 * another way returns an empty list rather than data.
 */

const SECTIONS: {
  id: Section;
  label: string;
  icon: React.ElementType;
  /** Drawn only when this is true. `undefined` means everybody with the module. */
  when?: (caps: { canManage: boolean; canApprove: boolean; canSeePay: boolean }) => boolean;
}[] = [
  { id: 'home', label: 'Overview', icon: LayoutGrid },
  { id: 'people', label: 'People', icon: Users },
  { id: 'org', label: 'Organisation', icon: Network },
  { id: 'recruitment', label: 'Recruitment', icon: Briefcase, when: c => c.canApprove || c.canManage },
  { id: 'journeys', label: 'Journeys', icon: ListChecks },
  { id: 'attendance', label: 'Attendance', icon: Clock },
  { id: 'leave', label: 'Leave', icon: CalendarDays },
  { id: 'performance', label: 'Performance', icon: Gauge },
  { id: 'pay', label: 'Pay', icon: Wallet },
  { id: 'cases', label: 'Case desk', icon: MessageSquareWarning },
];

export default function HrModule() {
  const [section, setSection] = React.useState<Section>('home');
  const [openMemberId, setOpenMemberId] = React.useState<string | null>(null);

  /**
   * Four separate selectors rather than one that builds an object.
   *
   * A Zustand v5 selector returning a fresh object re-renders on every store
   * change, for ever, and presents as "the module will not render". No harness
   * catches it; it has cost this repository a debugging session already.
   */
  const allows = useAppStore(s => s.allows);
  const memberId = useAppStore(s => s.user?.memberId);
  const role = useAppStore(s => s.activeRole);

  const canManage = allows('hr', 'manage');
  const canApprove = allows('hr', 'approve');
  const canSeePay = canManage;
  const isHr = canManage;

  const sections = SECTIONS.filter(s =>
    !s.when || s.when({ canManage, canApprove, canSeePay }));

  /**
   * Arrivals from elsewhere.
   *
   * A notification about a promotion, a link from the command palette, a
   * person opened from the dashboard. The member id is held here rather than
   * inside People, because the request can arrive while Payroll is showing:
   * the section switches first and the id goes down as a prop to a component
   * that is only then mounted.
   */
  useFocusRequest('hr', ({ type, id }) => {
    if (type === 'member' || type === 'employee' || type === 'employment_event') {
      setSection('people');
      setOpenMemberId(id);
    } else if (type === 'hr_case') {
      setSection('cases');
    } else if (type === 'interview') {
      setSection('recruitment');
    } else if (type === 'payroll_item') {
      setSection('pay');
    } else if (type === 'review' || type === 'goal') {
      setSection('performance');
    }
  });

  /** A notification's deep link, read once on arrival. */
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && SECTIONS.some(s => s.id === tab)) setSection(tab as Section);
    const member = params.get('member');
    if (member) { setSection('people'); setOpenMemberId(member); }
  }, []);

  const openPerson = React.useCallback((id: string) => {
    setSection('people');
    setOpenMemberId(id);
  }, []);

  return (
    <div className="flex-1 overflow-auto">
      {/*
        The section bar.

        Sticky, because these screens scroll a long way and losing the way back
        to the overview behind a thousand pixels of directory is the commonest
        complaint about a module laid out this way.
      */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-3 px-4 md:px-6">
          <nav
            aria-label="HR sections"
            className="-mb-px flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {sections.map(s => {
              const on = s.id === section;
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setSection(s.id); setOpenMemberId(null); }}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-3 text-[13px] font-medium transition-colors',
                    on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className={cn('size-3.5', on ? 'opacity-100' : 'opacity-70')} />
                  {s.label}
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

          {canManage ? (
            <div className="hidden shrink-0 py-2 sm:block">
              <ExportButton
                module="hr"
                datasets={[
                  { key: 'employees', label: 'Employees' },
                  { key: 'attendance', label: 'Attendance' },
                  { key: 'leave', label: 'Leave' },
                ]}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="p-4 md:p-6">
        {section === 'home' ? (
          <HrHome onOpenPerson={openPerson} onGo={setSection} />
        ) : null}

        {section === 'people' ? (
          openMemberId ? (
            <EmployeeProfile
              memberId={openMemberId}
              onBack={() => setOpenMemberId(null)}
              onOpenPerson={setOpenMemberId}
            />
          ) : (
            <PeopleDirectory onOpenPerson={openPerson} canManage={canManage} />
          )
        ) : null}

        {section === 'org' ? <Organisation onOpenPerson={openPerson} /> : null}

        {section === 'recruitment' ? (
          <Recruitment canManage={canManage} selfMemberId={memberId ?? ''} />
        ) : null}

        {section === 'journeys' ? (
          <Journeys canManage={canManage} onOpenPerson={openPerson} />
        ) : null}

        {section === 'attendance' ? <AttendanceTab /> : null}

        {section === 'leave' ? (
          <Leave
            canApprove={canApprove}
            canManage={canManage}
            selfMemberId={memberId ?? ''}
          />
        ) : null}

        {section === 'performance' ? <PerformanceTab /> : null}

        {section === 'pay' ? (
          <Pay canSeePay={canSeePay} selfMemberId={memberId ?? ''} />
        ) : null}

        {section === 'cases' ? (
          <Cases isHr={isHr} selfMemberId={memberId ?? ''} />
        ) : null}
      </div>
    </div>
  );
}
