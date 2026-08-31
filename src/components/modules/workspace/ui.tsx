'use client';

import * as React from 'react';
import {
  FileText, BookOpen, Table, Map as MapIcon, Star, Folder, FolderOpen, Code,
  Lightbulb, Target, Globe, Building2, Lock, CornerDownRight, Link2,
  Image as ImageIcon, FileArchive, Film, FileSpreadsheet, Music,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * ===========================================================================
 *  The workspace's own vocabulary
 * ===========================================================================
 *
 *  -- Why this module does not reuse the readout primitives ---------------
 *
 *  `shared/readout` gives a dark plate, a strip of instruments and numbered
 *  bands. The Executive Overview, CRM Home and (for one iteration) Projects
 *  Home were all built from it, and three screens opening on the same dark
 *  rectangle is how a suite comes to feel like one screen repainted. Projects
 *  corrected that in Phase 6 by building its own control-room panels.
 *
 *  The workspace needs a third answer, and it is the easiest of the three to
 *  argue for: **a workspace has no figures**. There is no health verdict, no
 *  pipeline, no completion rate. A dashboard here would be statistics invented
 *  to fill a shape. What a person arriving actually wants is to find a
 *  document, and what a person reading one wants is to read it.
 *
 *  So the vocabulary is a **catalogue**: ruled rows, a section heading in the
 *  left gutter, type doing the work and colour used once per row at the size
 *  of an icon. No cards, no shadows, no tiles with a number in them. It looks
 *  like a reference work, which is what a company's knowledge is.
 */

/* -------------------------------------------------------------------------- */
/*  Icons                                                                     */
/* -------------------------------------------------------------------------- */

export const ICON_OPTIONS = [
  { value: 'file-text', label: 'Document', icon: FileText },
  { value: 'book-open', label: 'Handbook', icon: BookOpen },
  { value: 'table', label: 'Table', icon: Table },
  { value: 'map', label: 'Plan', icon: MapIcon },
  { value: 'star', label: 'Highlight', icon: Star },
  { value: 'folder', label: 'Folder', icon: Folder },
  { value: 'code', label: 'Technical', icon: Code },
  { value: 'lightbulb', label: 'Idea', icon: Lightbulb },
  { value: 'target', label: 'Goal', icon: Target },
] as const;

export const ICON_MAP: Record<string, React.ElementType> = {
  'file-text': FileText, 'book-open': BookOpen, table: Table, map: MapIcon, star: Star,
  folder: Folder, code: Code, lightbulb: Lightbulb, target: Target,
};

/**
 * The colours a page icon may take.
 *
 * Nine hues taken from the product's chart ramp rather than from Tailwind's
 * palette, so a workspace of coloured folders sits in the same world as every
 * chart in the application. Muted on purpose: this is a tint behind a 14px
 * glyph, not a status.
 */
export const COLOUR_SWATCHES = [
  '#2d9572', '#2c6fa7', '#d4a93f', '#b8730a', '#8b5cf6',
  '#c0392b', '#0f766e', '#6366f1', '#6b7280',
];

export function iconFor(node: { icon?: string | null; isFolder: boolean; kind: string }) {
  return ICON_MAP[node.icon ?? ''] ?? (node.isFolder ? Folder : node.kind === 'sheet' ? Table : FileText);
}

/** The open state of a folder, so a tree row shows whether it is unfolded. */
export function folderIcon(open: boolean) {
  return open ? FolderOpen : Folder;
}

/** What kind of file this is, from its name. Used by the file panel. */
export function fileIcon(filename: string, isLink: boolean) {
  if (isLink) return Link2;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'heic'].includes(ext)) return ImageIcon;
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return Film;
  if (['mp3', 'wav', 'm4a', 'aac', 'flac'].includes(ext)) return Music;
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return FileArchive;
  if (['csv', 'xlsx', 'xls', 'ods', 'numbers'].includes(ext)) return FileSpreadsheet;
  return FileText;
}

