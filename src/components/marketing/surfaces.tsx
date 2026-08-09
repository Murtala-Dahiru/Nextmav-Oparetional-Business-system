import {
  Search,
  LayoutGrid,
  Users,
  FolderKanban,
  UserCog,
  Wallet,
  Boxes,
  MessagesSquare,
  LifeBuoy,
  CalendarDays,
  Plus,
  Filter,
  MoreHorizontal,
  Paperclip,
  MessageSquare,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { LogoMark } from '@/components/brand/logo';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Product surfaces
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  The site's imagery. Six screens of the actual application, rendered as DOM
 *  rather than captured as pictures.
 *
 *  ── Why DOM and not screenshots ──────────────────────────────────────────
 *
 *  A screenshot is one theme, one density, one language and one moment in the
 *  product's life, at a fixed resolution that is soft on a retina display and
 *  heavy in the payload. These render with the page: sharp at any zoom, they
 *  follow the reader into dark mode, they reflow on a phone instead of being
 *  scaled into illegibility, and they cannot quietly become a picture of a
 *  version of the product that no longer exists.
 *
 *  ── On the content ───────────────────────────────────────────────────────
 *
 *  Every surface is marked as a demo workspace in its own chrome, and no row
 *  names a company or a person. Records are described by *kind* — "Manufacturing
 *  · line retrofit" — because a named company in a CRM reads as a customer and
 *  a named person reads as a user, and inventing either is the same move as a
 *  fabricated testimonial made quieter.
 *
 *  ── Density is the point ─────────────────────────────────────────────────
 *
 *  These are deliberately information-dense. A sparse mock reads as a product
 *  with nothing in it; the thing that makes enterprise software look
 *  substantial is the same thing that makes it useful — a lot of real
 *  structure, held in order. Every one of these rewards looking closely,
 *  which is what separates a product shot from an illustration.
 */

/* ── Shared chrome ──────────────────────────────────────────────────────── */

const MODULES = [
  { icon: LayoutGrid, label: 'Dashboard' },
  { icon: Users, label: 'CRM' },
  { icon: FolderKanban, label: 'Projects' },
  { icon: UserCog, label: 'People' },
  { icon: Wallet, label: 'Finance' },
  { icon: Boxes, label: 'Inventory' },
  { icon: MessagesSquare, label: 'Messages' },
  { icon: LifeBuoy, label: 'Support' },
  { icon: CalendarDays, label: 'Calendar' },
];

/**
 * The application frame.
 *
 * One component so that every surface on the site shares a sidebar, a
 * breadcrumb and a demo marker — the thing that makes six screens read as six
 * views of one product rather than six unrelated mockups.
 */
export function AppFrame({
  active,
  breadcrumb,
  children,
  className,
  rail = true,
  label,
  toolbar,
}: {
  active: string;
  breadcrumb: [string, string];
  children: ReactNode;
  className?: string;
  /** The module rail. Off for narrow surfaces used beside body copy. */
  rail?: boolean;
  /** Screen-reader description. These are illustrations, not interfaces. */
  label: string;
  toolbar?: ReactNode;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        // `isolate` so the inner highlight cannot escape the rounded corner.
        'border-hairline bg-background rounded-surface shadow-e2 relative isolate select-none overflow-hidden border',
        className,
      )}
    >
      {/* A one-pixel top highlight. On a light page it is barely there; on a
          dark one it is most of what says this panel is raised, because a
          shadow has almost no range to work with against near-black. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-white/60 dark:bg-white/10"
      />

      <div aria-hidden="true" className="flex min-h-[24rem]">
        {rail && (
          // Hidden below `md`: a 216px sidebar squeezed onto a phone is how a
          // mock ends up illegible in the context most visitors first see it.
          <aside className="border-hairline bg-surface hidden w-[13.5rem] shrink-0 flex-col border-r p-3 lg:flex">
            <div className="flex items-center gap-2 px-1.5 py-1">
              <LogoMark className="size-6" />
              <span className="text-caption font-semibold tracking-[-0.01em]">
                NextMav
              </span>
            </div>

            <nav className="mt-5 flex flex-col gap-0.5">
              {MODULES.map(({ icon: Icon, label: l }) => (
                <span
                  key={l}
                  className={cn(
                    'flex items-center gap-2.5 rounded-control px-2.5 py-[0.4375rem] text-caption font-medium',
                    l === active
                      ? 'bg-background text-foreground shadow-e1 ring-hairline ring-1'
                      : 'text-copy-3',
                  )}
                >
                  <Icon className="size-[0.9375rem]" strokeWidth={1.9} />
                  {l}
                </span>
              ))}
            </nav>

            <div className="border-hairline mt-auto flex items-center gap-label border-t px-1.5 pt-3">
              <span className="bg-surface-2 text-copy-3 grid size-6 place-items-center rounded-full text-[0.625rem] font-semibold">
                AM
              </span>
              <span className="text-copy-3 truncate text-[0.75rem]">
                Account manager
              </span>
            </div>
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-hairline flex items-center gap-3 border-b px-4 py-2.5 sm:px-5">
            <span className="text-copy-3 truncate text-[0.75rem]">
              {breadcrumb[0]} <span className="text-n-6">/</span>{' '}
              <span className="text-foreground font-medium">{breadcrumb[1]}</span>
            </span>

            <span className="ml-auto flex items-center gap-2">
              {toolbar}
              <span className="border-hairline text-copy-3 hidden items-center gap-label rounded-control border px-2.5 py-1 text-[0.75rem] xl:flex">
                <Search className="size-3.5" strokeWidth={1.9} />
                <kbd className="border-hairline bg-surface rounded-sm border px-1 font-sans text-[0.625rem]">
                  ⌘K
                </kbd>
              </span>
              {/*
                The demo marker, in the frame's own chrome where it cannot be
                cropped off. This one label is what makes every figure on every
                surface illustrative rather than a claim about customers.
              */}
              <span className="border-hairline text-copy-3 text-label flex shrink-0 items-center gap-control rounded-full border py-0.5 pr-2 pl-1.5 uppercase">
                <span
                  aria-hidden="true"
                  className="bg-brand size-1.5 shrink-0 rounded-full"
                />
                <span className="hidden sm:inline">Demo workspace</span>
              </span>
            </span>
          </header>

          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ── 1 · CRM pipeline ───────────────────────────────────────────────────── */

const CRM_STATS = [
  { label: 'Pipeline value', value: '$1,284,900', delta: '+12.4%', up: true },
  { label: 'Weighted forecast', value: '$408,220', delta: '+3.1%', up: true },
  { label: 'Avg. cycle time', value: '31 days', delta: '−4 days', up: true },
  { label: 'Win rate', value: '38.6%', delta: '−1.2%', up: false },
];

const DEALS = [
  { name: 'Manufacturing · line retrofit', owner: 'AM', stage: 'Proposal', value: '$184,000', pct: 72 },
  { name: 'Logistics · fleet telematics', owner: 'RK', stage: 'Negotiation', value: '$96,500', pct: 88 },
  { name: 'Healthcare · records migration', owner: 'JP', stage: 'Discovery', value: '$212,000', pct: 24 },
  { name: 'Professional services · retainer', owner: 'TS', stage: 'Proposal', value: '$47,300', pct: 60 },
  { name: 'Creative studio · brand system', owner: 'AM', stage: 'Qualified', value: '$28,900', pct: 40 },
  { name: 'Education · campus rollout', owner: 'RK', stage: 'Discovery', value: '$134,500', pct: 18 },
];

/** Emphasis by weight and border, never by colour — the accent has a budget. */
const STAGE_TONE: Record<string, string> = {
  Negotiation: 'bg-surface-2 text-copy border-hairline-strong font-semibold',
  Proposal: 'bg-surface-2 text-copy-2 border-hairline',
  Discovery: 'bg-surface-2 text-copy-3 border-hairline',
  Qualified: 'bg-surface-2 text-copy-3 border-hairline',
};

export function CrmSurface({ className }: { className?: string }) {
  return (
    <AppFrame
      active="CRM"
      breadcrumb={['CRM', 'Pipeline']}
      className={className}
      label="A demo NextMav workspace showing the CRM pipeline: four summary figures and a table of open deals with their stage, owner, confidence and value."
    >
      {/* `xl:pr-14` is a crop margin. This surface bleeds off the right edge in
          the hero; without it the crop lands inside the value column, and a
          cropped number is broken where a cropped interface is confident. */}
      <div className="space-y-4 p-4 sm:p-5 xl:pr-14">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {CRM_STATS.map((s) => (
            <div key={s.label} className="border-hairline rounded-control border p-3">
              <p className="text-copy-3 truncate text-[0.6875rem]">{s.label}</p>
              <p className="mt-1.5 text-title tabular-nums">{s.value}</p>
              <p
                className={cn(
                  // Direction is the arrow's job. Tinting three of four
                  // figures put three more accent elements on the screen.
                  'mt-1 flex items-center gap-0.5 text-[0.6875rem] font-medium tabular-nums',
                  s.up ? 'text-copy-2' : 'text-copy-3',
                )}
              >
                {s.up ? (
                  <ArrowUpRight className="size-3" strokeWidth={2.2} />
                ) : (
                  <ArrowDownRight className="size-3" strokeWidth={2.2} />
                )}
                {s.delta}
              </p>
            </div>
          ))}
        </div>

        <div className="border-hairline rounded-control overflow-hidden border">
          <div className="border-hairline bg-surface text-copy-3 text-label grid grid-cols-[1fr_auto] gap-3 border-b px-3 py-2 uppercase sm:grid-cols-[1.6fr_0.8fr_0.7fr_auto]">
            <span>Deal</span>
            <span className="hidden sm:block">Stage</span>
            <span className="hidden sm:block">Confidence</span>
            <span className="text-right">Value</span>
          </div>

          {DEALS.map((d) => (
            <div
              key={d.name}
              className="border-hairline grid grid-cols-[1fr_auto] items-center gap-3 border-b px-3 py-2.5 text-caption last:border-b-0 sm:grid-cols-[1.6fr_0.8fr_0.7fr_auto]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="bg-surface-2 text-copy-3 grid size-5 shrink-0 place-items-center rounded-full text-[0.625rem] font-semibold">
                  {d.owner}
                </span>
                <span className="truncate font-medium">{d.name}</span>
              </span>

              <span className="hidden sm:block">
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium',
                    STAGE_TONE[d.stage],
                  )}
                >
                  {d.stage}
                </span>
              </span>

              <span className="hidden items-center gap-2 sm:flex">
                <span className="bg-surface-2 h-1 w-full max-w-[3.5rem] overflow-hidden rounded-full">
                  <span
                    className="bg-n-9 block h-full rounded-full"
                    style={{ width: `${d.pct}%` }}
                  />
                </span>
                <span className="text-copy-3 text-[0.6875rem] tabular-nums">
                  {d.pct}%
                </span>
              </span>

              <span className="text-right font-medium tabular-nums">{d.value}</span>
            </div>
          ))}
        </div>
      </div>
    </AppFrame>
  );
}

