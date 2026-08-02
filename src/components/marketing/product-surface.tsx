import {
  Search,
  LayoutGrid,
  Users,
  FolderKanban,
  UserCog,
  Wallet,
  Boxes,
  MessagesSquare,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LogoMark } from '@/components/brand/logo';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The product, in the hero
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What was here before ─────────────────────────────────────────────────
 *
 *  A wireframe. Fifty-odd `<div className="h-5 bg-gray-100 rounded" />`
 *  elements arranged to suggest a sidebar and some cards, inside a frame with
 *  three traffic-light dots drawn in hard-coded hex.
 *
 *  A grey-box mock says one thing to a visitor evaluating software: there is
 *  nothing here worth showing you. It is the visual equivalent of a demo
 *  booked for next quarter. Every company this site is trying to be measured
 *  against — Linear, Stripe, Vercel, Figma — puts the actual interface in the
 *  first screen, because the product is the argument.
 *
 *  ── Why it is DOM and not a screenshot ───────────────────────────────────
 *
 *  A screenshot is one theme, one density, one language, one moment in the
 *  product's life, at a fixed resolution that is soft on a retina display and
 *  enormous in the payload. This renders with the page: it is sharp at any
 *  zoom, it follows the reader into dark mode, it re-flows on a phone instead
 *  of being scaled into illegibility, and it cannot become a picture of a
 *  version of the product that no longer exists.
 *
 *  ── On the numbers ───────────────────────────────────────────────────────
 *
 *  Illustrative, and deliberately unrounded — a demo showing £50,000 and
 *  exactly 100 customers is one nobody believes. They describe a plausible
 *  mid-size workspace and appear nowhere as a claim about this business.
 */

const modules = [
  { icon: LayoutGrid, label: 'Dashboard' },
  { icon: Users, label: 'CRM', active: true },
  { icon: FolderKanban, label: 'Projects' },
  { icon: UserCog, label: 'People' },
  { icon: Wallet, label: 'Finance' },
  { icon: Boxes, label: 'Inventory' },
  { icon: MessagesSquare, label: 'Messages' },
];

const stats = [
  { label: 'Pipeline value', value: '$1,284,900', delta: '+12.4%', up: true },
  { label: 'Weighted forecast', value: '$408,220', delta: '+3.1%', up: true },
  { label: 'Avg. cycle time', value: '31 days', delta: '−4 days', up: true },
  { label: 'Win rate', value: '38.6%', delta: '−1.2%', up: false },
];

const deals = [
  { name: 'Harlow Manufacturing', owner: 'AM', stage: 'Proposal', value: '$184,000', pct: 72 },
  { name: 'Vantage Logistics', owner: 'RK', stage: 'Negotiation', value: '$96,500', pct: 88 },
  { name: 'Northgate Health', owner: 'JP', stage: 'Discovery', value: '$212,000', pct: 24 },
  { name: 'Bellamy & Co', owner: 'TS', stage: 'Proposal', value: '$47,300', pct: 60 },
  { name: 'Orbit Studios', owner: 'AM', stage: 'Qualified', value: '$28,900', pct: 40 },
];

const stageTone: Record<string, string> = {
  Negotiation: 'bg-brand-soft text-brand border-brand-line',
  Proposal: 'bg-surface-2 text-foreground/75 border-hairline',
  Discovery: 'bg-surface-2 text-muted-foreground border-hairline',
  Qualified: 'bg-surface-2 text-muted-foreground border-hairline',
};