/* -------------------------------------------------------------------------- */
/*  The icon tile                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A page's mark: its glyph on a tint of its own colour.
 *
 * The tint is the colour at 12% rather than a filled block, because the tile
 * repeats down every row of every list in the module and nine saturated
 * squares in a column is a screen with no focal point at all. The glyph
 * carries the hue at full strength, which is enough to scan by.
 */
export function IconTile({
  icon: Icon, colour, size = 'md', className,
}: {
  icon: React.ElementType;
  colour?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const box = size === 'sm' ? 'size-6 rounded' : size === 'lg' ? 'size-10 rounded-lg' : 'size-8 rounded-md';
  const glyph = size === 'sm' ? 'size-3.5' : size === 'lg' ? 'size-5' : 'size-4';
  const tint = colour || 'var(--muted-foreground)';

  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', box, className)}
      style={{ backgroundColor: colour ? `color-mix(in srgb, ${tint} 12%, transparent)` : 'var(--muted)' }}
      aria-hidden="true"
    >
      <Icon className={glyph} style={{ color: tint }} />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sections                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A section of the catalogue.
 *
 * On a wide screen the heading sits in a fixed left gutter and the content
 * runs beside it, which is the layout of an index rather than of a dashboard:
 * the reader's eye runs down one column of labels and across only when
 * something catches it. Below `lg` it stacks, because a 160px gutter on a
 * phone leaves 200px for the content.
 *
 * The rule under the heading is the only decoration in the module.
 */
export function Section({
  title, note, action, children, className,
}: {
  title: string;
  note?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('grid gap-x-8 gap-y-3 border-t border-border pt-5 lg:grid-cols-[168px_minmax(0,1fr)]', className)}>
      <div className="flex items-start justify-between gap-3 lg:block">
        <div className="min-w-0">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            {title}
          </h2>
          {note && (
            <p className="mt-1 hidden text-[11.5px] leading-snug tracking-[0.01em] text-muted-foreground/80 lg:block">
              {note}
            </p>
          )}
        </div>
        {action && <div className="shrink-0 lg:mt-2">{action}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/**
 * A row in a list of pages, files or links.
 *
 * Rendered as a button so the whole row is the target: a 13px title is a small
 * thing to hit, and on a touch screen it is smaller still. The hairline lives
 * on the row rather than on a wrapper so a list can be assembled from rows
 * without a container that knows how many there are.
 */
export function IndexRow({
  icon, colour, title, meta, trailing, onClick, href, active, className, children,
}: {
  icon: React.ElementType;
  colour?: string | null;
  title: React.ReactNode;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  active?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const inner = (
    <>
      <IconTile icon={icon} colour={colour} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium leading-tight text-foreground">
          {title}
        </span>
        {meta && (
          <span className="mt-0.5 block truncate text-[11.5px] leading-tight tracking-[0.01em] text-muted-foreground">
            {meta}
          </span>
        )}
      </span>
      {trailing && <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{trailing}</span>}
      {children}
    </>
  );

  const classes = cn(
    'group flex w-full items-center gap-3 border-b border-border/60 px-1 py-2.5 text-left',
    'transition-colors last:border-b-0 hover:bg-accent/50',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring] focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    active && 'bg-accent',
    className,
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
        {inner}
      </a>
    );
  }
  return <button type="button" onClick={onClick} className={classes}>{inner}</button>;
}

/* -------------------------------------------------------------------------- */
/*  Tags                                                                      */
/* -------------------------------------------------------------------------- */

export const VISIBILITY_ICON: Record<string, React.ElementType> = {
  organization: Globe, department: Building2, private: Lock, inherit: CornerDownRight,
};

/**
 * Who can reach this.
 *
 * A word and an outline glyph, never a filled block. The only case that gets
 * emphasis is `private`, because "nobody else can see this" is the one state
 * where being wrong about it matters.
 */
export function AccessTag({
  visibility, departmentName, shareCount, className,
}: {
  visibility: string;
  departmentName?: string | null;
  shareCount?: number;
  className?: string;
}) {
  const Icon = VISIBILITY_ICON[visibility] ?? Globe;

  const label =
    visibility === 'organization' ? 'Everyone'
      : visibility === 'department' ? (departmentName || 'One department')
        : visibility === 'private' ? 'Restricted'
          : 'Inherited';

  const shared = shareCount && shareCount > 0
    ? ` · shared with ${shareCount}`
    : '';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[11.5px] tracking-[0.01em]',
        visibility === 'private' ? 'text-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      <Icon className="size-3" />
      {label}{shared}
    </span>
  );
}

/** What a node is, as a word. */
export function KindTag({ node, className }: { node: { isFolder: boolean; kind: string }; className?: string }) {
  return (
    <span className={cn('text-[11.5px] tracking-[0.01em] text-muted-foreground', className)}>
      {node.isFolder ? 'Folder' : node.kind === 'sheet' ? 'Spreadsheet' : 'Document'}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Nothing here yet                                                          */
/* -------------------------------------------------------------------------- */

/**
 * An empty state that says what to do next.
 *
 * Deliberately not the shared `EmptyState`, which centres a large icon in a
 * dashed box. Nine of those down one page is a page made of holes; the
 * workspace has a lot of sections and most of them are empty on day one, so
 * an empty section here is one quiet line in the same rhythm as a full one.
 */
export function Nothing({
  children, action, className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[12.5px] text-muted-foreground', className)}>
      <span>{children}</span>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Toolbar                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One control in the editor toolbar.
 *
 * The tooltip carries the keyboard shortcut, because that is the only place a
 * person will ever discover it and a toolbar of unexplained glyphs teaches
 * nobody anything. `onMouseDown` with `preventDefault` rather than `onClick`:
 * clicking a button moves focus out of the textarea, and the selection the
 * command is about to act on is gone by the time the handler runs.
 */
export function ToolButton({
  icon: Icon, label, shortcut, onAction, active, disabled, className,
}: {
  icon: React.ElementType;
  label: string;
  shortcut?: string;
  onAction: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onMouseDown={(e) => { e.preventDefault(); if (!disabled) onAction(); }}
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
            'hover:bg-accent hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]',
            'disabled:pointer-events-none disabled:opacity-40',
            active && 'bg-accent text-foreground',
            className,
          )}
        >
          <Icon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-[11.5px]">
        {label}{shortcut ? <span className="ml-1.5 text-muted-foreground">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function ToolDivider() {
  return <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />;
}

/* -------------------------------------------------------------------------- */
/*  Save state                                                                */
/* -------------------------------------------------------------------------- */

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'conflict'; editor: string | null }
  | { kind: 'error'; message: string };

/**
 * What has happened to the person's typing.
 *
 * The whole point of autosave is that nobody presses a button, which means the
 * only way anyone knows their work is safe is this line. It is therefore
 * always present and never animated: a status that appears and disappears is
 * one people learn to distrust, and a spinner where a sentence should be says
 * nothing about whether the last paragraph made it.
 */
export function SaveIndicator({ state, className }: { state: SaveState; className?: string }) {
  const text =
    state.kind === 'saving' ? 'Saving'
      : state.kind === 'saved' ? `Saved ${state.at}`
        : state.kind === 'dirty' ? 'Unsaved changes'
          : state.kind === 'conflict' ? `${state.editor || 'Someone'} saved this page`
            : state.kind === 'error' ? state.message
              : 'All changes saved';

  const tone =
    state.kind === 'error' || state.kind === 'conflict'
      ? 'text-destructive'
      : state.kind === 'dirty' ? 'text-foreground' : 'text-muted-foreground';

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center gap-1.5 text-[11.5px] tracking-[0.01em]', tone, className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 rounded-full',
          state.kind === 'saving' ? 'bg-muted-foreground'
            : state.kind === 'dirty' ? 'bg-foreground'
              : state.kind === 'error' || state.kind === 'conflict' ? 'bg-destructive'
                : 'bg-transparent border border-muted-foreground/50',
        )}
      />
      {text}
    </span>
  );
}
