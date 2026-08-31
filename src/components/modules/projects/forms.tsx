'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { createProjectSchema, createTaskSchema } from '@/lib/validations';
import { PROJECT_STATUSES, TASK_STATUSES } from '@/lib/constants';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

import { post, put, getList } from './data';
import {
  PROJECT_STATUS_LABELS, TASK_STATUS_LABELS, PRIORITY_LABELS, PRIORITY_VALUES,
  type Member, type Person, type Task, type Milestone,
} from './types';

/**
 * What the dialog needs to open on an existing project.
 *
 * Declared rather than reusing `PortfolioProject`, because two callers open
 * this - the list, which holds a portfolio row, and the workspace, which holds
 * a project from a different endpoint. Naming the fields the form actually
 * reads means neither has to be cast to the other's shape.
 */
export interface EditableProject {
  id: string;
  name: string;
  description: string;
  status: string;
  priority: string;
  budget: number;
  startDate: string | null;
  endDate: string | null;
  clientCompanyId?: string | null;
  owner?: Person | null;
  client?: { id: string; name: string } | null;
  department?: { id: string; name: string } | null;
}

type ProjectValues = z.infer<typeof createProjectSchema>;
type TaskValues = z.infer<typeof createTaskSchema>;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Creating and editing
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Both dialogs in one file because they share a shape: a required first field,
 * two columns of pickers, a footer. Keeping them together is what stops the
 * task form drifting into a different rhythm from the project form, which is
 * the commonest way a module starts to feel assembled rather than designed.
 *
 * ── The field group ──────────────────────────────────────────────────────
 *
 * `Field` exists because the module this replaces wrote
 * `<div className="space-y-2"><Label/>…<p className="text-sm text-destructive">`
 * fourteen times, and three of those fourteen forgot the error line - so a
 * rejected value on those fields did nothing visible at all.
 */

