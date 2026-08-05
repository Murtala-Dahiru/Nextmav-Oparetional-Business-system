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
 *  ── On the content, and what changed ─────────────────────────────────────
 *
 *  This used to carry invented company names — "Harlow Manufacturing",
 *  "Vantage Logistics", "Northgate Health" — beside invented figures, with a
 *  fabricated person in the sidebar. The code comment called them
 *  illustrative. Nothing on screen said so, which is the entire problem: a
 *  visitor reads a named company in a CRM as a customer, and a named person as
 *  a user. That is the same move as a fabricated testimonial, made quieter.
 *
 *  Two changes. The rows now describe the *kind* of record rather than naming
 *  a party — "Manufacturing · line retrofit" is a category, not a claim — and
 *  the frame states "Demo workspace" in its own chrome, where it cannot be
 *  cropped off or missed. Figures inside an explicitly labelled demo are
 *  ordinary; figures beside a company name are a reference customer.
 *
 *  Real captures of Projects, Attendance and the Dashboard are pending. See
 *  CONTENT-NEEDED.md #13.
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
  { name: 'Manufacturing · line retrofit', owner: 'AM', stage: 'Proposal', value: '$184,000', pct: 72 },
  { name: 'Logistics · fleet telematics', owner: 'RK', stage: 'Negotiation', value: '$96,500', pct: 88 },
  { name: 'Healthcare · records migration', owner: 'JP', stage: 'Discovery', value: '$212,000', pct: 24 },
  { name: 'Professional services · retainer', owner: 'TS', stage: 'Proposal', value: '$47,300', pct: 60 },
  { name: 'Creative studio · brand system', owner: 'AM', stage: 'Qualified', value: '$28,900', pct: 40 },
];

/**
 * Stage emphasis by weight and border, not by colour.
 *
 * `Negotiation` used the accent as a filled chip. With five rows of accent
 * progress bars beneath it and the frame's own status dot, the hero was
 * carrying seven accent elements against a budget of three — which is how an
 * accent stops meaning "look here" and becomes the palette.
 */
const stageTone: Record<string, string> = {
  Negotiation: 'bg-surface-2 text-copy border-hairline-strong font-semibold',
  Proposal: 'bg-surface-2 text-copy-2 border-hairline',
  Discovery: 'bg-surface-2 text-copy-3 border-hairline',
  Qualified: 'bg-surface-2 text-copy-3 border-hairline',
};

