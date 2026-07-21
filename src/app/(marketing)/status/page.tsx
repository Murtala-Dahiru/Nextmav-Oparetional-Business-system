'use client';

import {
  Activity,
  Server,
  LayoutDashboard,
  Database,
  Mail,
  HardDrive,
  Globe,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowUpRight,
} from 'lucide-react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type ServiceStatus = 'operational' | 'degraded' | 'outage' | 'maintenance';

interface Service {
  name: string;
  status: ServiceStatus;
  uptime: { '30d': number; '60d': number; '90d': number };
  icon: typeof Server;
}

interface Incident {
  id: string;
  title: string;
  status: 'resolved' | 'monitoring' | 'investigating' | 'identified';
  severity: 'minor' | 'major' | 'critical';
  date: string;
  duration: string;
  updates: { time: string; message: string }[];
}

const services: Service[] = [
  {
    name: 'API',
    status: 'operational',
    uptime: { '30d': 99.99, '60d': 99.98, '90d': 99.97 },
    icon: Server,
  },
  {
    name: 'Dashboard',
    status: 'operational',
    uptime: { '30d': 100, '60d': 99.99, '90d': 99.98 },
    icon: LayoutDashboard,
  },
  {
    name: 'Database',
    status: 'operational',
    uptime: { '30d': 99.99, '60d': 99.99, '90d': 99.98 },
    icon: Database,
  },
  {
    name: 'Email Service',
    status: 'degraded',
    uptime: { '30d': 99.85, '60d': 99.92, '90d': 99.95 },
    icon: Mail,
  },
  {
    name: 'Storage',
    status: 'operational',
    uptime: { '30d': 100, '60d': 100, '90d': 99.99 },
    icon: HardDrive,
  },
  {
    name: 'CDN',
    status: 'operational',
    uptime: { '30d': 99.98, '60d': 99.97, '90d': 99.96 },
    icon: Globe,
  },
];

const incidents: Incident[] = [
  {
    id: 'INC-2847',
    title: 'Email delivery delays for some recipients',
    status: 'monitoring',
    severity: 'minor',
    date: 'Jan 15, 2024',
    duration: '2h 15m',
    updates: [
      { time: '15:30 UTC', message: 'We are investigating reports of email delivery delays affecting approximately 5% of outbound emails.' },
      { time: '16:00 UTC', message: 'Identified the issue as a queuing bottleneck in our email relay provider. Working on a fix.' },
      { time: '17:00 UTC', message: 'Applied a fix and email delivery is recovering. Monitoring the situation.' },
      { time: '17:45 UTC', message: 'Delivery rates have returned to normal. Continuing to monitor for any recurrence.' },
    ],
  },
  {
    id: 'INC-2841',
    title: 'Intermittent API timeouts',
    status: 'resolved',
    severity: 'major',
    date: 'Jan 12, 2024',
    duration: '45m',
    updates: [
      { time: '09:15 UTC', message: 'Users are reporting intermittent 504 timeout errors on API requests.' },
      { time: '09:25 UTC', message: 'Identified a database connection pool exhaustion issue. Scaling up connections.' },
      { time: '09:40 UTC', message: 'Connection pool has been increased and error rates are dropping.' },
      { time: '10:00 UTC', message: 'All API endpoints are responding normally. Incident resolved.' },
    ],
  },
  {
    id: 'INC-2835',
    title: 'Scheduled maintenance - Database upgrade',
    status: 'resolved',
    severity: 'minor',
    date: 'Jan 8, 2024',
    duration: '30m',
    updates: [
      { time: '02:00 UTC', message: 'Starting planned database maintenance window. Expected downtime: 30 minutes.' },
      { time: '02:15 UTC', message: 'Database upgrade in progress. All services temporarily unavailable.' },
      { time: '02:25 UTC', message: 'Upgrade complete. Running verification checks.' },
      { time: '02:30 UTC', message: 'All services restored and operational. Maintenance completed successfully.' },
    ],
  },
  {
    id: 'INC-2829',
    title: 'CDN cache purge causing stale content',
    status: 'resolved',
    severity: 'minor',
    date: 'Jan 5, 2024',
    duration: '1h 10m',
    updates: [
      { time: '14:00 UTC', message: 'Reports of stale content being served from CDN edge nodes.' },
      { time: '14:20 UTC', message: 'Issued a full cache purge across all CDN edge locations.' },
      { time: '15:10 UTC', message: 'Verified that all edge nodes are serving fresh content. Resolved.' },
    ],
  },
];

