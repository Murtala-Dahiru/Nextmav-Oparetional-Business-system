'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  FileText, FileSpreadsheet, FolderPlus, UploadCloud, Search, Star, Clock,
  Users, LayoutTemplate, ArrowRight, Loader2, Paperclip, Link2, ChevronRight,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { formatRelativeTime, formatFileSize, initialsOf } from '@/lib/format';
import { hostOf } from '@/lib/links';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';

import { Section, IndexRow, IconTile, iconFor, fileIcon, Nothing } from './ui';
import { getOne, count, kindWord } from './data';
import type { WorkspaceOverview, WorkspaceNode } from './types';

/**
 * ===========================================================================
 *  Workspace Home
 * ===========================================================================
 *
 *  -- What this is not -----------------------------------------------------
 *
 *  Not another Executive Overview. A workspace has no health verdict, no
 *  pipeline and no completion rate, and a row of large numbers here would be
 *  statistics invented to fill a shape. The counts that appear are labels on
 *  sections, not a dashboard.
 *
 *  -- What it is -----------------------------------------------------------
 *
 *  The way in to the company's written knowledge: what you were last working
 *  on, what the company has pinned, what somebody has put in front of you, and
 *  the areas the workspace is organised into. A search field at the top,
 *  because the fastest route to a document you know exists is its name, and
 *  four unambiguous ways to make something new.
 *
 *  The layout is a catalogue - a heading in the left gutter, ruled rows beside
 *  it - which is deliberately unlike the CRM's bands and the Projects control
 *  room. Three modules that open on the same composition make a suite feel
 *  like one screen repainted.
 */