export function ProductSurface({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        // `select-none` and the aria treatment: this is an illustration of the
        // interface, not the interface. A screen reader announcing forty
        // fabricated deal names before reaching the call to action would be
        // reading furniture aloud.
        // `shadow-e2` and `rounded-surface`, from the token set. The value it
        // replaces was a three-stop shadow tinted with pure black, written
        // inline — the right idea, hard-coded, and the only shadow on the site
        // not on the ramp, which is why it went slightly muddy against a
        // hue-biased neutral.
        'border-hairline bg-background rounded-surface shadow-e2 relative isolate select-none overflow-hidden border',
        className,
      )}
      role="img"
      aria-label="A demo NextMav workspace showing the CRM pipeline: a sidebar of modules, four summary figures, and a table of open deals with their stage, owner and value."
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
                  'flex items-center gap-2.5 rounded-control px-2.5 py-[0.4375rem] font-medium',
                  active
                    ? 'bg-background text-foreground shadow-e1 ring-hairline ring-1'
                    : 'text-copy-3',
                )}
              >
                {/* The active item already carries a fill, a ring and a
                    shadow. A fourth signal in the accent was spending the
                    budget on a state that was already unambiguous. */}
                <Icon className="size-[0.9375rem]" strokeWidth={1.9} />
                {label}
              </span>
            ))}
          </nav>

          {/* Was a fabricated person. A named individual in a product shot
              reads as a user of the product; there is no such user yet. */}
          <div className="border-hairline mt-auto flex items-center gap-label border-t px-1.5 pt-3">
            <span className="bg-surface-2 text-copy-3 grid size-6 place-items-center rounded-full text-[0.6875rem] font-semibold">
              AM
            </span>
            <span className="text-copy-3 truncate text-[0.75rem]">Account manager</span>
          </div>
        </aside>

        {/* ── Work area ─────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-hairline flex items-center gap-3 border-b px-4 py-2.5 sm:px-5">
            <span className="text-copy-3 truncate text-[0.75rem]">
              CRM <span className="text-n-6">/</span>{' '}
              <span className="text-foreground font-medium">Pipeline</span>
            </span>
            <span className="border-hairline text-copy-3 ml-auto hidden items-center gap-label rounded-control border px-2.5 py-1 text-[0.75rem] md:flex">
              <Search className="size-3.5" strokeWidth={1.9} />
              Search
              <kbd className="border-hairline bg-surface rounded-sm border px-1 font-sans text-[0.625rem]">
                ⌘K
              </kbd>
            </span>

            {/*
              The frame says what it is, in its own chrome, where it cannot be
              cropped away or mistaken for decoration. This one label is what
              makes the figures inside it illustrative rather than a claim
              about customers we do not have.

              It is also the hero's single accent element — the live dot. That
              is the entire accent budget for this screen, spent on the one
              thing that says the interface is running.
            */}
            <span className="border-hairline text-copy-3 text-label ml-auto flex shrink-0 items-center gap-control rounded-full border py-0.5 pr-2 pl-1.5 uppercase md:ml-0">
              <span
                aria-hidden="true"
                className="bg-brand size-1.5 shrink-0 rounded-full"
              />
              Demo workspace
            </span>
          </header>

          {/*
            `xl:pr-14` is a crop margin, not decoration.

            Above `xl` this frame runs off the right edge of the viewport. With
            the table's own 12px padding that crop landed 23px into the first
            row's value — the single most meaningful figure on screen — which
            is a cropped *number*, not a cropped interface. The extra right
            padding gives the bleed something empty to eat, so the frame reads
            as continuing past the edge while every figure stays whole.
          */}
          <div className="flex-1 space-y-4 p-4 sm:p-5 xl:pr-14">
            {/* Summary figures. Two columns on a phone, four from `md`. */}
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
              {stats.map((s) => (
                <div
                  key={s.label}
                  className="border-hairline rounded-control border p-3"
                >
                  <p className="text-copy-3 truncate text-[0.6875rem]">
                    {s.label}
                  </p>
                  <p className="mt-1.5 text-[0.9375rem] font-semibold tracking-[-0.02em] tabular-nums">
                    {s.value}
                  </p>
                  <p
                    className={cn(
                      // Direction is carried by the arrow, which is the signal
                      // that survives being colour-blind, printed, or read at
                      // 11px. Three of the four figures are "up", so tinting
                      // them put three more accent elements in the hero.
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

            {/* Deals. The right-hand columns drop away on narrow screens
                rather than the table scrolling sideways inside the frame. */}
            <div className="border-hairline rounded-control overflow-hidden border">
              <div className="border-hairline bg-surface text-copy-3 grid grid-cols-[1fr_auto] gap-3 border-b px-3 py-2 text-[0.6875rem] font-medium sm:grid-cols-[1.6fr_0.8fr_0.7fr_auto]">
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
                    <span className="bg-surface-2 text-copy-3 grid size-5 shrink-0 place-items-center rounded-full text-[0.625rem] font-semibold">
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
                      {/* Neutral, not accent. Five rows meant five accent
                          fills, which on its own blew the three-per-viewport
                          budget before the frame's own status dot. A meter
                          does not need colour to be read — length is the
                          information. */}
                      <span
                        className="bg-n-9 block h-full rounded-full"
                        style={{ width: `${d.pct}%` }}
                      />
                    </span>
                    <span className="text-copy-3 text-[0.6875rem] tabular-nums">
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