/* ── 2 · Projects board ─────────────────────────────────────────────────── */

const BOARD = [
  {
    column: 'In progress',
    count: 4,
    cards: [
      { title: 'Commission line 3 sensors', tag: 'Field', due: 'Tue', people: ['RK', 'JP'], comments: 4, files: 2, done: 6, total: 9 },
      { title: 'Migrate historical work orders', tag: 'Data', due: 'Thu', people: ['AM'], comments: 1, files: 7, done: 3, total: 8 },
      { title: 'Operator training pack', tag: 'Docs', due: 'Fri', people: ['TS', 'RK'], comments: 9, files: 3, done: 2, total: 5 },
    ],
  },
  {
    column: 'In review',
    count: 2,
    cards: [
      { title: 'Safety sign-off — cell B', tag: 'Compliance', due: 'Today', people: ['JP'], comments: 2, files: 1, done: 4, total: 4 },
      { title: 'Cutover runbook', tag: 'Docs', due: 'Wed', people: ['AM', 'TS'], comments: 6, files: 4, done: 5, total: 7 },
    ],
  },
  {
    column: 'Blocked',
    count: 1,
    cards: [
      { title: 'Await PLC firmware from supplier', tag: 'External', due: '—', people: ['RK'], comments: 3, files: 0, done: 1, total: 6 },
    ],
  },
];

