'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Search, DollarSign, Target, TrendingUp, Users,
  Building2, Handshake, Mail, Phone, Globe, MapPin,
  CalendarDays, UserCircle, ChevronRight, ArrowUpDown,
  Briefcase, Sparkles, CircleDot, GripVertical, BarChart3,
} from 'lucide-react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';

import {
  leads, contacts, crmCompanies, opportunities, pipeline,
} from '@/lib/mock-data';
import type {
  LeadItem, ContactItem, CrmCompanyItem, OpportunityItem, PipelineItem,
} from '@/types';

/* ---- helpers ---- */

function formatCurrency(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

function formatNumber(v: number) {
  return new Intl.NumberFormat('en-US').format(v);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const statusColors: Record<LeadItem['status'], string> = {
  new: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  contacted: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  qualified: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  proposal: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  negotiation: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  won: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  lost: 'bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-400',
};

function scoreColor(score: number) {
  if (score >= 71) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 41) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function scoreBarColor(score: number) {
  if (score >= 71) return 'bg-emerald-500';
  if (score >= 41) return 'bg-amber-500';
  return 'bg-red-500';
}

const avatarPalette = [
  'bg-teal-600 text-white',
  'bg-indigo-600 text-white',
  'bg-rose-600 text-white',
  'bg-amber-600 text-white',
  'bg-violet-600 text-white',
  'bg-cyan-600 text-white',
  'bg-pink-600 text-white',
  'bg-lime-600 text-white',
];

function avatarColor(index: number) {
  return avatarPalette[index % avatarPalette.length];
}

/* ---- sub-view header ---- */

function TabHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Button className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
        <Plus className="size-4" />
        New
      </Button>
    </div>
  );
}

/* ---- Kanban opportunity card ---- */

function OpportunityCard({ opp, index }: { opp: OpportunityItem; index: number }) {
  const stageColor = pipeline.stages.find((s) => s.id === opp.stageId)?.color ?? '#6366f1';
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.05 }}
      whileHover={{ y: -3, boxShadow: '0 8px 24px rgba(0,0,0,0.10)' }}
      className="bg-card border border-border/70 rounded-lg p-3.5 cursor-pointer transition-colors hover:border-teal-300/60 dark:hover:border-teal-600/50"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium leading-tight text-foreground">{opp.name}</p>
        <GripVertical className="size-3.5 text-muted-foreground/50 shrink-0 mt-0.5" />
      </div>
      <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
        <Building2 className="size-3" />
        {opp.companyName}
      </p>
      <div className="flex items-end justify-between">
        <span className="text-base font-bold text-foreground">{formatCurrency(opp.value)}</span>
        <span
          className="text-xs font-medium px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: `${stageColor}18`, color: stageColor }}
        >
          {opp.probability}%
        </span>
      </div>
      <div className="mt-3 pt-2.5 border-t border-border/50 flex items-center justify-between">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <CalendarDays className="size-3" />
          {formatDate(opp.closeDate)}
        </span>
        <div
          className="size-6 rounded-full flex items-center justify-center text-[10px] font-bold"
          style={{ backgroundColor: `${stageColor}22`, color: stageColor }}
          title={opp.ownerName}
        >
          {getInitials(opp.ownerName)}
        </div>
      </div>
    </motion.div>
  );
}

/* ---- Tab 1: Pipeline Kanban ---- */