export function Home({
  onOpenPage, onOpenFolder, onNew, onBrowse, onTemplates, reloadKey,
}: {
  onOpenPage: (id: string) => void;
  onOpenFolder: (id: string) => void;
  onNew: (what: 'document' | 'sheet' | 'folder' | 'upload') => void;
  onBrowse: () => void;
  onTemplates: () => void;
  /** Bumped by the module when the tree changes, so Home refetches. */
  reloadKey: number;
}) {
  const me = useAppStore(s => s.user);
  const [data, setData] = React.useState<WorkspaceOverview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<WorkspaceNode[] | null>(null);
  const [searching, setSearching] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setData(await getOne<WorkspaceOverview>('/api/workspace/overview'));
      setFailed(null);
    } catch (err: any) {
      setFailed(err.message || 'The workspace could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load, reloadKey]);

  /**
   * Search as you type, against titles and document bodies.
   *
   * Debounced rather than issued per keystroke: this reads every page body in
   * the organisation through a trigram index, and one request per character is
   * a request per character.
   */
  React.useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setHits(null); return; }

    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/workspace/pages?q=${encodeURIComponent(term)}&pageSize=20`);
        const json = await res.json();
        setHits(json?.data ?? []);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  const greeting = React.useMemo(() => {
    const hour = new Date().getHours();
    const name = me?.firstName ? `, ${me.firstName}` : '';
    if (hour < 12) return `Good morning${name}`;
    if (hour < 18) return `Good afternoon${name}`;
    return `Good evening${name}`;
  }, [me?.firstName]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="mt-4 h-10 w-full" />
        <div className="mt-10 space-y-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="grid gap-6 border-t border-border pt-5 lg:grid-cols-[168px_minmax(0,1fr)]">
              <Skeleton className="h-4 w-24" />
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, j) => <Skeleton key={j} className="h-11 w-full" />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (failed || !data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        <div className="rounded-md border border-border p-8 text-center">
          <p className="text-[14px] font-medium">The workspace could not be loaded</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-muted-foreground">{failed}</p>
          <Button size="sm" className="mt-4" onClick={() => { setLoading(true); void load(); }}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const { counts } = data;
  const isEmpty = counts.documents + counts.sheets + counts.folders === 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      {/* -- The way in ---------------------------------------------- */}
      <div className="mb-8">
        <h1 className="text-[21px] font-semibold tracking-[-0.018em] text-foreground">
          {greeting}
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {isEmpty
            ? 'This is where the company writes things down. Start with a document or a folder.'
            : [
              count(counts.documents, 'document'),
              count(counts.sheets, 'spreadsheet'),
              count(counts.folders, 'folder'),
            ].join(' · ')}
        </p>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the workspace, including inside documents"
            className="h-10 pl-9 text-[13.5px]"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Quick create. Four verbs, no menu: the commonest actions in the
            module should not be one click further away than everything else. */}
        <div className="mt-3 flex flex-wrap gap-2">
          <QuickAction icon={FileText} label="New document" onClick={() => onNew('document')} />
          <QuickAction icon={FileSpreadsheet} label="New spreadsheet" onClick={() => onNew('sheet')} />
          <QuickAction icon={FolderPlus} label="New folder" onClick={() => onNew('folder')} />
          <QuickAction icon={UploadCloud} label="Upload a file" onClick={() => onNew('upload')} />
          <QuickAction icon={LayoutTemplate} label="From a template" onClick={onTemplates} />
        </div>
      </div>

      {/* -- Search results take over the page ----------------------- */}
      {hits ? (
        <Section
          title="Results"
          note={`Matching "${query.trim()}" in titles and document text`}
          action={
            <button
              type="button"
              onClick={() => { setQuery(''); setHits(null); }}
              className="text-[12px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          }
        >
          {hits.length === 0 ? (
            <Nothing>Nothing matches that, in the pages you can open.</Nothing>
          ) : (
            <div>
              {hits.map(node => (
                <IndexRow
                  key={node.id}
                  icon={iconFor(node)}
                  colour={node.colour}
                  title={node.title}
                  meta={[node.summary || kindWord(node), node.lastEditedByName].filter(Boolean).join(' · ')}
                  trailing={formatRelativeTime(node.updatedAt)}
                  onClick={() => (node.isFolder ? onOpenFolder(node.id) : onOpenPage(node.id))}
                />
              ))}
            </div>
          )}
        </Section>
      ) : (
        <div className="space-y-8">
          {/* -- Recently edited -- */}
          <Section
            title="Recent"
            note="What has been worked on across the company"
            action={
              <button
                type="button"
                onClick={onBrowse}
                className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Browse all <ArrowRight className="size-3" />
              </button>
            }
          >
            {data.recent.length === 0 ? (
              <Nothing
                action={
                  <button
                    type="button"
                    onClick={() => onNew('document')}
                    className="font-medium text-foreground underline decoration-[--ring] underline-offset-2"
                  >
                    Write the first one
                  </button>
                }
              >
                Nothing has been written yet.
              </Nothing>
            ) : (
              <div>
                {data.recent.map(node => (
                  <IndexRow
                    key={node.id}
                    icon={iconFor(node)}
                    colour={node.colour}
                    title={node.title}
                    meta={[node.summary || kindWord(node), node.lastEditedByName].filter(Boolean).join(' · ')}
                    trailing={formatRelativeTime(node.updatedAt)}
                    onClick={() => onOpenPage(node.id)}
                  />
                ))}
              </div>
            )}
          </Section>

          {/* -- Starred -- */}
          {(data.starred.length > 0 || counts.documents > 0) && (
            <Section
              title="Pinned"
              note="Starred by anyone, shown to everyone"
            >
              {data.starred.length === 0 ? (
                <Nothing>
                  Nothing pinned. Star a page and it appears here for the whole company.
                </Nothing>
              ) : (
                <div>
                  {data.starred.map(node => (
                    <IndexRow
                      key={node.id}
                      icon={iconFor(node)}
                      colour={node.colour}
                      title={node.title}
                      meta={node.summary || kindWord(node)}
                      trailing={
                        <Star className="size-3 fill-[#d4a93f] text-[#d4a93f]" />
                      }
                      onClick={() => (node.isFolder ? onOpenFolder(node.id) : onOpenPage(node.id))}
                    />
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* -- Shared with me -- */}
          {data.sharedWithMe.length > 0 && (
            <Section title="Shared with you" note="Where somebody named you or your department">
              <div>
                {data.sharedWithMe.map(node => (
                  <IndexRow
                    key={node.id}
                    icon={iconFor(node)}
                    colour={node.colour}
                    title={node.title}
                    meta={[kindWord(node), node.createdByName ? `from ${node.createdByName}` : null]
                      .filter(Boolean).join(' · ')}
                    trailing={formatRelativeTime(node.updatedAt)}
                    onClick={() => (node.isFolder ? onOpenFolder(node.id) : onOpenPage(node.id))}
                  />
                ))}
              </div>
            </Section>
          )}

          {/* -- Areas -- */}
          <Section
            title="Areas"
            note="The top level of the workspace"
            action={
              <button
                type="button"
                onClick={() => onNew('folder')}
                className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <FolderPlus className="size-3" /> New area
              </button>
            }
          >
            {data.areas.length === 0 ? (
              <Nothing>
                No areas yet. A folder at the top level is an area: Company, Projects, Policies.
              </Nothing>
            ) : (
              <div className="grid gap-x-6 sm:grid-cols-2">
                {data.areas.map(area => (
                  <button
                    key={area.id}
                    type="button"
                    onClick={() => onOpenFolder(area.id)}
                    className="group flex items-center gap-3 border-b border-border/60 px-1 py-2.5 text-left transition-colors hover:bg-accent/50"
                  >
                    <IconTile icon={iconFor(area)} colour={area.colour} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium leading-tight">
                        {area.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-muted-foreground">
                        {area.summary || count(area.childCount, 'item')}
                      </span>
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            )}
          </Section>

          {/* -- Files -- */}
          {data.files.length > 0 && (
            <Section title="Files" note="The newest things filed in the workspace">
              <div>
                {data.files.map(file => {
                  const isLink = !!file.externalUrl;
                  return (
                    <IndexRow
                      key={file.id}
                      icon={fileIcon(file.filename, isLink)}
                      colour={isLink ? '#2c6fa7' : null}
                      title={file.filename}
                      meta={[
                        isLink ? hostOf(file.externalUrl!) : formatFileSize(file.sizeBytes),
                        file.folderTitle ? `in ${file.folderTitle}` : null,
                        file.uploadedByName,
                      ].filter(Boolean).join(' · ')}
                      trailing={formatRelativeTime(file.createdAt)}
                      onClick={() => file.pageId && onOpenFolder(file.pageId)}
                    />
                  );
                })}
              </div>
            </Section>
          )}

          {/* -- Activity -- */}
          {data.activity.length > 0 && (
            <Section title="Activity" note="What colleagues have been doing here">
              <ul className="space-y-2.5">
                {data.activity.map(entry => (
                  <li key={entry.id} className="flex items-start gap-2.5">
                    <Avatar className="mt-0.5 size-5 shrink-0">
                      <AvatarImage src={entry.member?.profiles?.avatarUrl ?? undefined} alt="" />
                      <AvatarFallback className="text-[9px]">
                        {initialsOf(entry.member?.profiles?.fullName ?? 'NM')}
                      </AvatarFallback>
                    </Avatar>
                    <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {entry.member?.profiles?.fullName ?? 'Someone'}
                      </span>{' '}
                      {entry.title.replace(/^\w/, c => c.toLowerCase())}
                      {entry.description ? ` ${entry.description}` : ''}
                      <span className="ml-1.5 whitespace-nowrap text-muted-foreground/70">
                        {formatRelativeTime(entry.createdAt)}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function QuickAction({
  icon: Icon, label, onClick,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-medium',
        'text-foreground transition-colors hover:border-[--ring] hover:bg-accent/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]',
      )}
    >
      <Icon className="size-3.5 text-muted-foreground" />
      {label}
    </button>
  );
}
