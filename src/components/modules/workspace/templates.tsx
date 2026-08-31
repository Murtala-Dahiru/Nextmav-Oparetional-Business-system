'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Loader2, FileText, FileSpreadsheet, Building2, Package } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { Section, IconTile, ICON_MAP, Nothing } from './ui';
import { getList, post } from './data';
import type { TemplateEntry, WorkspaceNode } from './types';

/**
 * ===========================================================================
 *  Templates
 * ===========================================================================
 *
 *  Two sources in one gallery.
 *
 *  The library shipped with the product is in `lib/workspace-templates.ts`:
 *  identical in every organisation, never edited in place, and copied into a
 *  new page when somebody uses one. An organisation's own template is a
 *  `workspace_pages` row with `is_template = true` - a column that has existed
 *  since the first business migration, is accepted by the create endpoint, is
 *  filterable on the list endpoint, and which no screen has ever set.
 *
 *  That is why "Save as template" is on the page menu rather than being a
 *  separate creation flow: a template is a document somebody already wrote and
 *  wants used again, and asking them to write it twice is how a template
 *  gallery ends up with three entries in it.
 */

export function Templates({
  onCreated, onOpenPage, folders, reloadKey,
}: {
  onCreated: (node: WorkspaceNode) => void;
  onOpenPage: (id: string) => void;
  folders: WorkspaceNode[];
  reloadKey: number;
}) {
  const [entries, setEntries] = React.useState<TemplateEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [using, setUsing] = React.useState<TemplateEntry | null>(null);
  const [kind, setKind] = React.useState<'all' | 'document' | 'sheet'>('all');

  const load = React.useCallback(async () => {
    try {
      setEntries(await getList<TemplateEntry>('/api/workspace/templates'));
    } catch (err: any) {
      toast.error(err.message || 'Could not load the templates');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load, reloadKey]);

  const shown = React.useMemo(
    () => entries.filter(t => kind === 'all' || t.kind === kind),
    [entries, kind],
  );

  const byCategory = React.useMemo(() => {
    const groups = new Map<string, TemplateEntry[]>();
    // The organisation's own come first: they are the ones a company has
    // decided it wants, and burying them under nine shipped categories would
    // make "save as template" feel like it did nothing.
    const own = shown.filter(t => t.source === 'organization');
    if (own.length) groups.set('Your organisation', own);

    for (const entry of shown.filter(t => t.source === 'builtin')) {
      groups.set(entry.category, [...(groups.get(entry.category) ?? []), entry]);
    }
    return [...groups.entries()];
  }, [shown]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <Skeleton className="h-7 w-48" />
        <div className="mt-8 space-y-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="grid gap-6 border-t border-border pt-5 lg:grid-cols-[168px_minmax(0,1fr)]">
              <Skeleton className="h-4 w-24" />
              <div className="grid gap-2 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, j) => <Skeleton key={j} className="h-16 w-full" />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <div className="mb-8">
        <h1 className="text-[21px] font-semibold tracking-[-0.018em]">Templates</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
          A starting point that already knows what questions to ask. Using one copies it into a
          new page, which is then yours to change.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-1">
          {([
            ['all', 'Everything'],
            ['document', 'Documents'],
            ['sheet', 'Spreadsheets'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              aria-pressed={kind === value}
              className={cn(
                'rounded-md px-2 py-1 text-[12.5px] transition-colors',
                kind === value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {byCategory.length === 0 ? (
        <Nothing>No templates of that kind.</Nothing>
      ) : (
        <div className="space-y-8">
          {byCategory.map(([category, items]) => (
            <Section
              key={category}
              title={category}
              note={category === 'Your organisation'
                ? 'Written here, and reusable by everyone'
                : undefined}
            >
              <div className="grid gap-x-6 sm:grid-cols-2">
                {items.map(entry => {
                  const Icon = ICON_MAP[entry.icon]
                    ?? (entry.kind === 'sheet' ? FileSpreadsheet : FileText);

                  return (
                    <div
                      key={`${entry.source}-${entry.id}`}
                      className="group flex items-start gap-3 border-b border-border/60 px-1 py-3"
                    >
                      <IconTile icon={Icon} colour={entry.colour ?? '#2d9572'} />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-medium leading-tight">
                          {entry.title}
                        </p>
                        <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                          {entry.summary}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[11.5px]"
                            onClick={() => setUsing(entry)}
                          >
                            Use
                          </Button>
                          {entry.source === 'organization' && (
                            <button
                              type="button"
                              onClick={() => onOpenPage(entry.id)}
                              className="text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                            >
                              Open the template
                            </button>
                          )}
                          <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                            {entry.source === 'organization'
                              ? <><Building2 className="size-2.5" /> Yours</>
                              : <><Package className="size-2.5" /> Built in</>}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          ))}
        </div>
      )}

      <UseDialog
        key={using ? `${using.source}-${using.id}` : 'closed'}
        entry={using}
        folders={folders}
        onClose={() => setUsing(null)}
        onCreated={(node) => { setUsing(null); onCreated(node); }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function UseDialog({
  entry, folders, onClose, onCreated,
}: {
  entry: TemplateEntry | null;
  folders: WorkspaceNode[];
  onClose: () => void;
  onCreated: (node: WorkspaceNode) => void;
}) {
  const [title, setTitle] = React.useState(entry?.title ?? '');
  const [parentId, setParentId] = React.useState('_root');
  const [saving, setSaving] = React.useState(false);

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Use &ldquo;{entry?.title}&rdquo;</DialogTitle>
          <DialogDescription>
            A copy is made. Changing it afterwards does not change the template.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="template-title">Name</Label>
            <Input id="template-title" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Where it goes</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="_root">Top level</SelectItem>
                {folders.map(folder => (
                  <SelectItem key={folder.id} value={folder.id}>{folder.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!title.trim() || saving}
            onClick={async () => {
              if (!entry) return;
              setSaving(true);
              try {
                const node = await post<WorkspaceNode>('/api/workspace/templates', {
                  source: entry.source,
                  templateId: entry.id,
                  title: title.trim(),
                  parentId: parentId === '_root' ? null : parentId,
                });
                toast.success('Created');
                onCreated(node);
              } catch (err: any) {
                toast.error(err.message || 'Could not create that');
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