const statusConfig: Record<ServiceStatus, { label: string; color: string; bgColor: string; dotColor: string }> = {
  operational: {
    label: 'Operational',
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    dotColor: 'bg-emerald-500',
  },
  degraded: {
    label: 'Degraded Performance',
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-500/10',
    dotColor: 'bg-amber-500',
  },
  outage: {
    label: 'Major Outage',
    color: 'text-rose-600 dark:text-rose-400',
    bgColor: 'bg-rose-500/10',
    dotColor: 'bg-rose-500',
  },
  maintenance: {
    label: 'Under Maintenance',
    color: 'text-sky-600 dark:text-sky-400',
    bgColor: 'bg-sky-500/10',
    dotColor: 'bg-sky-500',
  },
};

const incidentStatusConfig: Record<string, { label: string; color: string }> = {
  resolved: { label: 'Resolved', color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  monitoring: { label: 'Monitoring', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  investigating: { label: 'Investigating', color: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
  identified: { label: 'Identified', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
};

function UptimeBar({ percentage }: { percentage: number }) {
  const getColor = (pct: number) => {
    if (pct >= 99.95) return 'bg-emerald-500';
    if (pct >= 99.5) return 'bg-emerald-400';
    if (pct >= 99) return 'bg-amber-400';
    return 'bg-rose-400';
  };

  return (
    <div className="flex items-center gap-2.5">
      <div className="flex-1 h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${getColor(percentage)}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs font-medium text-muted-foreground w-14 text-right tabular-nums">
        {percentage.toFixed(2)}%
      </span>
    </div>
  );
}

export default function StatusPage() {
  const allOperational = services.every((s) => s.status === 'operational');

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
      {/* Breadcrumbs */}
      <Breadcrumb className="mb-8">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Status</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="text-center mb-12">
        <div className="flex items-center justify-center gap-2 mb-4">
          <Activity className="size-6 text-emerald-500" />
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">System Status</h1>
        </div>
        <p className="text-muted-foreground">
          Real-time status of all NexusCorp services
        </p>
      </div>

      {/* Overall Status Banner */}
      <div
        className={`rounded-xl border-2 p-6 mb-10 ${
          allOperational
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : 'border-amber-500/30 bg-amber-500/5'
        }`}
      >
        <div className="flex items-center gap-3">
          {allOperational ? (
            <CheckCircle2 className="size-8 text-emerald-500 shrink-0" />
          ) : (
            <AlertTriangle className="size-8 text-amber-500 shrink-0" />
          )}
          <div>
            <h2 className="text-xl font-bold">
              {allOperational ? 'All Systems Operational' : 'Partial Service Degradation'}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {allOperational
                ? 'All services are running normally. Last checked just now.'
                : 'Some services are experiencing issues. See details below.'}
            </p>
          </div>
        </div>
      </div>

      {/* Service Status */}
      <section aria-labelledby="services-heading" className="mb-16">
        <h2 id="services-heading" className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Server className="size-4 text-muted-foreground" />
          Service Status
        </h2>
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {services.map((service) => {
            const Icon = service.icon;
            const config = statusConfig[service.status];
            return (
              <div key={service.name} className="p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <Icon className="size-4 text-muted-foreground shrink-0" />
                    <span className="font-medium text-sm">{service.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full shrink-0 ${config.dotColor} animate-pulse`} />
                    <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {Object.entries(service.uptime).map(([period, pct]) => (
                    <div key={period}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-muted-foreground">{period}</span>
                      </div>
                      <UptimeBar percentage={pct} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Incident History */}
      <section aria-labelledby="incidents-heading">
        <h2 id="incidents-heading" className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" />
          Incident History
        </h2>
        <div className="space-y-4">
          {incidents.map((incident) => {
            const statusConf = incidentStatusConfig[incident.status];
            return (
              <Card key={incident.id} className="py-0 gap-0">
                <CardHeader className="pb-0">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
                    <CardTitle className="text-base">{incident.title}</CardTitle>
                    <Badge variant="secondary" className={`w-fit text-xs ${statusConf.color}`}>
                      {statusConf.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{incident.id}</span>
                    <span>&middot;</span>
                    <span>{incident.date}</span>
                    <span>&middot;</span>
                    <span>{incident.duration}</span>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="mt-3 border-l-2 border-gray-200 dark:border-gray-800 ml-1 pl-4 space-y-3">
                    {incident.updates.map((update, i) => (
                      <div key={i} className="relative">
                        <div className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-white dark:border-gray-950 bg-gray-300 dark:bg-gray-600" />
                        <p className="text-xs font-medium text-muted-foreground mb-0.5">{update.time}</p>
                        <p className="text-sm text-foreground/90 leading-relaxed">{update.message}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Subscribe */}
      <div className="mt-12 text-center">
        <p className="text-sm text-muted-foreground">
          Want to be notified about incidents?{' '}
          <a href="#" className="text-emerald-500 hover:text-emerald-600 font-medium inline-flex items-center gap-1">
            Subscribe to updates <ArrowUpRight className="size-3" />
          </a>
        </p>
      </div>
    </div>
  );
}
