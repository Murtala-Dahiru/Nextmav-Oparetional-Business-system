'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, Play, Pencil, ArrowDown, GitBranch, UserPlus,
  ListPlus, Bell, Clock, Mail, Plus, Search,
  CheckCircle2, XCircle, Timer, Activity, ChevronRight,
  Workflow, Eye, Save, TestTube, GripVertical, Filter,
  ArrowRight, Sparkles, Layers, MousePointerClick,
} from 'lucide-react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

import { workflows } from '@/lib/mock-data';
import type { WorkflowItem } from '@/types';
import { toast } from 'sonner';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDateTime(d: string) {
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const triggerColors: Record<string, string> = {
  'Lead Created': 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  'Schedule (Daily)': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  'Task Created': 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  'Employee Created': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'Schedule (Hourly)': 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

/* Mini flow preview steps per workflow */
const flowSteps: Record<string, [string, string, string]> = {
  w1: ['Lead Created', 'Assign Team', 'Send Email'],
  w2: ['Daily Check', 'Find Overdue', 'Notify Team'],
  w3: ['Task Created', 'Find Assignee', 'Push Notify'],
  w4: ['Employee Joined', 'Create Tasks', 'Welcome Email'],
  w5: ['Hourly Check', 'Check SLA', 'Alert Channel'],
};

/* ------------------------------------------------------------------ */
/*  Fade-up animation variant                                          */
/* ------------------------------------------------------------------ */

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.06, duration: 0.4, ease: 'easeOut' as const },
  }),
};

/* ------------------------------------------------------------------ */
/*  MiniFlowPreview                                                    */
/* ------------------------------------------------------------------ */

