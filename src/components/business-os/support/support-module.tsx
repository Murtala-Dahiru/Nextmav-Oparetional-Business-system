'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Ticket, Clock, AlertTriangle, CheckCircle2, XCircle,
  CircleDot, BookOpen, Eye, Target, MessageSquare, Lightbulb,
  FileText, Users, Shield, TrendingUp, Filter, ChevronDown,
  HelpCircle, BarChart3, Timer, ArrowUpRight,
} from 'lucide-react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';

import { tickets } from '@/lib/mock-data';
import type { TicketItem } from '@/types';
import { toast } from 'sonner';

/* ---- helpers ---- */

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

const priorityStyles: Record<TicketItem['priority'], string> = {
  low: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  medium: 'bg-amber-100 text-amber-700 border border-amber-200',
  high: 'bg-orange-100 text-orange-700 border border-orange-200',
  urgent: 'bg-red-100 text-red-700 border border-red-200',
};

const statusStyles: Record<TicketItem['status'], string> = {
  open: 'bg-cyan-100 text-cyan-700 border border-cyan-200',
  'in-progress': 'bg-amber-100 text-amber-700 border border-amber-200',
  pending: 'bg-purple-100 text-purple-700 border border-purple-200',
  resolved: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  closed: 'bg-gray-100 text-muted-foreground border border-border',
};

/* ---- summary card counts ---- */

function getStatusCounts(list: TicketItem[]) {
  return {
    open: list.filter(t => t.status === 'open').length,
    'in-progress': list.filter(t => t.status === 'in-progress').length,
    pending: list.filter(t => t.status === 'pending').length,
    resolved: list.filter(t => t.status === 'resolved').length,
    closed: list.filter(t => t.status === 'closed').length,
  };
}