function PipelineView() {
  return (
    <div className="space-y-4">
      <TabHeader title="Sales Pipeline" description="Track and manage your deals through every stage" />

      {/* pipeline summary bar */}
      <div className="flex items-center gap-4 px-1">
        <div className="flex items-center gap-2 text-sm">
          <Target className="size-4 text-teal-600" />
          <span className="font-medium text-foreground">{pipeline.name}</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <span className="text-sm text-muted-foreground">
          {pipeline.stages.reduce((a, s) => a + s.opportunityCount, 0)} deals
        </span>
        <div className="h-4 w-px bg-border" />
        <span className="text-sm font-semibold text-teal-600 dark:text-teal-400">
          {formatCurrency(pipeline.totalValue)}
        </span>
      </div>

      {/* kanban board */}
      <div className="flex gap-4 overflow-x-auto pb-4 pr-2">
        {pipeline.stages.map((stage, si) => {
          const stageOpps = opportunities.filter((o) => o.stageId === stage.id);
          return (
            <div
              key={stage.id}
              className="flex-shrink-0 w-72 flex flex-col rounded-xl bg-muted/40 border border-border/50"
            >
              {/* column header */}
              <div
                className="px-3.5 py-3 rounded-t-xl flex flex-col gap-1.5"
                style={{ background: `linear-gradient(135deg, ${stage.color}12, ${stage.color}06)` }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="size-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                    <span className="text-sm font-semibold text-foreground">{stage.name}</span>
                  </div>
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: `${stage.color}1A`, color: stage.color }}
                  >
                    {stageOpps.length}
                  </span>
                </div>
                <span className="text-xs font-medium" style={{ color: stage.color }}>
                  {formatCurrency(stageOpps.reduce((a, o) => a + o.value, 0))}
                </span>
              </div>

              {/* cards area */}
              <ScrollArea className="flex-1 max-h-[calc(100vh-320px)]">
                <div className="p-2.5 flex flex-col gap-2.5">
                  {stageOpps.map((opp, oi) => (
                    <OpportunityCard key={opp.id} opp={opp} index={oi + si * 3} />
                  ))}
                  {stageOpps.length === 0 && (
                    <div className="py-10 text-center text-xs text-muted-foreground">
                      No opportunities
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Tab 2: Leads ---- */

function LeadsView() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');

  const sources = useMemo(() => Array.from(new Set(leads.map((l) => l.source))), []);

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      const q = search.toLowerCase();
      if (q && !`${l.firstName} ${l.lastName} ${l.email} ${l.companyName}`.toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (sourceFilter !== 'all' && l.source !== sourceFilter) return false;
      return true;
    });
  }, [search, statusFilter, sourceFilter]);

  return (
    <div className="space-y-4">
      <TabHeader title="Leads" description="Manage and track all your sales leads" />

      {/* filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {['new','contacted','qualified','proposal','negotiation','won','lost'].map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Source" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground ml-auto">Showing {filtered.length} leads</span>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Score</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((lead) => (
            <TableRow key={lead.id}>
              <TableCell className="font-medium">{lead.firstName} {lead.lastName}</TableCell>
              <TableCell className="text-muted-foreground">{lead.email}</TableCell>
              <TableCell>{lead.companyName}</TableCell>
              <TableCell>{lead.source}</TableCell>
              <TableCell>
                <Badge variant="outline" className={cn('capitalize border-0 text-xs', statusColors[lead.status])}>
                  {lead.status}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn('h-full rounded-full', scoreBarColor(lead.score))}
                      style={{ width: `${lead.score}%` }}
                    />
                  </div>
                  <span className={cn('text-xs font-semibold w-6 text-right', scoreColor(lead.score))}>{lead.score}</span>
                </div>
              </TableCell>
              <TableCell className="font-medium">{formatCurrency(lead.value)}</TableCell>
              <TableCell className="text-muted-foreground">{formatDate(lead.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ---- Tab 3: Contacts ---- */

function ContactsView() {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      `${c.firstName} ${c.lastName} ${c.email} ${c.company} ${c.jobTitle}`.toLowerCase().includes(q)
    );
  }, [search]);

  return (
    <div className="space-y-4">
      <TabHeader title="Contacts" description="Your network of professional contacts" />

      <div className="relative w-72">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-9"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((contact, ci) => (
          <motion.div
            key={contact.id}
            whileHover={{ y: -4, boxShadow: '0 12px 28px rgba(0,0,0,0.08)' }}
            className="bg-card border border-border rounded-xl p-5 transition-colors hover:border-teal-300/50 dark:hover:border-teal-600/40 cursor-pointer"
          >
            <div className="flex items-start gap-3.5">
              <div className="relative">
                <div className={cn(
                  'size-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
                  avatarColor(ci),
                )}>
                  {getInitials(`${contact.firstName} ${contact.lastName}`)}
                </div>
                <div className={cn(
                  'absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-card',
                  contact.isActive ? 'bg-emerald-500' : 'bg-gray-400',
                )} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">
                  {contact.firstName} {contact.lastName}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{contact.jobTitle}</p>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Building2 className="size-3" /> {contact.company}
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 truncate">
                <Mail className="size-3" /> {contact.email}
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Phone className="size-3" /> {contact.phone}
              </p>
            </div>

            <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between">
              <Badge variant="outline" className="text-[10px] border-teal-300/50 text-teal-700 dark:border-teal-700/50 dark:text-teal-400">
                {contact.source}
              </Badge>
              <span className={cn(
                'text-[10px] font-medium px-2 py-0.5 rounded-full',
                contact.isActive
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-400',
              )}>
                {contact.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ---- Tab 4: Companies ---- */

function CompaniesView() {
  return (
    <div className="space-y-4">
      <TabHeader title="Companies" description="Track organizations in your CRM" />

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Company</TableHead>
            <TableHead>Industry</TableHead>
            <TableHead>Website</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Employees</TableHead>
            <TableHead>Revenue</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {crmCompanies.map((co) => (
            <TableRow key={co.id}>
              <TableCell>
                <div className="flex items-center gap-2.5">
                  <div className="size-8 rounded-lg bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center text-xs font-bold text-teal-700 dark:text-teal-300">
                    {co.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="font-medium">{co.name}</span>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs capitalize">{co.industry}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{co.website}</TableCell>
              <TableCell className="text-muted-foreground">{co.city}, {co.country}</TableCell>
              <TableCell className="font-medium">{formatNumber(co.employeeCount)}</TableCell>
              <TableCell className="font-medium">{formatCurrency(co.annualRevenue)}</TableCell>
              <TableCell className="text-muted-foreground">{formatDate(co.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ---- Tab 5: Deals ---- */

function DealsView() {
  const totalPipeline = opportunities.reduce((a, o) => a + o.value, 0);
  const weightedValue = opportunities.reduce((a, o) => a + o.value * (o.probability / 100), 0);
  const avgDeal = totalPipeline / opportunities.length;

  return (
    <div className="space-y-4">
      <TabHeader title="Deals" description="All opportunities and deal pipeline" />

      {/* summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Pipeline Value', value: formatCurrency(totalPipeline), icon: DollarSign, accent: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-50 dark:bg-teal-950/40' },
          { label: 'Weighted Value', value: formatCurrency(weightedValue), icon: TrendingUp, accent: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-950/40' },
          { label: 'Average Deal Size', value: formatCurrency(avgDeal), icon: BarChart3, accent: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40' },
        ].map((card) => (
          <div key={card.label} className={cn('rounded-xl border border-border p-4', card.bg)}>
            <div className="flex items-center gap-2 mb-1">
              <card.icon className={cn('size-4', card.accent)} />
              <span className="text-xs text-muted-foreground font-medium">{card.label}</span>
            </div>
            <p className={cn('text-xl font-bold', card.accent)}>{card.value}</p>
          </div>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Deal</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Probability</TableHead>
            <TableHead>Close Date</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Owner</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {opportunities.map((opp) => {
            const stage = pipeline.stages.find((s) => s.id === opp.stageId);
            return (
              <TableRow key={opp.id}>
                <TableCell className="font-medium">{opp.name}</TableCell>
                <TableCell className="font-semibold">{formatCurrency(opp.value)}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className="border-0 text-xs"
                    style={{
                      backgroundColor: stage ? `${stage.color}18` : undefined,
                      color: stage?.color,
                    }}
                  >
                    {opp.stage}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 w-28">
                    <Progress value={opp.probability} className="h-1.5 flex-1" />
                    <span className="text-xs text-muted-foreground w-7 text-right">{opp.probability}%</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(opp.closeDate)}</TableCell>
                <TableCell>{opp.contactName}</TableCell>
                <TableCell>{opp.companyName}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <div className="size-5 rounded-full bg-teal-600 text-white flex items-center justify-center text-[9px] font-bold">
                      {getInitials(opp.ownerName)}
                    </div>
                    <span className="text-sm">{opp.ownerName}</span>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ---- Main CRM Module ---- */

export default function CrmModule() {
  return (
    <div className="space-y-1">
      {/* Module title */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Handshake className="size-6 text-teal-600" />
          CRM
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage leads, contacts, companies, and your sales pipeline in one place.
        </p>
      </div>

      <Tabs defaultValue="pipeline" className="w-full">
        <TabsList className="mb-5">
          <TabsTrigger value="pipeline" className="gap-1.5">
            <Target className="size-3.5" />
            Pipeline
          </TabsTrigger>
          <TabsTrigger value="leads" className="gap-1.5">
            <UserCircle className="size-3.5" />
            Leads
          </TabsTrigger>
          <TabsTrigger value="contacts" className="gap-1.5">
            <Users className="size-3.5" />
            Contacts
          </TabsTrigger>
          <TabsTrigger value="companies" className="gap-1.5">
            <Building2 className="size-3.5" />
            Companies
          </TabsTrigger>
          <TabsTrigger value="deals" className="gap-1.5">
            <DollarSign className="size-3.5" />
            Deals
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline">
          <PipelineView />
        </TabsContent>

        <TabsContent value="leads">
          <LeadsView />
        </TabsContent>

        <TabsContent value="contacts">
          <ContactsView />
        </TabsContent>

        <TabsContent value="companies">
          <CompaniesView />
        </TabsContent>

        <TabsContent value="deals">
          <DealsView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
