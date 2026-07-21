'use client';

import Link from 'next/link';
import {
  Users,
  FolderKanban,
  UserCog,
  DollarSign,
  Headphones,
  BarChart3,
  Shield,
  Workflow,
  Globe,
  Zap,
  Mail,
  CalendarDays,
  Warehouse,
  MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const sections = [
  {
    title: 'CRM & Sales',
    description: 'Manage leads, contacts, and deals from first touch to close.',
    features: [
      {
        name: 'Contact Management',
        description: 'Centralized database for all your contacts and companies with custom fields and tags.',
        icon: Users,
      },
      {
        name: 'Deal Pipeline',
        description: 'Visual pipeline with drag-and-drop stages, automated workflows, and forecasting.',
        icon: Workflow,
      },
      {
        name: 'Email Campaigns',
        description: 'Create, send, and track email campaigns with built-in templates and analytics.',
        icon: Mail,
      },
    ],
  },
  {
    title: 'Project Management',
    description: 'Plan, track, and deliver projects on time with powerful tools.',
    features: [
      {
        name: 'Task Boards',
        description: 'Kanban boards, list views, and Gantt charts to manage work your way.',
        icon: FolderKanban,
      },
      {
        name: 'Time Tracking',
        description: 'Built-in time tracking for tasks and projects with detailed reporting.',
        icon: CalendarDays,
      },
      {
        name: 'Resource Planning',
        description: 'Allocate team members, manage workloads, and prevent burnout.',
        icon: Zap,
      },
    ],
  },
  {
    title: 'Human Resources',
    description: 'Streamline HR processes from hiring to employee engagement.',
    features: [
      {
        name: 'Employee Directory',
        description: 'Complete employee profiles with org charts, departments, and reporting lines.',
        icon: UserCog,
      },
      {
        name: 'Leave Management',
        description: 'Self-service leave requests, approval workflows, and balance tracking.',
        icon: CalendarDays,
      },
      {
        name: 'Onboarding',
        description: 'Structured onboarding checklists and automated welcome workflows.',
        icon: Users,
      },
    ],
  },
  {
    title: 'Finance',
    description: 'Take control of your finances with invoicing, expenses, and reporting.',
    features: [
      {
        name: 'Invoicing',
        description: 'Create professional invoices, track payments, and send automated reminders.',
        icon: DollarSign,
      },
      {
        name: 'Expense Tracking',
        description: 'Capture receipts, categorize expenses, and manage approvals.',
        icon: BarChart3,
      },
      {
        name: 'Financial Reports',
        description: 'P&L statements, cash flow analysis, and customizable financial dashboards.',
        icon: BarChart3,
      },
    ],
  },
  {
    title: 'Operations',
    description: 'Inventory, support, and communication tools in one platform.',
    features: [
      {
        name: 'Inventory Management',
        description: 'Track stock levels, manage warehouses, and get low-stock alerts.',
        icon: Warehouse,
      },
      {
        name: 'Support Tickets',
        description: 'Customer support with ticket routing, SLAs, and satisfaction surveys.',
        icon: Headphones,
      },
      {
        name: 'Team Communication',
        description: 'Channels, direct messages, and file sharing built right into the platform.',
        icon: MessageSquare,
      },
    ],
  },
  {
    title: 'Platform',
    description: 'Enterprise-grade security, integrations, and global availability.',
    features: [
      {
        name: 'Security & Compliance',
        description: 'SOC 2 compliant, SSO/SAML, role-based access, and audit logging.',
        icon: Shield,
      },
      {
        name: 'API & Integrations',
        description: 'RESTful API, webhooks, and 50+ pre-built integrations.',
        icon: Globe,
      },
      {
        name: 'Analytics & Reporting',
        description: 'Cross-module dashboards, custom reports, and data export.',
        icon: BarChart3,
      },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        {/* Hero */}
        <div className="text-center max-w-3xl mx-auto mb-20">
          <Badge variant="secondary" className="mb-4">
            Everything you need
          </Badge>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
            One platform to run your{' '}
            <span className="text-emerald-500">entire business</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            NexusCorp combines CRM, project management, HR, finance, and operations into a single
            unified platform. No more switching between tools.
          </p>
        </div>

        {/* Feature Sections */}
        <div className="space-y-24">
          {sections.map((section) => (
            <section key={section.title} aria-labelledby={`section-${section.title.toLowerCase().replace(/\s+/g, '-')}`}>
              <div className="text-center mb-10">
                <h2
                  id={`section-${section.title.toLowerCase().replace(/\s+/g, '-')}`}
                  className="text-2xl sm:text-3xl font-bold tracking-tight mb-3"
                >
                  {section.title}
                </h2>
                <p className="text-muted-foreground max-w-xl mx-auto">{section.description}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {section.features.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <article
                      key={feature.name}
                      className="group rounded-xl border border-gray-200 dark:border-gray-800 p-6 hover:border-emerald-500/50 hover:shadow-md hover:shadow-emerald-500/5 transition-all"
                    >
                      <div className="rounded-lg bg-emerald-500/10 w-10 h-10 flex items-center justify-center mb-4 group-hover:bg-emerald-500/20 transition-colors">
                        <Icon className="size-5 text-emerald-500" />
                      </div>
                      <h3 className="font-semibold mb-2">{feature.name}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {feature.description}
                      </p>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-24 text-center">
          <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-10 sm:p-16">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Ready to get started?
            </h2>
            <p className="text-emerald-100 mb-8 max-w-lg mx-auto">
              Start your 14-day free trial. No credit card required. Full access to all features.
            </p>
            <Link href="/signup">
              <Button size="lg" className="bg-white text-emerald-600 hover:bg-emerald-50 h-12 px-8">
                Start free trial
              </Button>
            </Link>
          </div>
        </div>
    </div>
  );
}