const summaryConfig = [
  { key: 'open' as const, label: 'Open', icon: CircleDot, color: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-50 dark:bg-cyan-950/30' },
  { key: 'in-progress' as const, label: 'In Progress', icon: Clock, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30' },
  { key: 'pending' as const, label: 'Pending', icon: AlertTriangle, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/30' },
  { key: 'resolved' as const, label: 'Resolved', icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  { key: 'closed' as const, label: 'Closed', icon: XCircle, color: 'text-muted-foreground dark:text-muted-foreground', bg: 'bg-gray-50 dark:bg-gray-950/30' },
];

/* ---- knowledge base mock data ---- */

const knowledgeArticles = [
  { id: 'kb1', icon: Lightbulb, title: 'Getting Started Guide', description: 'Learn how to set up your account, configure your workspace, and navigate the platform for the first time.', views: 2847, category: 'Onboarding' },
  { id: 'kb2', icon: FileText, title: 'How to Create Invoices', description: 'Step-by-step guide to creating, sending, and managing invoices for your clients.', views: 1923, category: 'Finance' },
  { id: 'kb3', icon: Target, title: 'Managing Projects', description: 'Everything you need to know about creating projects, assigning tasks, and tracking progress.', views: 3102, category: 'Projects' },
  { id: 'kb4', icon: Shield, title: 'User Permissions Guide', description: 'Understand roles, permissions, and access levels to manage your team effectively.', views: 1456, category: 'Admin' },
  { id: 'kb5', icon: MessageSquare, title: 'API Documentation', description: 'Comprehensive API reference with examples for integrating with external services.', views: 4201, category: 'Developer' },
  { id: 'kb6', icon: BarChart3, title: 'Reporting Basics', description: 'Learn how to generate, customize, and export reports for business insights.', views: 2089, category: 'Reporting' },
];

const kbCategoryColors: Record<string, string> = {
  Onboarding: 'bg-teal-100 text-teal-700',
  Finance: 'bg-emerald-100 text-emerald-700',
  Projects: 'bg-cyan-100 text-cyan-700',
  Admin: 'bg-purple-100 text-purple-700',
  Developer: 'bg-orange-100 text-orange-700',
  Reporting: 'bg-amber-100 text-amber-700',
};

/* ---- SLA tracking mock data ---- */

const slaMetrics = [
  { label: 'Response Time', value: 2.4, target: 4, unit: 'hrs', withinTarget: true, description: 'Average time to first response' },
  { label: 'Resolution Time', value: 18, target: 24, unit: 'hrs', withinTarget: true, description: 'Average time to resolution' },
  { label: 'First Contact Resolution', value: 78, target: 80, unit: '%', withinTarget: false, description: 'Tickets resolved on first contact' },
  { label: 'Customer Satisfaction', value: 4.2, target: 4.0, unit: '/5', withinTarget: true, description: 'Average satisfaction rating' },
];

/* ---- animation variants ---- */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

/* ---- main component ---- */

export default function SupportModule() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const counts = useMemo(() => getStatusCounts(tickets), []);

  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          t.subject.toLowerCase().includes(q) ||
          t.ticketNumber.toLowerCase().includes(q) ||
          t.contactName.toLowerCase().includes(q) ||
          t.assigneeName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [statusFilter, priorityFilter, searchQuery]);

  return (
    <motion.div
      className="space-y-6 p-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Support Desk</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage tickets, knowledge base, and SLA compliance</p>
        </div>
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => toast.success('New ticket created')}>
          <Ticket className="mr-2 h-4 w-4" />
          New Ticket
        </Button>
      </div>

      <Tabs defaultValue="tickets" className="space-y-6">
        <TabsList className="bg-background border border-border p-1">
          <TabsTrigger value="tickets" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <Ticket className="mr-2 h-4 w-4" />
            Tickets
          </TabsTrigger>
          <TabsTrigger value="knowledge" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <BookOpen className="mr-2 h-4 w-4" />
            Knowledge Base
          </TabsTrigger>
          <TabsTrigger value="sla" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <Timer className="mr-2 h-4 w-4" />
            SLA Tracking
          </TabsTrigger>
        </TabsList>

        {/* ===== TAB 1: TICKETS ===== */}
        <TabsContent value="tickets" className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {summaryConfig.map(cfg => {
              const Icon = cfg.icon;
              return (
                <motion.div key={cfg.key} variants={itemVariants}>
                  <Card className="border border-border hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className={cn('p-2 rounded-lg', cfg.bg)}>
                          <Icon className={cn('h-5 w-5', cfg.color)} />
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-foreground">{counts[cfg.key]}</p>
                          <p className="text-xs text-muted-foreground">{cfg.label}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          {/* Filters */}
          <Card className="border border-border">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search tickets..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[160px]">
                    <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                  <SelectTrigger className="w-[160px]">
                    <AlertTriangle className="mr-2 h-4 w-4 text-muted-foreground" />
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Priority</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Tickets Table */}
          <Card className="border border-border">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="font-semibold text-muted-foreground">Ticket #</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Subject</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Priority</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Status</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Category</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Contact</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Assignee</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Created</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Due Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTickets.map(ticket => (
                    <TableRow key={ticket.id} className="hover:bg-emerald-50/30 transition-colors">
                      <TableCell className="font-mono text-sm font-medium text-teal-700">
                        {ticket.ticketNumber}
                      </TableCell>
                      <TableCell className="font-medium text-foreground max-w-[200px] truncate">
                        {ticket.subject}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('text-xs font-medium capitalize', priorityStyles[ticket.priority])}>
                          {ticket.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('text-xs font-medium capitalize', statusStyles[ticket.status])}>
                          {ticket.status.replace('-', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{ticket.category}</TableCell>
                      <TableCell className="text-sm text-foreground">{ticket.contactName}</TableCell>
                      <TableCell className="text-sm text-foreground">
                        {ticket.assigneeName || (
                          <span className="text-muted-foreground italic">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(ticket.createdAt)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(ticket.dueDate)}</TableCell>
                    </TableRow>
                  ))}
                  {filteredTickets.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        No tickets match your filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB 2: KNOWLEDGE BASE ===== */}
        <TabsContent value="knowledge" className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {knowledgeArticles.length} articles available
            </p>
            <Button variant="outline" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={() => toast.info('Article request submitted')}>
              <HelpCircle className="mr-2 h-4 w-4" />
              Submit Article Request
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {knowledgeArticles.map((article, i) => {
              const Icon = article.icon;
              return (
                <motion.div
                  key={article.id}
                  variants={itemVariants}
                  initial="hidden"
                  animate="visible"
                  transition={{ delay: i * 0.05 }}
                >
                  <Card className="border border-border hover:shadow-lg hover:border-emerald-200 transition-all cursor-pointer group h-full" onClick={() => toast.info('Opening article: ' + article.title)}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100 transition-colors">
                          <Icon className="h-5 w-5" />
                        </div>
                        <Badge variant="outline" className={cn('text-xs', kbCategoryColors[article.category])}>
                          {article.category}
                        </Badge>
                      </div>
                      <CardTitle className="text-base font-semibold text-foreground mt-3 leading-snug">
                        {article.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2 mb-4">
                        {article.description}
                      </p>
                      <Separator className="mb-3" />
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Eye className="h-3.5 w-3.5" />
                          <span>{article.views.toLocaleString()} views</span>
                        </div>
                        <div className="flex items-center gap-1 text-teal-600 font-medium group-hover:underline">
                          Read article
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </TabsContent>

        {/* ===== TAB 3: SLA TRACKING ===== */}
        <TabsContent value="sla" className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-50">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">SLA Performance Overview</h3>
              <p className="text-sm text-muted-foreground">Current period vs. target metrics</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {slaMetrics.map((metric, i) => {
              const percent = metric.unit === '/5'
                ? (metric.value / 5) * 100
                : metric.unit === '%'
                  ? metric.value
                  : Math.min((metric.value / metric.target) * 100, 100);
              const targetPercent = metric.unit === '/5'
                ? (metric.target / 5) * 100
                : metric.unit === '%'
                  ? metric.target
                  : 100;

              return (
                <motion.div
                  key={metric.label}
                  variants={itemVariants}
                  initial="hidden"
                  animate="visible"
                  transition={{ delay: i * 0.08 }}
                >
                  <Card className={cn(
                    'border transition-all',
                    metric.withinTarget
                      ? 'border-emerald-200 bg-emerald-50/30'
                      : 'border-amber-200 bg-amber-50/30',
                  )}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="font-semibold text-foreground">{metric.label}</h4>
                          <p className="text-xs text-muted-foreground mt-0.5">{metric.description}</p>
                        </div>
                        <div className={cn(
                          'flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium',
                          metric.withinTarget
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700',
                        )}>
                          {metric.withinTarget ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <AlertTriangle className="h-3 w-3" />
                          )}
                          {metric.withinTarget ? 'On Track' : 'Below Target'}
                        </div>
                      </div>

                      <div className="flex items-baseline gap-2 mb-3">
                        <span className="text-2xl font-bold text-foreground">
                          {metric.unit === '/5' ? `${metric.value}` : metric.value}
                        </span>
                        <span className="text-sm text-muted-foreground">{metric.unit}</span>
                        <span className="text-sm text-muted-foreground ml-auto">
                          Target: {metric.target}{metric.unit}
                        </span>
                      </div>

                      <div className="relative">
                        <Progress
                          value={percent}
                          className={cn(
                            'h-2.5',
                            metric.withinTarget ? '[&>div]:bg-emerald-500' : '[&>div]:bg-amber-500',
                          )}
                        />
                        <div
                          className="absolute top-0 h-2.5 w-0.5 bg-muted-foreground/30 rounded"
                          style={{ left: `${targetPercent}%` }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}