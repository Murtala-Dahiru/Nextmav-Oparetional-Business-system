import { cn } from '@/lib/utils';
import { Reveal } from './reveal';
import { STATUS_LABEL, type Capability, type CapabilityStatus } from './capabilities';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Capability presentation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Status, carried by shape rather than by colour ───────────────────────
 *
 *  Three states need distinguishing at a glance, and the palette has exactly
 *  one accent with a hard limit of three uses per viewport — so a green /
 *  amber / grey traffic light was never available, and would have failed
 *  `color-not-only` anyway.
 *
 *  The marks differ in *form*: filled, hollow, hollow-dashed. That reads at a
 *  distance, survives greyscale, and each still carries its word. Only `live`
 *  spends accent, and only in the summary band where the count is controlled.
 *
 *  ── Why the two tiers are drawn differently ──────────────────────────────
 *
 *  A grid where every cell is identical is a list that has been given borders,
 *  and sixteen of them is the failure mode both earlier versions of this page
 *  had. What is available today is the substance of the product and is set as
 *  cards with room to breathe; what is being built is real information a buyer
 *  planning a rollout needs, and is set as a denser register underneath. The
 *  difference in density *is* the hierarchy.
 */

export function StatusMark({
  status,
  className,
}: {
  status: CapabilityStatus;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        status === 'live' && 'bg-brand',
        status === 'partial' && 'border-copy-3 border',
        status === 'planned' && 'border-copy-3 border border-dashed',
        className,
      )}
    />
  );
}

export function StatusChip({ status }: { status: CapabilityStatus }) {
  return (
    <span
      className={cn(
        'text-label inline-flex items-center gap-label rounded-full border px-2 py-0.5 uppercase',
        status === 'live' ? 'border-brand-line text-copy-2' : 'border-hairline text-copy-3',
      )}
    >
      <StatusMark status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * The available capabilities, as cards.
 *
 * `feature` promotes the first card to double width on wide viewports — the
 * page's own anchor, so the grid opens with an object rather than with a row.
 */
export function CapabilityCards({
  items,
  className,
}: {
  items: Capability[];
  className?: string;
}) {
  return (
    <div className={cn('grid gap-comp md:grid-cols-2 lg:grid-cols-3', className)}>
      {items.map(({ id, icon: Icon, name, summary, status, tags }, i) => (
        <Reveal
          key={id}
          delay={Math.min(i, 5) * 0.04}
          className={cn('h-full', i === 0 && 'lg:col-span-2')}
        >
          <div className="border-hairline bg-background rounded-surface hover:border-hairline-strong hover:shadow-e1 flex h-full flex-col border p-comp transition-[border-color,box-shadow]">
            <div className="flex items-start justify-between gap-pair">
              <Icon
                className="text-copy-2 size-[1.125rem]"
                strokeWidth={1.9}
                aria-hidden="true"
              />
              <span className="text-copy-3 text-label tabular-nums">
                {String(i + 1).padStart(2, '0')}
              </span>
            </div>

            <h3 className="text-title mt-pair">{name}</h3>
            <p className="text-copy-2 text-body-sm mt-label max-w-[36rem]">{summary}</p>

            <div className="mt-group flex flex-wrap gap-label pt-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="border-hairline text-copy-3 rounded-control border px-2 py-0.5 text-caption"
                >
                  {tag}
                </span>
              ))}
            </div>

            {/* Pushed to the bottom edge so the status line agrees across a row
                of cards whose bodies are different lengths. */}
            <div className="border-hairline mt-auto flex items-center gap-label border-t pt-pair">
              <StatusMark status={status} />
              <span className="text-copy-3 text-label uppercase">
                {STATUS_LABEL[status]}
              </span>
            </div>
          </div>
        </Reveal>
      ))}
    </div>
  );
}

/**
 * What is being built, as a denser register.
 *
 * Each row states exactly where the line falls, because "in development" on its
 * own invites a reader to assume the worst — and in four of these five cases
 * part of the capability is genuinely usable today.
 */
export function CapabilityRoadmap({
  items,
  className,
}: {
  items: Capability[];
  className?: string;
}) {
  return (
    <div className={cn('divide-hairline border-hairline divide-y border-y', className)}>
      {items.map(({ id, icon: Icon, name, summary, status, note }, i) => (
        <Reveal key={id} delay={Math.min(i, 5) * 0.04}>
          <div className="grid gap-pair py-comp md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-block">
            <div className="flex items-start gap-pair">
              <Icon
                className="text-copy-2 mt-0.5 size-4 shrink-0"
                strokeWidth={1.9}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <h3 className="text-title">{name}</h3>
                <div className="mt-label">
                  <StatusChip status={status} />
                </div>
              </div>
            </div>

            <div>
              <p className="text-copy-2 text-body-sm">{summary}</p>
              {note && (
                <p className="text-copy-3 text-body-sm mt-pair border-l-2 border-hairline-strong pl-pair">
                  {note}
                </p>
              )}
            </div>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
