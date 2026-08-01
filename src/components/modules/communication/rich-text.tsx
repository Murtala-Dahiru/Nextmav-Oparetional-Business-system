'use client';

import { Fragment, useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Message text.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Why this is a renderer and not an editor ─────────────────────────────
 *
 *  The brief asks for rich text. The obvious reading is a WYSIWYG toolbar in
 *  the composer, and this repository already ships one — `@mdxeditor/editor`,
 *  used by the workspace for documents. Putting it in a chat composer would be
 *  wrong for two reasons: it is a document editor, so it costs a considerable
 *  bundle on a screen people leave open all day, and a message is not a
 *  document. What people actually want when they say rich text in a chat is
 *  emphasis, a code span, a link and a list — all of which they already type
 *  as markdown out of habit, in every chat tool there is.
 *
 *  So the composer stays a plain text box that anybody can type into blind,
 *  and the *rendering* is what becomes rich. `**like this**` is what somebody
 *  types anyway; the only change is that it now looks like it means something.
 *
 *  ── Why not a markdown library ───────────────────────────────────────────
 *
 *  Because a markdown library renders markdown — headings, tables, images,
 *  blockquotes, raw HTML — and a chat message that can contain an `<h1>` is a
 *  chat message somebody will use to shout. The grammar below is closed and
 *  small on purpose: five inline forms, links, and lists. Anything else is
 *  text, which is the correct rendering of text.
 *
 *  Nothing here interprets HTML. Every branch produces a React element with
 *  the source as a *child*, never as markup, so a message containing
 *  `<script>` renders those characters and does nothing else.
 */

export interface MentionName {
  memberId: string;
  fullName: string;
}

type Token =
  | { t: 'text'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'italic'; v: string }
  | { t: 'strike'; v: string }
  | { t: 'code'; v: string }
  | { t: 'link'; v: string; href: string }
  | { t: 'mention'; v: string; isMe: boolean };

/**
 * The order matters.
 *
 * `code` is first because a backtick span is literal — `**not bold**` inside
 * one has to stay as it was typed, and a pattern that ran earlier would have
 * already consumed it. `bold` precedes `italic` for the ordinary reason that
 * `**` would otherwise be read as two empty emphases.
 */
const INLINE: { t: Token['t']; re: RegExp }[] = [
  { t: 'code',   re: /`([^`\n]+)`/ },
  { t: 'bold',   re: /\*\*([^*\n]+)\*\*/ },
  { t: 'strike', re: /~~([^~\n]+)~~/ },
  { t: 'italic', re: /(?:^|[\s(])\*([^*\n]+)\*/ },
];

// Bare URLs only. A markdown `[label](url)` form is deliberately absent: it
// lets the visible text disagree with the destination, which is the shape of
// every link nobody should click.
const URL_RE = /https?:\/\/[^\s<>"')]+/;

function tokenize(line: string, mentions: MentionName[], myId: string | null): Token[] {
  if (!line) return [];

  // ── Mentions first ──
  //
  // Driven by the names of the people in the channel rather than by a pattern
  // over `@\w+`: a bare pattern cannot span "@Ada Lovelace" without also
  // colouring "@lunch", and it would disagree with what the composer resolved
  // and therefore with who was actually notified. Longest first, so
  // "@Ada Lovelace" wins over "@Ada" when both are in the room.
  const named = [...mentions]
    .filter(m => m.fullName)
    .sort((a, b) => b.fullName.length - a.fullName.length);

  if (named.length) {
    const escaped = named.map(m => m.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`@(${escaped.join('|')})`, 'i');
    const hit = re.exec(line);
    if (hit) {
      const at = hit.index;
      const matched = named.find(
        m => m.fullName.toLowerCase() === hit[1].toLowerCase(),
      );
      return [
        ...tokenize(line.slice(0, at), mentions, myId),
        { t: 'mention', v: hit[1], isMe: !!myId && matched?.memberId === myId },
        ...tokenize(line.slice(at + hit[0].length), mentions, myId),
      ];
    }
  }

  // ── Links ──
  const link = URL_RE.exec(line);
  if (link) {
    return [
      ...tokenize(line.slice(0, link.index), mentions, myId),
      { t: 'link', v: link[0], href: link[0] },
      ...tokenize(line.slice(link.index + link[0].length), mentions, myId),
    ];
  }

  // ── Emphasis ──
  for (const { t, re } of INLINE) {
    const hit = re.exec(line);
    if (!hit) continue;
    // The italic pattern claims a leading space or bracket so `a*b*c` is not
    // emphasis; that character belongs to the text before it, not to the mark.
    const lead = hit[0].length - hit[1].length - (t === 'italic' ? 2 : t === 'code' ? 2 : 4);
    const start = hit.index + Math.max(0, lead);
    return [
      ...tokenize(line.slice(0, start), mentions, myId),
      { t, v: hit[1] } as Token,
      ...tokenize(line.slice(hit.index + hit[0].length), mentions, myId),
    ];
  }

  return [{ t: 'text', v: line }];
}

function Inline({ tokens }: { tokens: Token[] }) {
  return (
    <>
      {tokens.map((tok, i) => {
        switch (tok.t) {
          case 'bold':
            return <strong key={i} className="font-semibold">{tok.v}</strong>;
          case 'italic':
            return <em key={i}>{tok.v}</em>;
          case 'strike':
            return <span key={i} className="line-through opacity-70">{tok.v}</span>;
          case 'code':
            return (
              <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
                {tok.v}
              </code>
            );
          case 'link':
            return (
              <a
                key={i}
                href={tok.href}
                target="_blank"
                // `noopener` is not optional on a target of `_blank`: without
                // it the opened page gets a handle on this one through
                // `window.opener` and can navigate it somewhere else.
                rel="noopener noreferrer"
                className="break-all font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800 dark:text-emerald-400"
              >
                {tok.v}
              </a>
            );
          case 'mention':
            return (
              <span
                key={i}
                className={cn(
                  'rounded px-1 font-medium',
                  tok.isMe
                    ? 'bg-amber-200 text-amber-900 dark:bg-amber-500/30 dark:text-amber-200'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
                )}
              >
                @{tok.v}
              </span>
            );
          default:
            return <Fragment key={i}>{tok.v}</Fragment>;
        }
      })}
    </>
  );
}

/**
 * Render a message body.
 *
 * Block structure is deliberately thin: a fenced code block, a bullet, and
 * paragraphs. A message that needs headings is a document, and this product
 * has somewhere to put those.
 */
export function RichText({
  body, mentions, currentMemberId, className,
}: {
  body: string;
  mentions: MentionName[];
  currentMemberId: string | null;
  className?: string;
}) {
  const blocks = useMemo(() => {
    const lines = body.split('\n');
    const out: { kind: 'p' | 'li' | 'pre'; lines: string[] }[] = [];
    let fence: string[] | null = null;

    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        if (fence) { out.push({ kind: 'pre', lines: fence }); fence = null; }
        else fence = [];
        continue;
      }
      if (fence) { fence.push(line); continue; }

      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      if (bullet) { out.push({ kind: 'li', lines: [bullet[1]] }); continue; }

      out.push({ kind: 'p', lines: [line] });
    }
    // An unclosed fence is somebody mid-thought, not an error. Render what
    // they have as code rather than swallowing it.
    if (fence) out.push({ kind: 'pre', lines: fence });
    return out;
  }, [body]);

  return (
    <div className={cn('break-words text-sm leading-relaxed', className)}>
      {blocks.map((block, i) => {
        if (block.kind === 'pre') {
          return (
            <pre
              key={i}
              className="my-1.5 overflow-x-auto rounded-md border bg-muted/60 p-2.5 font-mono text-xs"
            >
              {block.lines.join('\n')}
            </pre>
          );
        }
        if (block.kind === 'li') {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span aria-hidden className="select-none text-muted-foreground">•</span>
              <span>
                <Inline tokens={tokenize(block.lines[0], mentions, currentMemberId)} />
              </span>
            </div>
          );
        }
        // An empty line is a paragraph break, and rendering it as a zero-height
        // element would silently collapse the spacing somebody typed.
        if (!block.lines[0].trim()) return <div key={i} className="h-2" />;
        return (
          <p key={i}>
            <Inline tokens={tokenize(block.lines[0], mentions, currentMemberId)} />
          </p>
        );
      })}
    </div>
  );
}

/**
 * The same text, flattened to one line with the marks removed.
 *
 * For the sidebar preview and search results, where `**Q3** is `done`` should
 * read as "Q3 is done" rather than as its own punctuation.
 */
export function plainPreview(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
