'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';
import { slugify } from './data';

/**
 * ===========================================================================
 *  The reading view
 * ===========================================================================
 *
 *  -- What changed, and why it matters ------------------------------------
 *
 *  The workspace rendered documents with bare `<ReactMarkdown>` inside
 *  `prose prose-sm`. Two consequences, both invisible until somebody wrote a
 *  real document:
 *
 *    - **No `remark-gfm`, so no tables.** A pipe table - the single most used
 *      structure in a business document, and the thing every one of these
 *      templates needs - rendered as a paragraph of pipes and dashes. Task
 *      lists and strikethrough were dead in the same way.
 *    - **`prose-sm` is a blog size.** A report read at 13px with a 90ch
 *      measure is a report nobody reads to the end of.
 *
 *  So this sets the document's typography explicitly rather than inheriting a
 *  plugin's defaults: a 16px body on a measure that tops out around 68
 *  characters, headings that step down clearly, and tables that read as tables.
 *
 *  -- Why the classes are on the elements and not on a `prose` wrapper -----
 *
 *  Because half of them would have to be overridden anyway, and a stack of
 *  `prose-headings:` modifiers is harder to read than the rule it is fighting.
 *  This also puts an id on every heading, which is what the contents rail
 *  scrolls to.
 *
 *  -- Safety --------------------------------------------------------------
 *
 *  No `rehype-raw`. Raw HTML in the source is rendered as text, which is the
 *  correct rendering of text somebody typed into a document that colleagues
 *  will open. A link's href is checked below for the same reason the file
 *  panel checks one: `javascript:` in an href runs with this page's origin.
 */

/**
 * `++underlined++`.
 *
 * -- Why a plugin and not raw HTML ---------------------------------------
 *
 * Markdown has no underline. Every editor that offers one either emits `<u>`
 * into the source - which means enabling raw HTML, which means enabling every
 * other tag along with it - or picks a convention. `++text++` is the
 * convention CriticMarkup and several editors already use, and it degrades to
 * visible plus signs rather than to invisible markup anywhere that does not
 * know it.
 *
 * The node carries `data.hName`, which is how mdast asks to be rendered as a
 * particular element. Nothing here parses or emits HTML: the output is a React
 * `<u>` with the matched text as a child, so a document containing
 * `++<script>++` underlines those eight characters and does nothing else.
 *
 * Code spans and fences are untouched: neither has children to walk into, so
 * the traversal cannot reach inside them.
 */
function remarkUnderline() {
  const PATTERN = /\+\+(?!\s)([^+\n]+?)(?<!\s)\+\+/g;

  const walk = (node: any) => {
    if (!Array.isArray(node?.children)) return;

    const next: any[] = [];
    for (const child of node.children) {
      if (child.type !== 'text' || !child.value.includes('++')) {
        walk(child);
        next.push(child);
        continue;
      }

      let cursor = 0;
      let hit: RegExpExecArray | null;
      PATTERN.lastIndex = 0;
      while ((hit = PATTERN.exec(child.value))) {
        if (hit.index > cursor) {
          next.push({ type: 'text', value: child.value.slice(cursor, hit.index) });
        }
        next.push({
          type: 'underline',
          data: { hName: 'u' },
          children: [{ type: 'text', value: hit[1] }],
        });
        cursor = hit.index + hit[0].length;
      }
      if (cursor === 0) { next.push(child); continue; }
      if (cursor < child.value.length) {
        next.push({ type: 'text', value: child.value.slice(cursor) });
      }
    }
    node.children = next;
  };

  return (tree: any) => walk(tree);
}

/** Only http, https, mailto and in-page anchors survive. */
function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const value = href.trim();
  if (value.startsWith('#') || value.startsWith('/')) return value;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}

function textOf(children: React.ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(textOf).join('');
  if (React.isValidElement(children)) return textOf((children.props as any)?.children);
  return '';
}

