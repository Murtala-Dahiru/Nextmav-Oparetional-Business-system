'use client';

import * as React from 'react';
import { User, Users, Target as TargetIcon, Coins, Scale, ArrowLeft } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { useFocusRequest } from '@/hooks/use-focus-request';
import { Button } from '@/components/ui/button';

import { MyPerformance } from './me';
import { TeamPerformance } from './team';
import { TargetsSection } from './targets';
import { EarningsSection } from './earnings';
import { RulesSection } from './rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Performance
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this module is ──────────────────────────────────────────────────
 *
 * The layer between the CRM, which knows what happened to customers, and HR,
 * which knows about people. It answers one question the other two cannot:
 * who did that, and how are they doing against what they said they would do.
 *
 * ── Why it is not part of CRM ────────────────────────────────────────────
 *
 * Two of its three audiences have no business in a pipeline. A manager
 * reviewing a team and a Finance officer approving a payout both need these
 * numbers and neither needs the deals behind them, which is exactly the
 * separation the module boundary buys. The third audience, the salesperson,
 * gets a screen that is about them rather than about the book.
 *
 * ── Sections by grant, not by role ───────────────────────────────────────
 *
 * `allows()` mirrors what the server will actually permit, so the rail shows
 * a person only what they can open. An employee sees one tab and it is theirs;
 * a manager sees three. This is a rendering decision - every endpoint behind
 * these screens re-checks for itself, and the RLS underneath re-checks again.
 */

type Section = 'me' | 'team' | 'earnings' | 'targets' | 'rules';

const SECTIONS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: 'me', label: 'My performance', icon: User },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'earnings', label: 'Earnings', icon: Coins },
  { id: 'targets', label: 'Targets', icon: TargetIcon },
  /*
   * Last, and open to everybody.
   *
   * A commission scheme people cannot read is a rumour, so the rules are an
   * ordinary tab rather than an admin screen. Only the editing is restricted,
   * and that is enforced by the route and by the RLS policy rather than by
   * hiding the page from the people it applies to.
   */
  { id: 'rules', label: 'Rules', icon: Scale },
];

export default function PerformanceModule() {
  const [section, setSection] = React.useState<Section>('me');

  /**
   * Whose performance the personal screen is showing.
   *
   * Null means "mine". Set when somebody is opened from the team list, which
   * is a drill-down rather than a navigation: the way back is a button on the
   * screen, not the browser's history, because this shell has no routes.
   */
  const [viewing, setViewing] = React.useState<string | null>(null);

  const allows = useAppStore(s => s.allows);
  const scopeOf = useAppStore(s => s.scopeOf);

  /* A person at `own` scope has no team to look at and cannot set targets. */
  const seesTeam = scopeOf('performance') !== 'own';
  const seesTargets = allows('performance', 'view');

  const visible = SECTIONS.filter(s => {
    if (s.id === 'team') return seesTeam;
    if (s.id === 'targets') return seesTargets;
    return true;
  });

  const openMember = React.useCallback((id: string) => {
    setViewing(id);
    setSection('me');
  }, []);

  /* Arriving from a notification or the command palette. */
  useFocusRequest('performance', ({ type, id }) => {
    if (type === 'member') openMember(id);
  });

  return (
    <div className="flex-1 overflow-auto">
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-3 px-4 md:px-6">
          <nav
            aria-label="Performance sections"
            className={cn(
              '-mb-px flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto',
              '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            )}
          >
            {visible.map(s => {
              const on = s.id === section;
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSection(s.id);
                    /* Leaving the personal screen drops whoever was being viewed. */
                    if (s.id !== 'me') setViewing(null);
                  }}
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
        </div>
      </div>

      <div className="p-4 md:p-6">
        {section === 'me' && (
          <div className="flex flex-col gap-4">
            {/*
              The way back from a drill-down.

              Shown only when looking at somebody else, because "back to your
              own performance" is meaningless when that is already what is on
              screen.
            */}
            {viewing && (
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 w-fit gap-1.5 text-muted-foreground"
                onClick={() => setViewing(null)}
              >
                <ArrowLeft className="size-3.5" /> Back to your performance
              </Button>
            )}
            <MyPerformance memberId={viewing} />
          </div>
        )}

        {section === 'team' && <TeamPerformance onOpenMember={openMember} />}

        {/*
          One screen, two readings.

          Somebody who can only see themselves gets their own ledger; a manager
          or Finance gets everybody they may see, with the approval buttons the
          endpoint says they may use. Splitting these into two components would
          mean maintaining the workings line twice.
        */}
        {section === 'earnings' && <EarningsSection mineOnly={!seesTeam} />}

        {section === 'targets' && <TargetsSection />}

        {section === 'rules' && <RulesSection />}
      </div>
    </div>
  );
}