export function ProductSurface({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        // `select-none` and the aria treatment: this is an illustration of the
        // interface, not the interface. A screen reader announcing forty
        // fabricated deal names before reaching the call to action would be
        // reading furniture aloud.
        'border-hairline bg-background relative isolate select-none overflow-hidden rounded-xl border shadow-[0_1px_1px_rgba(0,0,0,0.03),0_8px_24px_-8px_rgba(0,0,0,0.10),0_24px_64px_-24px_rgba(0,0,0,0.16)]',
        className,
      )}
      role="img"
      aria-label="The NextMav CRM pipeline: a sidebar of modules, four summary figures, and a table of open deals with their stage, owner and value."
    >
      <div aria-hidden="true" className="flex min-h-[26rem] text-[0.8125rem]">
        {/* ── Rail ────────────────────────────────────────────────────────
            Hidden below `sm`. A 200px sidebar squeezed onto a 360px phone is
            how a mock ends up illegible in the exact context most visitors
            will first see it. */}
        <aside className="border-hairline bg-surface hidden w-[13.5rem] shrink-0 flex-col border-r p-3 sm:flex">
          <div className="flex items-center gap-2 px-1.5 py-1">
            <LogoMark className="size-6" />
            <span className="text-[0.8125rem] font-semibold tracking-[-0.01em]">
              NextMav
            </span>
          </div>

          <nav className="mt-5 flex flex-col gap-0.5">
            {modules.map(({ icon: Icon, label, active }) => (
              <span
                key={label}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-[0.4375rem] font-medium',
                  active
                    ? 'bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-hairline ring-1'
                    : 'text-muted-foreground',
                )}
              >
                <Icon
                  className={cn('size-[0.9375rem]', active && 'text-brand')}
                  strokeWidth={1.9}
                />
                {label}
              </span>
            ))}
          </nav>

          <div className="border-hairline mt-auto flex items-center gap-2.5 border-t px-1.5 pt-3">
            <span className="bg-brand-soft text-brand grid size-6 place-items-center rounded-full text-[0.6875rem] font-semibold">
              AM
            </span>
            <span className="text-muted-foreground truncate text-[0.75rem]">
              Ana Mireles
            </span>
          </div>
        </aside>

        {/* ── Work area ─────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-hairline flex items-center gap-3 border-b px-4 py-2.5 sm:px-5">
            <span className="text-muted-foreground truncate text-[0.75rem]">
              CRM <span className="opacity-40">/</span>{' '}
              <span className="text-foreground font-medium">Pipeline</span>
            </span>
            <span className="border-hairline text-muted-foreground ml-auto hidden items-center gap-2 rounded-md border px-2.5 py-1 text-[0.75rem] md:flex">
              <Search className="size-3.5" strokeWidth={1.9} />
              Search
              <kbd className="border-hairline bg-surface rounded border px-1 font-sans text-[0.625rem]">
                ⌘K
              </kbd>
            </span>
            <span className="bg-brand size-1.5 shrink-0 rounded-full" />
          </header>

          <div className="flex-1 space-y-4 p-4 sm:p-5">
            {/* Summary figures. Two columns on a phone, four from `md`. */}
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
              {stats.map((s) => (
                <div
                  key={s.label}
                  className="border-hairline rounded-lg border p-3"
                >
                  <p className="text-muted-foreground truncate text-[0.6875rem]">
                    {s.label}
                  </p>
                  <p className="mt-1.5 text-[0.9375rem] font-semibold tracking-[-0.02em] tabular-nums">
                    {s.value}
                  </p>
                  <p
                    className={cn(
                      'mt-1 flex items-center gap-0.5 text-[0.6875rem] font-medium tabular-nums',
                      s.up ? 'text-brand' : 'text-muted-foreground',
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

            {/* Deals. The right-hand columns drop away on narrow screens
                rather than the table scrolling sideways inside the frame. */}
            <div className="border-hairline overflow-hidden rounded-lg border">
              <div className="border-hairline bg-surface text-muted-foreground grid grid-cols-[1fr_auto] gap-3 border-b px-3 py-2 text-[0.6875rem] font-medium sm:grid-cols-[1.6fr_0.8fr_0.7fr_auto]">
                <span>Deal</span>
                <span className="hidden sm:block">Stage</span>
                <span className="hidden sm:block">Confidence</span>
                <span className="text-right">Value</span>
              </div>

              {deals.map((d) => (
                <div
                  key={d.name}
                  className="border-hairline grid grid-cols-[1fr_auto] items-center gap-3 border-b px-3 py-2.5 last:border-b-0 sm:grid-cols-[1.6fr_0.8fr_0.7fr_auto]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="bg-surface-2 text-muted-foreground grid size-5 shrink-0 place-items-center rounded-full text-[0.625rem] font-semibold">
                      {d.owner}
                    </span>
                    <span className="truncate font-medium">{d.name}</span>
                  </span>

                  <span className="hidden sm:block">
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium',
                        stageTone[d.stage],
                      )}
                    >
                      {d.stage}
                    </span>
                  </span>

                  <span className="hidden items-center gap-2 sm:flex">
                    <span className="bg-surface-2 h-1 w-full max-w-[3.5rem] overflow-hidden rounded-full">
                      <span
                        className="bg-brand block h-full rounded-full"
                        style={{ width: `${d.pct}%` }}
                      />
                    </span>
                    <span className="text-muted-foreground text-[0.6875rem] tabular-nums">
                      {d.pct}%
                    </span>
                  </span>

                  <span className="text-right font-medium tabular-nums">
                    {d.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