function Field({
  label, htmlFor, error, hint, children, className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-[12.5px] font-medium text-foreground">
        {label}
      </Label>
      {children}
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
      {!error && hint ? <p className="text-[12px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Project                                                                   */
/* -------------------------------------------------------------------------- */

export function ProjectDialog({
  open, onOpenChange, editing, directory, onSaved, onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project being edited, or null to create one. */
  editing: EditableProject | null;
  directory: Member[];
  onSaved: (project: { id: string }) => void;
  onDelete?: () => void;
}) {
  const [saving, setSaving] = React.useState(false);
  /**
   * `null` until the request answers.
   *
   * An empty array on first render meant the hint said "No companies in the
   * CRM yet" for the third of a second before the list arrived - a sentence
   * that is false, about the thing the field is for, at exactly the moment
   * somebody is reading the field.
   */
  const [companies, setCompanies] = React.useState<{ id: string; name: string }[] | null>(null);
  const [templateName, setTemplateName] = React.useState('');

  /**
   * The organisation's project vocabulary, from the Admin module.
   *
   * `project_defaults` holds statuses, priorities, a default status, a default
   * priority and a set of templates. The administration screen renders and
   * saves all of it and the settings endpoint stores it - and the old form
   * read none of it, so an organisation that renamed its stages saw the change
   * on the settings screen and nowhere else.
   */
  const policies = useAppStore(s => s.organization?.policies);
  const defaults = (policies?.projectDefaults ?? {}) as {
    statuses?: string[];
    priorities?: string[];
    defaultStatus?: string;
    defaultPriority?: string;
    templates?: { name: string; description: string; milestones: string[] }[];
  };

  const statusOptions = React.useMemo(() => {
    const configured = (defaults.statuses ?? []).filter(s => (PROJECT_STATUSES as readonly string[]).includes(s));
    return configured.length ? configured : [...PROJECT_STATUSES];
  }, [defaults.statuses]);

  const priorityOptions = React.useMemo(() => {
    const configured = (defaults.priorities ?? []).filter(p => PRIORITY_VALUES.includes(p));
    return configured.length ? configured : PRIORITY_VALUES;
  }, [defaults.priorities]);

  /**
   * Only offer a default the list actually contains.
   *
   * An administrator can remove `planning` from the statuses without touching
   * `defaultStatus`, and a Radix Select whose value is not among its items
   * shows the placeholder - so the form would open apparently blank on a
   * required field.
   */
  const defaultStatus = statusOptions.includes(defaults.defaultStatus ?? '')
    ? defaults.defaultStatus!
    : statusOptions[0];
  const defaultPriority = priorityOptions.includes(defaults.defaultPriority ?? '')
    ? defaults.defaultPriority!
    : (priorityOptions.includes('medium') ? 'medium' : priorityOptions[0]);

  const templates = defaults.templates ?? [];

  /**
   * Departments, taken from the directory rather than from `/api/admin`.
   *
   * That endpoint requires the admin module, so for a manager creating a
   * project the picker would be empty - which reads as "this company has no
   * departments" rather than as a permission error. Every member carries their
   * own department, so the list is already in the response this screen has.
   */
  const departments = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of directory) {
      if (m.departmentId && m.departmentName) seen.set(m.departmentId, m.departmentName);
    }
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [directory]);

  const { register, handleSubmit, control, reset, setValue, formState: { errors } } =
    useForm<ProjectValues>({
      resolver: zodResolver(createProjectSchema) as never,
      defaultValues: {
        name: '', description: '', status: 'planning', priority: 'medium',
        startDate: null, endDate: null, budget: 0, ownerId: undefined,
        clientCompanyId: null, departmentId: null,
      },
    });

  React.useEffect(() => {
    if (!open) return;
    setTemplateName('');
    reset(editing
      ? {
          name: editing.name,
          description: editing.description ?? '',
          status: editing.status,
          priority: editing.priority,
          startDate: editing.startDate ? editing.startDate.slice(0, 10) : null,
          endDate: editing.endDate ? editing.endDate.slice(0, 10) : null,
          budget: Number(editing.budget ?? 0),
          ownerId: editing.owner?.id,
          // Carried into the edit form so opening a linked project and saving
          // it does not silently unlink the client.
          clientCompanyId: editing.clientCompanyId ?? editing.client?.id ?? null,
          departmentId: editing.department?.id ?? null,
        }
      : {
          name: '', description: '', status: defaultStatus, priority: defaultPriority,
          startDate: null, endDate: null, budget: 0, ownerId: undefined,
          clientCompanyId: null, departmentId: null,
        });
  }, [open, editing, reset, defaultStatus, defaultPriority]);

  React.useEffect(() => {
    if (!open) return;
    /**
     * Companies are best-effort.
     *
     * A role that can create projects but has no CRM access should still get
     * the form. It simply cannot attach a client, and the picker says so
     * rather than the whole dialog failing to populate.
     */
    setCompanies(null);
    getList<{ id: string; name: string }>('/api/crm/companies?pageSize=100')
      .then(r => setCompanies(r.data))
      .catch(() => setCompanies([]));
  }, [open]);

  const applyTemplate = React.useCallback((name: string) => {
    setTemplateName(name);
    const t = templates.find(x => x.name === name);
    if (!t) return;
    setValue('name', t.name);
    if (t.description) setValue('description', t.description);
  }, [templates, setValue]);

  const onSubmit = React.useCallback(async (values: ProjectValues) => {
    setSaving(true);
    try {
      const payload = {
        ...values,
        startDate: values.startDate || null,
        endDate: values.endDate || null,
      };

      if (editing) {
        await put(`/api/projects/projects/${editing.id}`, payload);
        toast.success('Project updated');
        onSaved({ id: editing.id });
      } else {
        const created = await post<{ id: string }>('/api/projects/projects', payload);

        /**
         * A template's phases, created against the new project.
         *
         * Sequentially rather than in parallel: `sort_order` is what puts a
         * roadmap in the order somebody wrote it, and firing five creates at
         * once means five rows whose order depends on which request the
         * database happens to serve first.
         *
         * A failure here is reported but does not undo the project. Losing a
         * project because one of its phases could not be written is a far
         * worse outcome than a roadmap somebody finishes by hand, and the
         * message says which happened.
         */
        const phases = templates.find(t => t.name === templateName)?.milestones ?? [];
        if (created?.id && phases.length) {
          try {
            for (let i = 0; i < phases.length; i++) {
              await post('/api/projects/milestones', {
                projectId: created.id, name: phases[i], sortOrder: i,
              });
            }
            toast.success(`Project created with ${phases.length} phases`);
          } catch {
            toast.warning('Project created, but its phases could not be added.');
          }
        } else {
          toast.success('Project created');
        }
        onSaved(created);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [editing, onSaved, onOpenChange, templateName, templates]);

  const chosenTemplate = templates.find(t => t.name === templateName);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Project details' : 'New project'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Changing the status or the end date tells everyone on the project.'
              : 'A project is the unit of delivery. Phases and tasks go inside it.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {/*
            Templates, from the organisation's own settings.

            Offered only when creating: applying a template to an existing
            project would either duplicate its phases or silently replace them,
            and neither is what anybody means by the word. Hidden entirely when
            none are configured, rather than showing an empty picker that reads
            as a broken control.
          */}
          {!editing && templates.length > 0 && (
            <Field
              label="Start from a template"
              hint={chosenTemplate
                ? `${chosenTemplate.milestones.length} phases: ${chosenTemplate.milestones.join(' → ')}`
                : undefined}
            >
              <Select
                value={templateName || '_blank'}
                onValueChange={v => (v === '_blank' ? setTemplateName('') : applyTemplate(v))}
              >
                <SelectTrigger><SelectValue placeholder="Blank project" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_blank">Blank project</SelectItem>
                  {templates.map(t => <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field label="Name" htmlFor="proj-name" error={errors.name?.message}>
            <Input id="proj-name" {...register('name')} placeholder="Website relaunch" autoFocus />
          </Field>

          <Field label="What it is" htmlFor="proj-desc">
            <Textarea
              id="proj-desc" rows={2} {...register('description')}
              placeholder="One or two lines somebody joining the project would need."
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <Controller
                control={control} name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {statusOptions.map(s => (
                        <SelectItem key={s} value={s}>{PROJECT_STATUS_LABELS[s] ?? s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field label="Priority">
              <Controller
                control={control} name="priority"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {priorityOptions.map(p => (
                        <SelectItem key={p} value={p}>{PRIORITY_LABELS[p] ?? p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" htmlFor="proj-start">
              <Input id="proj-start" type="date" {...register('startDate')} />
            </Field>
            <Field
              label="Target completion"
              htmlFor="proj-end"
              error={errors.endDate?.message}
              hint="Health turns off track once this date passes."
            >
              <Input id="proj-end" type="date" {...register('endDate')} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Owner" hint="Accountable for delivery.">
              <Controller
                control={control} name="ownerId"
                render={({ field }) => (
                  <Select
                    value={field.value || '_me'}
                    onValueChange={v => field.onChange(v === '_me' ? undefined : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="You" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_me">Me</SelectItem>
                      {directory.map(u => (
                        <SelectItem key={u.memberId} value={u.memberId}>{u.fullName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field label="Budget" htmlFor="proj-budget">
              <Input
                id="proj-budget" type="number" step="0.01" min="0" placeholder="0"
                {...register('budget', { valueAsNumber: true })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/*
              The client, and what selecting one actually does.

              This is the link between the CRM and the client portal. Every
              portal read resolves through `projects.client_company_id`: the RLS
              policy `projects_client_select` matches it against
              `auth_client_company_id()`, so choosing a company here grants that
              customer's portal accounts visibility of this project
              immediately. There is no second permission to grant and no second
              progress figure - the portal reads the same `v_project_health` row
              this screen does.
            */}
            <Field
              label="Client"
              hint={companies?.length === 0
                ? 'No companies in the CRM yet.'
                : 'Their portal shows the roadmap, progress and shared files.'}
            >
              <Controller
                control={control} name="clientCompanyId"
                render={({ field }) => (
                  <Select
                    value={field.value || '_internal'}
                    onValueChange={v => field.onChange(v === '_internal' ? null : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Internal" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_internal">Internal, no client</SelectItem>
                      {(companies ?? []).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field label="Department">
              <Controller
                control={control} name="departmentId"
                render={({ field }) => (
                  <Select
                    value={field.value || '_none'}
                    onValueChange={v => field.onChange(v === '_none' ? null : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">None</SelectItem>
                      {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {editing && onDelete ? (
              <Button
                type="button" variant="ghost"
                className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => { onOpenChange(false); onDelete(); }}
              >
                <Trash2 className="size-4" /> Delete
              </Button>
            ) : <span />}
            <span className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                {editing ? 'Save' : 'Create project'}
              </Button>
            </span>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Task                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * ── Two fields that could never be set before ────────────────────────────
 *
 * `tasks.milestone_id` has a foreign key, an index, a roadmap that groups by
 * it and a create handler that refuses a phase from another project - and it
 * was missing from `createTaskSchema`, so `zodResolver` stripped it out of
 * every request before it was sent. There was no way, anywhere in the product,
 * to put a task on a phase. `parent_task_id` is the same story for subtasks.
 *
 * Both are here now, and both are conditional on a project being chosen: a
 * personal task cannot have a phase (the endpoint refuses it, because a
 * milestone belongs to a project) and a subtask has to sit under a task on the
 * same project.
 */
export function TaskDialog({
  open, onOpenChange, editing, directory, projects, defaultProjectId, defaultMilestoneId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Task | null;
  directory: Member[];
  projects: { id: string; name: string }[];
  /** Pre-selected when raising a task from inside a project. */
  defaultProjectId?: string | null;
  defaultMilestoneId?: string | null;
  onSaved: () => void;
}) {
  const [saving, setSaving] = React.useState(false);
  const [milestones, setMilestones] = React.useState<Milestone[]>([]);
  const [siblings, setSiblings] = React.useState<Task[]>([]);

  const { register, handleSubmit, control, reset, watch, formState: { errors } } =
    useForm<TaskValues>({
      resolver: zodResolver(createTaskSchema) as never,
      defaultValues: {
        title: '', description: '', status: 'todo', priority: 'medium',
        assigneeId: undefined, projectId: '', dueDate: null,
        estimatedHours: 0, loggedHours: 0, milestoneId: null, parentTaskId: null,
      },
    });

  const projectId = watch('projectId');

  React.useEffect(() => {
    if (!open) return;
    reset(editing
      ? {
          title: editing.title,
          description: editing.description ?? '',
          status: editing.status,
          priority: editing.priority,
          assigneeId: editing.assignee?.id ?? editing.assigneeId ?? undefined,
          projectId: editing.projectId ?? editing.project?.id ?? '',
          dueDate: editing.dueDate ? editing.dueDate.slice(0, 10) : null,
          estimatedHours: Number(editing.estimatedHours ?? 0),
          loggedHours: Number(editing.loggedHours ?? 0),
          milestoneId: editing.milestoneId ?? null,
          parentTaskId: editing.parentTaskId ?? null,
        }
      : {
          title: '', description: '', status: 'todo', priority: 'medium',
          assigneeId: undefined,
          projectId: defaultProjectId ?? '',
          dueDate: null, estimatedHours: 0, loggedHours: 0,
          milestoneId: defaultMilestoneId ?? null,
          parentTaskId: null,
        });
  }, [open, editing, reset, defaultProjectId, defaultMilestoneId]);

  /**
   * The phases and the tasks of whichever project is selected.
   *
   * Refetched when the project changes rather than loaded once for all
   * projects: a workspace with forty projects would otherwise pull every
   * milestone in the organisation to populate a picker showing six of them.
   */
  React.useEffect(() => {
    if (!open || !projectId) { setMilestones([]); setSiblings([]); return; }
    let cancelled = false;
    (async () => {
      const [ms, ts] = await Promise.all([
        getList<Milestone>(`/api/projects/milestones?projectId=${projectId}&pageSize=100`)
          .catch(() => ({ data: [] as Milestone[] })),
        getList<Task>(`/api/projects/tasks?projectId=${projectId}&pageSize=100`)
          .catch(() => ({ data: [] as Task[] })),
      ]);
      if (cancelled) return;
      setMilestones(ms.data);
      setSiblings(ts.data);
    })();
    return () => { cancelled = true; };
  }, [open, projectId]);

  const onSubmit = React.useCallback(async (values: TaskValues) => {
    setSaving(true);
    try {
      const payload = {
        ...values,
        dueDate: values.dueDate || null,
        loggedHours: values.loggedHours ?? 0,
        sortOrder: values.sortOrder ?? 0,
        // A phase belongs to a project, so a task with no project cannot have
        // one. Cleared here rather than left for the endpoint to refuse.
        milestoneId: values.projectId ? (values.milestoneId || null) : null,
        parentTaskId: values.projectId ? (values.parentTaskId || null) : null,
      };
      if (editing) {
        await put(`/api/projects/tasks/${editing.id}`, payload);
        toast.success('Task updated');
      } else {
        await post('/api/projects/tasks', payload);
        toast.success('Task created');
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [editing, onOpenChange, onSaved]);

  /**
   * A task cannot be its own parent, and subtasks go one level deep.
   *
   * The endpoint enforces both. Filtering the picker as well means the rule is
   * visible rather than only discoverable by hitting it, which is the
   * difference between a constraint and an error message.
   */
  const parentOptions = siblings.filter(t => t.id !== editing?.id && !t.parentTaskId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Task' : 'New task'}</DialogTitle>
          <DialogDescription>
            {projectId
              ? 'Assigning it tells the person, and it appears on their My Work.'
              : 'Without a project this is a personal task, visible only to you.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Field label="Title" htmlFor="task-title" error={errors.title?.message}>
            <Input id="task-title" {...register('title')} placeholder="Draft the migration plan" autoFocus />
          </Field>

          <Field label="Detail" htmlFor="task-desc">
            <Textarea id="task-desc" rows={2} {...register('description')} placeholder="Optional." />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project" error={errors.projectId?.message}>
              <Controller
                control={control} name="projectId"
                render={({ field }) => (
                  <Select value={field.value || '_none'} onValueChange={v => field.onChange(v === '_none' ? '' : v)}>
                    <SelectTrigger><SelectValue placeholder="Personal task" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Personal task</SelectItem>
                      {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field
              label="Phase"
              hint={!projectId
                ? 'Choose a project first.'
                : milestones.length === 0 ? 'This project has no roadmap yet.' : undefined}
            >
              <Controller
                control={control} name="milestoneId"
                render={({ field }) => (
                  <Select
                    value={field.value || '_none'}
                    onValueChange={v => field.onChange(v === '_none' ? null : v)}
                    disabled={!projectId || milestones.length === 0}
                  >
                    <SelectTrigger><SelectValue placeholder="Unphased" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Unphased</SelectItem>
                      {milestones.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <Controller
                control={control} name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TASK_STATUSES.map(s => (
                        <SelectItem key={s} value={s}>{TASK_STATUS_LABELS[s] ?? s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field label="Priority">
              <Controller
                control={control} name="priority"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRIORITY_VALUES.map(p => (
                        <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Assignee"
              hint={!projectId
                ? 'A personal task is always yours.'
                : directory.length === 0 ? 'No colleagues in this workspace yet.' : undefined}
            >
              <Controller
                control={control} name="assigneeId"
                render={({ field }) => (
                  <Select
                    value={field.value || '_unassigned'}
                    onValueChange={v => field.onChange(v === '_unassigned' ? undefined : v)}
                    disabled={!projectId}
                  >
                    <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      {/*
                        Explicitly unassigned, rather than leaving the field
                        blank. Radix Select treats "" as "no value" and shows
                        the placeholder, so there was no way to *clear* an
                        assignee once one had been chosen.
                      */}
                      <SelectItem value="_unassigned">Unassigned</SelectItem>
                      {directory.map(u => (
                        <SelectItem key={u.memberId} value={u.memberId}>
                          {u.fullName}
                          {u.jobTitle && (
                            <span className="ml-1.5 text-xs text-muted-foreground">{u.jobTitle}</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field label="Due" htmlFor="task-due">
              <Input id="task-due" type="date" {...register('dueDate')} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Estimate (hours)" htmlFor="task-est">
              <Input
                id="task-est" type="number" step="0.5" min="0"
                {...register('estimatedHours', { valueAsNumber: true })}
              />
            </Field>

            <Field
              label="Subtask of"
              hint={parentOptions.length === 0 && projectId ? 'No other tasks on this project yet.' : undefined}
            >
              <Controller
                control={control} name="parentTaskId"
                render={({ field }) => (
                  <Select
                    value={field.value || '_none'}
                    onValueChange={v => field.onChange(v === '_none' ? null : v)}
                    disabled={!projectId || parentOptions.length === 0}
                  >
                    <SelectTrigger><SelectValue placeholder="Nothing" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Nothing</SelectItem>
                      {parentOptions.map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {editing ? 'Save' : 'Create task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