export function ProjectsSurface({ className }: { className?: string }) {
  return (
    <AppFrame
      active="Projects"
      breadcrumb={['Projects', 'Line 3 retrofit']}
      className={className}
      rail={false}
      label="A demo NextMav workspace showing a project board with three columns — in progress, in review and blocked — and task cards carrying assignees, checklists, comments and attachments."
      toolbar={
        <>
          <span className="border-hairline text-copy-3 hidden items-center gap-1.5 rounded-control border px-2 py-1 text-[0.75rem] sm:flex">
            <Filter className="size-3.5" strokeWidth={1.9} />
            Filter
          </span>
          <span className="bg-ink text-ink-fg flex items-center gap-1 rounded-control px-2 py-1 text-[0.75rem] font-medium">
            <Plus className="size-3.5" strokeWidth={2.2} />
            Task
          </span>
        </>
      }
    >
      <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
        {BOARD.map((col) => (
          <div key={col.column} className="min-w-0">
            <div className="flex items-center gap-2 px-0.5 pb-2.5">
              <span className="text-label text-copy-2 uppercase">{col.column}</span>
              <span className="bg-surface-2 text-copy-3 rounded-full px-1.5 text-[0.6875rem] font-semibold tabular-nums">
                {col.count}
              </span>
              <MoreHorizontal className="text-n-6 ml-auto size-3.5" />
            </div>

            <div className="space-y-2.5">
              {col.cards.map((c) => (
                <div
                  key={c.title}
                  // Nested radius: 14px frame, 20px padding → children floor at
                  // `control`. Matched radii is what makes a card look printed.
                  className="border-hairline bg-background rounded-control shadow-e1 border p-3"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-caption font-medium leading-snug">
                      {c.title}
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-center gap-1.5">
                    <span className="border-hairline text-copy-3 rounded-full border px-1.5 py-px text-[0.625rem] font-medium">
                      {c.tag}
                    </span>
                    <span className="text-copy-3 flex items-center gap-1 text-[0.625rem] tabular-nums">
                      <Clock className="size-2.5" strokeWidth={2.2} />
                      {c.due}
                    </span>
                  </div>

                  {/* A checklist meter. Length carries the information, so it
                      needs no colour and spends none of the accent budget. */}
                  <div className="mt-2.5 flex items-center gap-2">
                    <span className="bg-surface-2 h-1 w-full overflow-hidden rounded-full">
                      <span
                        className="bg-n-9 block h-full rounded-full"
                        style={{ width: `${(c.done / c.total) * 100}%` }}
                      />
                    </span>
                    <span className="text-copy-3 shrink-0 text-[0.625rem] tabular-nums">
                      {c.done}/{c.total}
                    </span>
                  </div>

                  <div className="border-hairline mt-2.5 flex items-center gap-2.5 border-t pt-2.5">
                    <span className="flex -space-x-1.5">
                      {c.people.map((p) => (
                        <span
                          key={p}
                          className="bg-surface-2 text-copy-3 ring-background grid size-5 place-items-center rounded-full text-[0.5625rem] font-semibold ring-2"
                        >
                          {p}
                        </span>
                      ))}
                    </span>
                    <span className="text-copy-3 ml-auto flex items-center gap-2.5 text-[0.625rem] tabular-nums">
                      {c.comments > 0 && (
                        <span className="flex items-center gap-0.5">
                          <MessageSquare className="size-2.5" strokeWidth={2.2} />
                          {c.comments}
                        </span>
                      )}
                      {c.files > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Paperclip className="size-2.5" strokeWidth={2.2} />
                          {c.files}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AppFrame>
  );
}

/* ── 3 · Attendance ─────────────────────────────────────────────────────── */

/** present · leave · holiday · absent · weekend, over four weeks. */
const ATTENDANCE_ROWS = [
  { who: 'RK', days: 'PPPPP__PPPPP__PPLLP__PPPPP__' },
  { who: 'JP', days: 'PPPPP__PPPHP__PPPPP__PPPPP__' },
  { who: 'AM', days: 'PPPPP__PPPPP__PPPPP__PLLLL__' },
  { who: 'TS', days: 'PPAPP__PPPPP__PPPHP__PPPPP__' },
  { who: 'DN', days: 'PPPPP__PPPPP__PPPPP__PPPPP__' },
  { who: 'MO', days: 'PPPPP__PLLLL__PPPPP__PPPPP__' },
];

const DAY_TONE: Record<string, string> = {
  P: 'bg-n-9', //   present
  L: 'bg-n-6', //   leave
  H: 'bg-n-4', //   holiday
  A: 'bg-destructive/70', // absent — the one state that is genuinely a problem
  _: 'bg-surface-2', // weekend
};

const LEGEND: [string, string][] = [
  ['P', 'Present'],
  ['L', 'Leave'],
  ['H', 'Holiday'],
  ['A', 'Absent'],
];

export function AttendanceSurface({ className }: { className?: string }) {
  return (
    <AppFrame
      active="People"
      breadcrumb={['People', 'Attendance']}
      className={className}
      rail={false}
      label="A demo NextMav workspace showing a four-week attendance grid for six people, with present, leave, holiday and absent states, and a summary of days recorded."
    >
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-label text-copy-3 uppercase">Days recorded</p>
            <p className="mt-1 text-display-3 tabular-nums">1,124</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {LEGEND.map(([k, l]) => (
              <span
                key={k}
                className="text-copy-3 flex items-center gap-1.5 text-[0.6875rem]"
              >
                <span
                  aria-hidden="true"
                  className={cn('size-2 rounded-[2px]', DAY_TONE[k])}
                />
                {l}
              </span>
            ))}
          </div>
        </div>

        <div className="border-hairline rounded-control mt-4 overflow-hidden border">
          {ATTENDANCE_ROWS.map((r, i) => (
            <div
              key={r.who}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5',
                i !== ATTENDANCE_ROWS.length - 1 && 'border-hairline border-b',
              )}
            >
              <span className="bg-surface-2 text-copy-3 grid size-5 shrink-0 place-items-center rounded-full text-[0.625rem] font-semibold">
                {r.who}
              </span>
              <span className="flex min-w-0 flex-1 gap-[3px]">
                {r.days.split('').map((d, j) => (
                  <span
                    key={j}
                    className={cn(
                      'h-4 min-w-0 flex-1 rounded-[2px]',
                      DAY_TONE[d],
                    )}
                  />
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </AppFrame>
  );
}

/* ── 4 · Finance ────────────────────────────────────────────────────────── */

const BARS = [42, 55, 48, 71, 63, 88, 76, 94, 82, 108, 97, 121];
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

const INVOICES = [
  { ref: 'INV-2043', for: 'Manufacturing · line retrofit', amount: '$61,300', state: 'Due in 14 days', tone: 'text-copy-2' },
  { ref: 'INV-2042', for: 'Logistics · fleet telematics', amount: '$28,400', state: 'Paid', tone: 'text-copy-3' },
  { ref: 'INV-2041', for: 'Professional services · retainer', amount: '$11,750', state: 'Paid', tone: 'text-copy-3' },
  { ref: 'INV-2039', for: 'Education · campus rollout', amount: '$44,900', state: 'Overdue 3 days', tone: 'text-destructive' },
];

export function FinanceSurface({ className }: { className?: string }) {
  const max = Math.max(...BARS);
  return (
    <AppFrame
      active="Finance"
      breadcrumb={['Finance', 'Invoices']}
      className={className}
      rail={false}
      label="A demo NextMav workspace showing invoiced revenue by month as a bar chart, beside a list of invoices with their project, amount and payment state."
    >
      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1fr_1.15fr]">
        <div className="border-hairline rounded-control border p-3.5">
          <p className="text-label text-copy-3 uppercase">Invoiced, by month</p>
          <p className="mt-1 text-display-3 tabular-nums">$945,300</p>

          {/* A chart drawn in DOM rather than pulled from a library. Twelve
              bars need twelve divs; a charting dependency here would ship
              40kB to draw rectangles. */}
          <div className="mt-4 flex h-24 items-end gap-1">
            {BARS.map((b, i) => (
              <span key={i} className="flex h-full flex-1 flex-col justify-end">
                <span
                  className={cn(
                    'w-full rounded-t-[2px]',
                    i === BARS.length - 1 ? 'bg-n-11' : 'bg-n-5',
                  )}
                  style={{ height: `${(b / max) * 100}%` }}
                />
              </span>
            ))}
          </div>
          <div className="text-copy-3 mt-1.5 flex gap-1 text-[0.5625rem]">
            {MONTHS.map((m, i) => (
              <span key={i} className="flex-1 text-center">
                {m}
              </span>
            ))}
          </div>
        </div>

        <div className="border-hairline rounded-control overflow-hidden border">
          {INVOICES.map((inv, i) => (
            <div
              key={inv.ref}
              className={cn(
                'flex items-center gap-3 px-3 py-3',
                i !== INVOICES.length - 1 && 'border-hairline border-b',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-caption font-medium tabular-nums">{inv.ref}</p>
                <p className="text-copy-3 mt-0.5 truncate text-[0.6875rem]">
                  {inv.for}
                </p>
              </div>
              <div className="text-right">
                <p className="text-caption font-semibold tabular-nums">
                  {inv.amount}
                </p>
                <p
                  className={cn(
                    'mt-0.5 flex items-center justify-end gap-1 text-[0.6875rem]',
                    inv.tone,
                  )}
                >
                  {inv.state === 'Paid' && (
                    <CheckCircle2 className="size-2.5" strokeWidth={2.4} />
                  )}
                  {inv.state}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppFrame>
  );
}