function MiniFlowPreview({ workflowId }: { workflowId: string }) {
  const steps = flowSteps[workflowId] ?? ['Trigger', 'Action', 'Action'];
  return (
    <div className="flex items-center gap-1 mt-3">
      {steps.map((label, i) => (
        <div key={i} className="flex items-center gap-1">
          {i > 0 && (
            <ArrowRight className="w-3 h-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />
          )}
          <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap border border-gray-200 dark:border-gray-700">
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 1 – Workflows                                                  */
/* ------------------------------------------------------------------ */

function WorkflowsTab() {
  const [items, setItems] = useState<WorkflowItem[]>(workflows);
  const [search, setSearch] = useState('');

  const filtered = items.filter(
    (w) =>
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      w.description.toLowerCase().includes(search.toLowerCase()),
  );

  const activeCount = items.filter((w) => w.isActive).length;
  const totalExec = items.reduce((s, w) => s + w.executionCount, 0);

  const toggleWorkflow = (id: string) => {
    setItems((prev) =>
      prev.map((w) => (w.id === id ? { ...w, isActive: !w.isActive } : w)),
    );
    const item = items.find(w => w.id === id);
    const name = item?.name ?? 'Workflow';
    toast.success(item?.isActive ? `"${name}" deactivated` : `"${name}" activated`);
  };

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Active Workflows', value: activeCount, icon: Zap, accent: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-50 dark:bg-teal-950/40' },
          { label: 'Total Executions', value: totalExec.toLocaleString(), icon: Activity, accent: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-50 dark:bg-teal-950/40' },
          { label: 'Success Rate', value: '94.2%', icon: CheckCircle2, accent: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40' },
        ].map((s) => (
          <motion.div key={s.label} variants={fadeUp} initial="hidden" animate="visible" custom={0}>
            <Card className="border-0 shadow-sm">
              <CardContent className="flex items-center gap-4 p-5">
                <div className={cn('flex items-center justify-center w-11 h-11 rounded-xl', s.bg)}>
                  <s.icon className={cn('w-5 h-5', s.accent)} />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                  <p className="text-2xl font-bold mt-0.5">{s.value}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Search + filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search workflows..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => toast.info('Filter panel opened')}>
          <Filter className="w-4 h-4" />
          Filter
        </Button>
        <Button size="sm" className="gap-2 bg-teal-600 hover:bg-teal-700 text-white" onClick={() => toast.success('New workflow created')}>
          <Plus className="w-4 h-4" />
          New Workflow
        </Button>
      </div>

      {/* Workflow cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((w, i) => (
          <motion.div
            key={w.id}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={i}
          >
            <Card className="group hover:shadow-md transition-shadow border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-teal-50 dark:bg-teal-950/50 flex-shrink-0 mt-0.5">
                      <Workflow className="w-4.5 h-4.5 text-teal-600 dark:text-teal-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', w.isActive ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600')} />
                        <h3 className="font-semibold text-sm truncate">{w.name}</h3>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{w.description}</p>
                    </div>
                  </div>
                  <Switch
                    checked={w.isActive}
                    onCheckedChange={() => toggleWorkflow(w.id)}
                  />
                </div>

                <div className="flex items-center gap-2 mt-3">
                  <Badge variant="secondary" className={cn('text-[10px] font-medium px-2 py-0', triggerColors[w.trigger] ?? 'bg-gray-100 text-gray-600')}>
                    {w.trigger}
                  </Badge>
                </div>

                <MiniFlowPreview workflowId={w.id} />

                <Separator className="my-3" />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Play className="w-3 h-3" />
                      {w.executionCount} runs
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {timeAgo(w.lastRun)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => toast.info(`Editing "${w.name}"`)}>
                      <Pencil className="w-3 h-3" />
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300" onClick={() => toast.success(`Running "${w.name}"...`)}>
                      <Play className="w-3 h-3" />
                      Run
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 2 – Workflow Builder (the star of the show)                    */
/* ------------------------------------------------------------------ */

interface BuilderStep {
  id: string;
  type: 'trigger' | 'condition' | 'action' | 'delay';
  label: string;
  description: string;
  icon: React.ReactNode;
}

const sampleSteps: BuilderStep[] = [
  { id: 's1', type: 'trigger', label: 'When: Lead Created', description: 'Fires when a new lead enters the CRM', icon: <Zap className="w-4 h-4" /> },
  { id: 's2', type: 'condition', label: 'If: Source = Website', description: 'Only continue for website-sourced leads', icon: <GitBranch className="w-4 h-4" /> },
  { id: 's3', type: 'action', label: 'Assign to: Sales Team', description: 'Route the lead to the sales queue', icon: <UserPlus className="w-4 h-4" /> },
  { id: 's4', type: 'action', label: 'Create Follow-up Task', description: 'Auto-generate a follow-up task for the sales rep', icon: <ListPlus className="w-4 h-4" /> },
  { id: 's5', type: 'action', label: 'Notify Manager', description: 'Send real-time notification to the sales manager', icon: <Bell className="w-4 h-4" /> },
  { id: 's6', type: 'delay', label: 'Wait: 24 hours', description: 'Pause before sending reminder', icon: <Clock className="w-4 h-4" /> },
  { id: 's7', type: 'action', label: 'Send Reminder Email', description: 'Dispatch automated reminder to assigned rep', icon: <Mail className="w-4 h-4" /> },
];

const stepTypeStyles: Record<BuilderStep['type'], { border: string; bg: string; iconBg: string; iconColor: string; badge: string }> = {
  trigger: {
    border: 'border-l-teal-500',
    bg: 'bg-teal-50/50 dark:bg-teal-950/20',
    iconBg: 'bg-teal-100 dark:bg-teal-900/50',
    iconColor: 'text-teal-600 dark:text-teal-400',
    badge: 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300',
  },
  condition: {
    border: 'border-l-amber-500',
    bg: 'bg-amber-50/50 dark:bg-amber-950/20',
    iconBg: 'bg-amber-100 dark:bg-amber-900/50',
    iconColor: 'text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  },
  action: {
    border: 'border-l-emerald-500',
    bg: 'bg-emerald-50/50 dark:bg-emerald-950/20',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/50',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
  },
  delay: {
    border: 'border-l-purple-500',
    bg: 'bg-purple-50/50 dark:bg-purple-950/20',
    iconBg: 'bg-purple-100 dark:bg-purple-900/50',
    iconColor: 'text-purple-600 dark:text-purple-400',
    badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  },
};

const paletteItems = [
  { type: 'trigger' as const, label: 'Trigger', icon: <Zap className="w-4 h-4" />, desc: 'Start the workflow' },
  { type: 'condition' as const, label: 'Condition', icon: <GitBranch className="w-4 h-4" />, desc: 'Branch on logic' },
  { type: 'action' as const, label: 'Action', icon: <Zap className="w-4 h-4" />, desc: 'Do something' },
  { type: 'delay' as const, label: 'Delay', icon: <Clock className="w-4 h-4" />, desc: 'Wait before next' },
];

function WorkflowBuilderTab() {
  const [workflowName, setWorkflowName] = useState('New Lead Assignment');
  const [triggerType, setTriggerType] = useState('event');

  return (
    <div className="space-y-6">
      {/* Builder header */}
      <motion.div variants={fadeUp} initial="hidden" animate="visible" custom={0}>
        <Card className="border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-sm">
          <CardContent className="p-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex-1 min-w-0 space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Workflow Name</label>
                <Input
                  value={workflowName}
                  onChange={(e) => setWorkflowName(e.target.value)}
                  className="text-lg font-semibold h-10 border-0 border-b rounded-none focus-visible:ring-0 px-0 bg-transparent"
                />
              </div>
              <div className="space-y-1 w-full sm:w-56">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Trigger Type</label>
                <Select value={triggerType} onValueChange={setTriggerType}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="event">Event-Based</SelectItem>
                    <SelectItem value="schedule">Schedule</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="webhook">Webhook</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Builder canvas + palette */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6">
        {/* Canvas */}
        <motion.div variants={fadeUp} initial="hidden" animate="visible" custom={1}>
          <Card className="border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-sm overflow-hidden">
            <CardHeader className="pb-3 px-5 pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                  <CardTitle className="text-sm font-semibold">Workflow Steps</CardTitle>
                </div>
                <Badge variant="outline" className="text-[10px] font-medium">
                  {sampleSteps.length} steps
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-6">
              <div className="relative flex flex-col items-center">
                {/* Start node */}
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.1 }}
                  className="w-10 h-10 rounded-full bg-teal-600 dark:bg-teal-500 flex items-center justify-center shadow-lg shadow-teal-600/20 mb-0"
                >
                  <Play className="w-4 h-4 text-white fill-white" />
                </motion.div>

                {/* Connector line */}
                <div className="w-px h-6 bg-gradient-to-b from-teal-500 to-teal-300 dark:from-teal-400 dark:to-teal-600" />

                {/* Steps */}
                <div className="w-full max-w-xl space-y-0">
                  {sampleSteps.map((step, i) => {
                    const style = stepTypeStyles[step.type];
                    return (
                      <motion.div
                        key={step.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.15 + i * 0.08, duration: 0.4, ease: 'easeOut' }}
                      >
                        <div className={cn(
                          'group relative rounded-xl border border-gray-200 dark:border-gray-800 border-l-[4px] bg-white dark:bg-gray-950',
                          'hover:shadow-lg hover:shadow-gray-200/50 dark:hover:shadow-black/20 transition-all duration-200',
                          'hover:-translate-y-0.5',
                          style.border,
                        )}>
                          <CardContent className="flex items-start gap-3 p-4">
                            {/* Drag handle */}
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity pt-0.5 cursor-grab">
                              <GripVertical className="w-4 h-4 text-gray-300 dark:text-gray-600" />
                            </div>

                            {/* Icon */}
                            <div className={cn('flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0', style.iconBg)}>
                              <span className={style.iconColor}>{step.icon}</span>
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className={cn('text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded', style.badge)}>
                                  {step.type}
                                </span>
                              </div>
                              <h4 className="font-semibold text-sm">{step.label}</h4>
                              <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toast.info('Step details')}>
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toast.info('Editing step')}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => toast.error('Step removed')}>
                                <XCircle className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </CardContent>
                        </div>

                        {/* Connector to next step */}
                        {i < sampleSteps.length - 1 && (
                          <div className="flex justify-center py-1">
                            <div className="flex flex-col items-center">
                              <div className="w-px h-4 bg-gradient-to-b from-gray-300 to-gray-200 dark:from-gray-700 dark:to-gray-800" />
                              <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 flex items-center justify-center">
                                <ArrowDown className="w-3 h-3 text-gray-400 dark:text-gray-500" />
                              </div>
                              <div className="w-px h-4 bg-gradient-to-b from-gray-200 to-gray-300 dark:from-gray-800 dark:to-gray-700" />
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>

                {/* End connector */}
                <div className="w-px h-6 bg-gradient-to-b from-emerald-400 to-emerald-300 dark:from-emerald-600 dark:to-emerald-500" />

                {/* End node */}
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.7 }}
                  className="w-10 h-10 rounded-full bg-emerald-600 dark:bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-600/20"
                >
                  <CheckCircle2 className="w-4 h-4 text-white" />
                </motion.div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Right side palette */}
        <motion.div variants={fadeUp} initial="hidden" animate="visible" custom={2}>
          <Card className="border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-sm sticky top-6">
            <CardHeader className="pb-3 px-4 pt-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                Step Palette
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              {paletteItems.map((item) => {
                const style = stepTypeStyles[item.type];
                return (
                  <motion.button
                    key={item.type}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      'w-full flex items-center gap-3 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-3 text-left',
                      'hover:border-teal-400 hover:bg-teal-50/50 dark:hover:bg-teal-950/20',
                      'transition-colors cursor-pointer group',
                    )}
                  >
                    <div className={cn('flex items-center justify-center w-8 h-8 rounded-md', style.iconBg)}>
                      <span className={style.iconColor}>{item.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold">{item.label}</p>
                      <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                    </div>
                    <Plus className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-teal-500 transition-colors" />
                  </motion.button>
                );
              })}

              <Separator className="my-3" />

              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">Quick Add</p>
                {['HTTP Request', 'If/Else', 'Loop', 'Set Variable'].map((q) => (
                  <button
                    key={q}
                    className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    {q}
                  </button>
                ))}
              </div>

              <Separator className="my-3" />

              <div className="rounded-lg bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-teal-950/30 dark:to-emerald-950/30 border border-teal-200/60 dark:border-teal-800/40 p-3">
                <p className="text-xs font-semibold text-teal-700 dark:text-teal-300 mb-1">💡 Tip</p>
                <p className="text-[10px] text-teal-600/80 dark:text-teal-400/80 leading-relaxed">
                  Drag steps from the palette or click to add them to your workflow canvas.
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Bottom action bar */}
      <motion.div variants={fadeUp} initial="hidden" animate="visible" custom={3}>
        <Card className="border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-sm">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MousePointerClick className="w-3.5 h-3.5" />
              Click on any step to configure its properties
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-2" onClick={() => toast.info('Test run started...')}>
                <TestTube className="w-4 h-4" />
                Test Run
              </Button>
              <Button size="sm" className="gap-2 bg-teal-600 hover:bg-teal-700 text-white" onClick={() => toast.success('Workflow saved')}>
                <Save className="w-4 h-4" />
                Save Workflow
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 3 – Execution History                                          */
/* ------------------------------------------------------------------ */

interface ExecutionRecord {
  id: string;
  workflowName: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt: string;
  duration: string;
  triggerData: string;
}

const executionHistory: ExecutionRecord[] = [
  { id: 'e1', workflowName: 'New Lead Assignment', status: 'completed', startedAt: '2026-07-20T10:30:00Z', completedAt: '2026-07-20T10:30:02Z', duration: '2.1s', triggerData: '{"leadId":"l-901","name":"BrightWay Corp","source":"website"}' },
  { id: 'e2', workflowName: 'Task Assignment Notification', status: 'completed', startedAt: '2026-07-20T10:15:00Z', completedAt: '2026-07-20T10:15:01Z', duration: '1.4s', triggerData: '{"taskId":"t-342","assignee":"John Smith","priority":"high"}' },
  { id: 'e3', workflowName: 'Invoice Overdue Alert', status: 'running', startedAt: '2026-07-20T10:00:00Z', completedAt: '—', duration: '—', triggerData: '{"checkType":"daily","overdueInvoices":3}' },
  { id: 'e4', workflowName: 'SLA Breach Warning', status: 'failed', startedAt: '2026-07-20T09:45:00Z', completedAt: '2026-07-20T09:45:05Z', duration: '5.2s', triggerData: '{"ticketId":"tk-088","slaMinutesLeft":15,"priority":"critical"}' },
  { id: 'e5', workflowName: 'Welcome New Employee', status: 'completed', startedAt: '2026-07-20T09:30:00Z', completedAt: '2026-07-20T09:30:03Z', duration: '3.0s', triggerData: '{"employeeId":"emp-045","name":"Amanda Wilson","dept":"Engineering"}' },
  { id: 'e6', workflowName: 'New Lead Assignment', status: 'completed', startedAt: '2026-07-20T09:15:00Z', completedAt: '2026-07-20T09:15:02Z', duration: '1.8s', triggerData: '{"leadId":"l-900","name":"TechStart Inc","source":"referral"}' },
  { id: 'e7', workflowName: 'Task Assignment Notification', status: 'completed', startedAt: '2026-07-20T09:00:00Z', completedAt: '2026-07-20T09:00:01Z', duration: '1.2s', triggerData: '{"taskId":"t-341","assignee":"Sarah Chen","priority":"medium"}' },
  { id: 'e8', workflowName: 'Invoice Overdue Alert', status: 'failed', startedAt: '2026-07-20T08:30:00Z', completedAt: '2026-07-20T08:30:04Z', duration: '4.1s', triggerData: '{"checkType":"daily","overdueInvoices":5}' },
  { id: 'e9', workflowName: 'New Lead Assignment', status: 'completed', startedAt: '2026-07-20T08:15:00Z', completedAt: '2026-07-20T08:15:02Z', duration: '1.9s', triggerData: '{"leadId":"l-899","name":"CloudNine","source":"website"}' },
  { id: 'e10', workflowName: 'Welcome New Employee', status: 'completed', startedAt: '2026-07-20T08:00:00Z', completedAt: '2026-07-20T08:00:03Z', duration: '2.7s', triggerData: '{"employeeId":"emp-044","name":"James Lee","dept":"Design"}' },
];

const statusConfig: Record<ExecutionRecord['status'], { badge: string; dot: string; label: string }> = {
  running: { badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', dot: 'bg-amber-500 animate-pulse', label: 'Running' },
  completed: { badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', dot: 'bg-emerald-500', label: 'Completed' },
  failed: { badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', dot: 'bg-red-500', label: 'Failed' },
};

function ExecutionHistoryTab() {
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const filtered = executionHistory.filter(
    (e) => filterStatus === 'all' || e.status === filterStatus,
  );

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Runs', value: '656', icon: Activity, accent: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-50 dark:bg-teal-950/40' },
          { label: 'Success Rate', value: '94.2%', icon: CheckCircle2, accent: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40' },
          { label: 'Avg Duration', value: '2.3s', icon: Timer, accent: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-50 dark:bg-teal-950/40' },
          { label: 'Failed', value: '38', icon: XCircle, accent: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/40' },
        ].map((s, i) => (
          <motion.div key={s.label} variants={fadeUp} initial="hidden" animate="visible" custom={i}>
            <Card className="border-0 shadow-sm">
              <CardContent className="flex items-center gap-4 p-5">
                <div className={cn('flex items-center justify-center w-11 h-11 rounded-xl', s.bg)}>
                  <s.icon className={cn('w-5 h-5', s.accent)} />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                  <p className="text-2xl font-bold mt-0.5">{s.value}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          Showing {filtered.length} of {executionHistory.length} records
        </span>
      </div>

      {/* Table */}
      <motion.div variants={fadeUp} initial="hidden" animate="visible" custom={4}>
        <Card className="border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/80 dark:bg-gray-900/50 hover:bg-gray-50/80 dark:hover:bg-gray-900/50">
                <TableHead className="text-xs font-semibold uppercase tracking-wider">Workflow</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider">Started</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider">Completed</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider">Duration</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider">Trigger Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((record, i) => {
                const cfg = statusConfig[record.status];
                return (
                  <motion.tr
                    key={record.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.05 * i }}
                    className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-900/30 transition-colors"
                  >
                    <TableCell className="py-3">
                      <div className="flex items-center gap-2">
                        <Workflow className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                        <span className="text-sm font-medium">{record.workflowName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full', cfg.badge)}>
                        <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
                        {cfg.label}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground">{formatDateTime(record.startedAt)}</TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground">{record.completedAt === '—' ? '—' : formatDateTime(record.completedAt)}</TableCell>
                    <TableCell className="py-3">
                      <span className={cn(
                        'text-xs font-mono font-medium',
                        record.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
                      )}>
                        {record.duration}
                      </span>
                    </TableCell>
                    <TableCell className="py-3">
                      <code className="text-[10px] font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-muted-foreground max-w-[240px] truncate block">
                        {record.triggerData}
                      </code>
                    </TableCell>
                  </motion.tr>
                );
              })}
            </TableBody>
          </Table>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Automation Module                                             */
/* ------------------------------------------------------------------ */

export default function AutomationModule() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Tabs defaultValue="workflows" className="flex flex-col flex-1 overflow-hidden">
        <div className="px-6 pt-6 pb-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <Zap className="w-6 h-6 text-teal-600 dark:text-teal-400" />
                Automation
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Build and manage workflows to automate your business processes
              </p>
            </div>
          </div>
          <TabsList className="bg-gray-100 dark:bg-gray-900 p-1">
            <TabsTrigger value="workflows" className="gap-2 text-xs font-medium data-[state=active]:bg-white data-[state=active]:dark:bg-gray-950 data-[state=active]:shadow-sm">
              <Workflow className="w-3.5 h-3.5" />
              Workflows
            </TabsTrigger>
            <TabsTrigger value="builder" className="gap-2 text-xs font-medium data-[state=active]:bg-white data-[state=active]:dark:bg-gray-950 data-[state=active]:shadow-sm">
              <GitBranch className="w-3.5 h-3.5" />
              Workflow Builder
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2 text-xs font-medium data-[state=active]:bg-white data-[state=active]:dark:bg-gray-950 data-[state=active]:shadow-sm">
              <Activity className="w-3.5 h-3.5" />
              Execution History
            </TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="flex-1 mt-4">
          <div className="px-6 pb-8">
            <AnimatePresence mode="wait">
              <TabsContent value="workflows" className="mt-0">
                <WorkflowsTab />
              </TabsContent>
              <TabsContent value="builder" className="mt-0">
                <WorkflowBuilderTab />
              </TabsContent>
              <TabsContent value="history" className="mt-0">
                <ExecutionHistoryTab />
              </TabsContent>
            </AnimatePresence>
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  );
}