export function MarkdownView({
  content, className, compact,
}: {
  content: string;
  className?: string;
  /** Set inside a comment or a preview, where 16px prose is too loud. */
  compact?: boolean;
}) {
  /**
   * Heading ids, numbered exactly as `outlineOf` numbers them.
   *
   * Two sections called "Summary" need two different anchors, or the contents
   * rail scrolls to the first one twice.
   *
   * The counter is created fresh on every render and consumed entirely within
   * it: `ReactMarkdown` renders its children synchronously below, so every
   * heading is numbered during this pass and the map is discarded with it.
   * Memoising it would make it survive across renders and keep counting, which
   * turns `#summary` into `#summary-7` and is what React's immutability rule
   * exists to catch.
   */
  const seen = new Map<string, number>();
  const anchor = (text: string) => {
    const base = slugify(text);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };

  const heading = (level: 1 | 2 | 3 | 4, classes: string) =>
    function Heading({ children }: { children?: React.ReactNode }) {
      const Tag = `h${level}` as 'h1';
      return <Tag id={anchor(textOf(children))} className={classes}>{children}</Tag>;
    };

  return (
    <div
      className={cn(
        'workspace-doc text-foreground',
        compact ? 'text-[13.5px] leading-[1.6]' : 'text-[15.5px] leading-[1.72]',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkUnderline]}
        components={{
          /*
            The document's own h1 is the page title in the header, so a `#`
            inside the body is a section heading and is sized as one. Rendering
            it at display size would give the page two titles of equal weight.
          */
          h1: heading(1, cn(
            'mt-9 scroll-mt-24 font-semibold tracking-[-0.014em] text-foreground first:mt-0',
            compact ? 'text-[16px]' : 'text-[22px]',
          )),
          h2: heading(2, cn(
            'mt-8 scroll-mt-24 border-b border-border pb-1.5 font-semibold tracking-[-0.012em] text-foreground first:mt-0',
            compact ? 'text-[14.5px]' : 'text-[18px]',
          )),
          h3: heading(3, cn(
            'mt-6 scroll-mt-24 font-semibold tracking-[-0.008em] text-foreground first:mt-0',
            compact ? 'text-[13.5px]' : 'text-[15.5px]',
          )),
          h4: heading(4, 'mt-5 scroll-mt-24 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground first:mt-0'),

          p: ({ children }) => <p className="my-3.5 first:mt-0 last:mb-0">{children}</p>,

          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,
          u: ({ children }) => <u className="underline decoration-1 underline-offset-[3px]">{children}</u>,

          a: ({ href, children }) => {
            const safe = safeHref(href);
            if (!safe) return <span>{children}</span>;
            const external = /^https?:/i.test(safe);
            return (
              <a
                href={safe}
                {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="font-medium text-foreground underline decoration-[--ring] decoration-1 underline-offset-[3px] transition-colors hover:decoration-2"
              >
                {children}
              </a>
            );
          },

          ul: ({ children }) => <ul className="my-3.5 space-y-1.5 pl-5 [&>li]:list-disc [&>li]:marker:text-muted-foreground">{children}</ul>,
          ol: ({ children }) => <ol className="my-3.5 space-y-1.5 pl-5 [&>li]:list-decimal [&>li]:marker:text-muted-foreground [&>li]:marker:tabular-nums">{children}</ol>,
          li: ({ children, ...props }) => {
            /*
              A task list item.

              `remark-gfm` gives the `<li>` a `checked` prop and puts a disabled
              checkbox inside it. The default marker is then a bullet *and* a
              checkbox on the same line, which reads as a mistake. The bullet is
              dropped and the checkbox is styled to look deliberate; it stays
              disabled because this is the reading view and ticking here would
              change nothing in the document.
            */
            const checked = (props as any).checked;
            if (checked === null || checked === undefined) {
              return <li className="pl-1">{children}</li>;
            }
            return (
              <li className="-ml-5 flex list-none items-baseline gap-2.5 pl-0">
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-[3px] inline-flex size-3.5 shrink-0 translate-y-[2px] items-center justify-center rounded-[3px] border',
                    checked ? 'border-[--ring] bg-[--ring] text-background' : 'border-input',
                  )}
                >
                  {checked && (
                    <svg viewBox="0 0 10 8" className="size-2 fill-none stroke-current stroke-[1.8]">
                      <path d="M1 4l2.5 2.5L9 1" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className={cn('min-w-0', checked && 'text-muted-foreground line-through')}>
                  {/* The generated checkbox itself is dropped; the span above is it. */}
                  {React.Children.toArray(children).filter(
                    child => !(React.isValidElement(child) && child.type === 'input'),
                  )}
                </span>
              </li>
            );
          },

          blockquote: ({ children }) => (
            <blockquote className="my-5 border-l-2 border-[--ring] pl-4 text-muted-foreground [&>p]:my-2">
              {children}
            </blockquote>
          ),

          hr: () => <hr className="my-8 border-border" />,

          /*
            A table scrolls inside its own container.

            A wide table is the commonest cause of a page that scrolls
            horizontally, and a document body that slides sideways under a
            fixed header is the single most obvious sign of an unfinished
            layout. The overflow is on the wrapper so the page never moves.
          */
          table: ({ children }) => (
            <div className="my-5 overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-[13.5px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
          tr: ({ children }) => <tr className="border-b border-border last:border-0">{children}</tr>,
          th: ({ children, ...props }) => (
            <th
              className="px-3 py-2 text-left align-top text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
              style={{ textAlign: (props as any).style?.textAlign }}
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="px-3 py-2 align-top" style={{ textAlign: (props as any).style?.textAlign }}>
              {children}
            </td>
          ),

          code: ({ children, ...props }) => {
            // `inline` is not in the v10 typings; a code node inside a `pre`
            // arrives with a language class, and one on its own does not.
            const isBlock = /language-/.test(String((props as any).className ?? ''));
            if (isBlock) return <code className="block font-mono text-[13px] leading-relaxed">{children}</code>;
            return (
              <code className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[0.86em] text-foreground">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-5 overflow-x-auto rounded-md border border-border bg-muted/50 p-3.5 font-mono text-[13px] leading-relaxed">
              {children}
            </pre>
          ),

          /*
            Images are sized down and captioned by their alt text.

            An unconstrained image in a document is the other way a page comes
            to scroll sideways, and a 4000px screenshot pasted into a spec is
            not a rare event.
          */
          img: ({ src, alt }) => {
            const safe = safeHref(typeof src === 'string' ? src : undefined);
            if (!safe) return null;
            return (
              <figure className="my-5">
                <img
                  src={safe}
                  alt={alt ?? ''}
                  loading="lazy"
                  className="max-h-[560px] w-auto max-w-full rounded-md border border-border"
                />
                {alt && (
                  <figcaption className="mt-2 text-[11.5px] tracking-[0.01em] text-muted-foreground">
                    {alt}
                  </figcaption>
                )}
              </figure>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
