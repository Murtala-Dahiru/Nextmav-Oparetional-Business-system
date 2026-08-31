'use client';

import * as React from 'react';
import { LayoutGrid, FolderKanban, ListTodo } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useFocusRequest } from '@/hooks/use-focus-request';
import { ExportButton } from '@/components/shared/export-button';

import { getList } from './data';
import { ProjectsHome } from './home';
import { ProjectsList } from './list';
import { TasksSection } from './tasks';
import { ProjectWorkspace } from './workspace';
import type { Member, Section } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Projects
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The shape of the module ──────────────────────────────────────────────
 *
 * Three sections and one workspace.
 *
 *   Delivery    the portfolio: what is moving, what is stuck, what is due
 *   Projects    every project, searchable and sortable
 *   Tasks       every task, across projects
 *
 * Opening a project replaces the section with its workspace, which has six
 * panels of its own. It takes over rather than opening beside, because a
 * roadmap, a team and a discussion do not fit in a drawer.
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * Two tabs - Tasks and Projects - with Tasks first and selected on arrival.
 * Entering the delivery module of a business operating system and being shown
 * a paginated table of every task in the company answers a question almost
 * nobody arrives with. The portfolio is the way in now, and Tasks is where it
 * always was, one click along.
 *
 * ── Why sections are local state ─────────────────────────────────────────
 *
 * Every module in this product holds its own sub-navigation in `useState`, and
 * lifting only this one into the sidebar would make it the only one that
 * behaves differently. The design system's carried-forward list names it:
 * sub-items are lifted for all thirteen modules at once, or not at all. What
 * changed here is that the section bar is a real navigation - named
 * destinations with a current one - rather than a `TabsList` of pills.
 *
 * ── Cross-module arrivals ────────────────────────────────────────────────
 *
 * `useFocusRequest` delivers "open this record" from the command palette, the
 * dashboard's attention queue, a customer's 360 panel and the notification
 * tray. The id is held here rather than in a section, because a request for a
 * project can arrive while Tasks is showing: the section switches first, and
 * the id goes down as a prop to a component that is only then mounted.
 */

const SECTIONS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: 'home', label: 'Delivery', icon: LayoutGrid },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
];

export default function ProjectsModule() {
  const [section, setSection] = React.useState<Section>('home');
  const [openProjectId, setOpenProjectId] = React.useState<string | null>(null);
  const [focusTaskId, setFocusTaskId] = React.useState<string | null>(null);
  const [newProject, setNewProject] = React.useState(false);
  const [directory, setDirectory] = React.useState<Member[]>([]);

  /**
   * The directory, fetched once for the whole module.
   *
   * Four screens need it - the owner picker, the assignee picker, the team
   * panel and the mention list - and the module this replaces fetched it four
   * times, twice on mount. It changes about as often as somebody joins the
   * company.
   */
  React.useEffect(() => {
    getList<Member>('/api/directory')
      .then(r => setDirectory(r.data))
      .catch(() => setDirectory([]));
  }, []);

  /** A notification's deep link, read once on arrival. */
  React.useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get('project');
    if (fromLink) setOpenProjectId(fromLink);
  }, []);

  useFocusRequest('projects', ({ type, id }) => {
    if (type === 'project') {
      setSection('projects');
      setOpenProjectId(id);
    } else if (type === 'task') {
      setOpenProjectId(null);
      setSection('tasks');
      setFocusTaskId(id);
    }
  });

  const openProject = React.useCallback((id: string) => {
    setOpenProjectId(id);
  }, []);

  return (
    <div className="flex-1 overflow-auto">
      {/*
        The section bar.

        Sticky, because these screens scroll a long way and losing the way back
        to Delivery behind a thousand pixels of portfolio is the commonest
        complaint about a module laid out this way. It sits on the page's own
        background with a hairline under it, so it reads as part of the frame
        rather than as another card.

        Hidden while a workspace is open: that screen has its own six-panel
        navigation and its own way back, and two rows of tabs stacked on top of
        each other is the reader having to work out which one they are in.
      */}
      {!openProjectId && (
        <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex items-center gap-3 px-4 md:px-6">
            <nav
              aria-label="Projects sections"
              className="-mb-px flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {SECTIONS.map(s => {
                const on = s.id === section;
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSection(s.id)}
                    aria-current={on ? 'page' : undefined}
                    className={cn(
                      'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-3 text-[13px] font-medium transition-colors',
                      on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className={cn('size-3.5', on ? 'opacity-100' : 'opacity-70')} />
                    {s.label}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute inset-x-1.5 bottom-0 h-[2px] rounded-t-full transition-colors',
                        on ? 'bg-foreground' : 'bg-transparent',
                      )}
                    />
                  </button>
                );
              })}
            </nav>

            {/* Export belongs to the data, so it sits with the navigation
                rather than beside a section heading, where it competed with
                that section's own primary action. */}
            <div className="hidden shrink-0 py-2 sm:block">
              <ExportButton
                module="projects"
                datasets={[
                  { key: 'projects', label: 'Projects' },
                  { key: 'tasks', label: 'Tasks' },
                ]}
              />
            </div>
          </div>
        </div>
      )}

      <div className="p-4 md:p-6">
        {openProjectId ? (
          <ProjectWorkspace
            projectId={openProjectId}
            directory={directory}
            onBack={() => setOpenProjectId(null)}
          />
        ) : (
          <>
            {section === 'home' && (
              <ProjectsHome
                onOpenProject={openProject}
                onNewProject={() => { setSection('projects'); setNewProject(true); }}
                onGoProjects={() => setSection('projects')}
              />
            )}

            {section === 'projects' && (
              <ProjectsList
                directory={directory}
                focusNewProject={newProject}
                onNewHandled={() => setNewProject(false)}
                onOpenProject={openProject}
              />
            )}

            {section === 'tasks' && (
              <TasksSection
                directory={directory}
                focusTaskId={focusTaskId}
                onFocusHandled={() => setFocusTaskId(null)}
                onOpenProject={openProject}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
