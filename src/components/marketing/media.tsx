import Image from 'next/image';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Editorial imagery
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Why photographs go through one component ─────────────────────────────
 *
 *  The single reason stock photography reads as stock is that its colour
 *  temperature, contrast and saturation have nothing to do with the page it
 *  has been dropped onto. Six photographs from six different shoots, each
 *  keeping its own white balance, is six foreign objects — and no amount of
 *  rounding the corners fixes it.
 *
 *  So every photograph on this surface is graded the same way before it is
 *  allowed on: pulled down in saturation, warmed slightly toward the ink, and
 *  given a wash in the page's own neutral. The result is not a filter effect —
 *  at these values it is not visible as treatment at all. It simply means the
 *  images look like they were commissioned for one publication rather than
 *  collected from several.
 *
 *  ── The line that actually matters ───────────────────────────────────────
 *
 *  A photograph is not a claim. A photograph *captioned with a person's name
 *  and job title at a company that is not a customer* is a claim, and a false
 *  one. This component takes an `eyebrow` and a `caption`, and neither is ever
 *  used to attribute a quote or name an organisation — that is enforced by
 *  review, not by types, so it is written here where it will be read.
 *
 *  `alt` describes what is depicted, never who. "A team working at a shared
 *  desk", not "the operations team at Meridian Holdings".
 */

type Ratio = 'wide' | 'photo' | 'portrait' | 'square';

const ratios: Record<Ratio, string> = {
  /** Banners and full-width bands. */
  wide: 'aspect-[16/7]',
  /** The default. Beside a column of body copy. */
  photo: 'aspect-[4/3]',
  portrait: 'aspect-[3/4]',
  square: 'aspect-square',
};

export function EditorialImage({
  src,
  alt,
  ratio = 'photo',
  className,
  priority = false,
  /** Renders over the image's lower edge. Never an attribution. */
  caption,
  eyebrow,
  /**
   * `sizes` drives which resolution the browser fetches. The default assumes a
   * half-width column above `lg` and full width below, which is the shape most
   * of these sit in. Pass an explicit value for anything else — getting this
   * wrong is how a 1260px image gets downloaded to fill 380px on a phone.
   */
  sizes = '(min-width: 1024px) 50vw, 100vw',
  /** Dims further, for images carrying text or sitting on an ink band. */
  tone = 'default',
}: {
  src: string;
  alt: string;
  ratio?: Ratio;
  className?: string;
  priority?: boolean;
  caption?: ReactNode;
  eyebrow?: ReactNode;
  sizes?: string;
  tone?: 'default' | 'deep';
}) {
  return (
    <figure
      className={cn(
        'border-hairline rounded-surface shadow-e2 relative isolate overflow-hidden border',
        ratios[ratio],
        className,
      )}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        className={cn(
          'object-cover',
          // The grade. Deliberately mild — the point is cohesion, not effect.
          'saturate-[0.72] contrast-[1.04] brightness-[0.98]',
        )}
      />

      {/* The wash, in the page's own neutral rather than in black. Black over a
          photograph muddies it; the ink carries the same hue as everything else
          on the page, so the image sits in the palette instead of beside it. */}
      <div
        aria-hidden="true"
        className={cn(
          'bg-ink absolute inset-0',
          tone === 'deep' ? 'opacity-[0.34]' : 'opacity-[0.14]',
        )}
      />

      {/* A one-pixel inner edge. Without it a photograph's own light areas run
          straight into a light page and the frame stops reading. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-black/10"
      />

      {(caption || eyebrow) && (
        <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-comp pt-block">
          {eyebrow && (
            <p className="text-label text-white/70 uppercase">{eyebrow}</p>
          )}
          {caption && (
            <p className="text-body-sm mt-1 max-w-[34rem] text-white">{caption}</p>
          )}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * A photograph with a small panel overlapping its lower corner.
 *
 * The uploaded design used this shape to float "3.2x faster approvals" over an
 * office photograph — an invented number attributed to nobody, over people with
 * no relationship to the product. The composition was the good part: an
 * overlapping card gives a flat rectangle a second plane and stops it reading
 * as a placeholder.
 *
 * So the shape is kept and the panel carries something true instead. Whatever
 * is passed as `panel` must be checkable — a property of the software, not a
 * result claimed on a customer's behalf.
 */
export function EditorialImageWithPanel({
  src,
  alt,
  panel,
  ratio = 'photo',
  className,
  sizes,
}: {
  src: string;
  alt: string;
  panel: ReactNode;
  ratio?: Ratio;
  className?: string;
  sizes?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <EditorialImage src={src} alt={alt} ratio={ratio} sizes={sizes} />
      <div className="border-hairline bg-background rounded-surface shadow-e3 relative z-10 mx-comp -mt-block border p-comp sm:mr-block sm:ml-0 sm:max-w-[22rem]">
        {panel}
      </div>
    </div>
  );
}

/**
 * The photographs used across the public surface.
 *
 * Central so the same image cannot end up on two pages meaning two different
 * things, and so the set can be swapped for commissioned photography in one
 * edit when there is some. Sourced from the uploaded public-experience project.
 */
export const PHOTO = {
  team: 'https://images.pexels.com/photos/7698712/pexels-photo-7698712.jpeg?auto=compress&cs=tinysrgb&w=1260&h=900',
  workshop: 'https://images.pexels.com/photos/1181738/pexels-photo-1181738.jpeg?auto=compress&cs=tinysrgb&w=1260&h=900',
  meeting: 'https://images.pexels.com/photos/33175650/pexels-photo-33175650.jpeg?auto=compress&cs=tinysrgb&w=1260&h=900',
  analytics: 'https://images.pexels.com/photos/97080/pexels-photo-97080.jpeg?auto=compress&cs=tinysrgb&w=1260&h=800',
  engineering: 'https://images.pexels.com/photos/34803969/pexels-photo-34803969.jpeg?auto=compress&cs=tinysrgb&w=1260&h=800',
  architecture: 'https://images.pexels.com/photos/9458996/pexels-photo-9458996.jpeg?auto=compress&cs=tinysrgb&w=1260&h=900',
} as const;
