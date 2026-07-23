'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowRight,
  Sparkles,
  Users,
  FolderKanban,
  UserCog,
  DollarSign,
  Package,
  Calendar,
  MessageSquare,
  Shield,
  Zap,
} from 'lucide-react';

export default function LandingPage() {
  // No client-side auth gate here: middleware redirects signed-in visitors to
  // /dashboard before this renders. Unauthenticated visitors get the landing
  // page immediately, with no loading spinner in front of it.
  return (
    <div className="relative overflow-hidden">
      {/* Background Gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[600px] bg-gradient-to-b from-emerald-500/10 via-transparent to-transparent blur-3xl pointer-events-none -z-10" />

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16 text-center lg:pt-32">
        <Badge variant="outline" className="mb-6 px-3 py-1 bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 gap-1.5 animate-pulse">
          <Sparkles className="size-3.5 fill-emerald-500/20" />
          Introducing NexusCorp Business OS v2.0
        </Badge>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-gray-900 dark:text-white max-w-4xl mx-auto leading-tight">
          The all-in-one operating system for{' '}
          <span className="bg-gradient-to-r from-emerald-500 to-teal-600 bg-clip-text text-transparent">
            modern business
          </span>
        </h1>
        <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
          Unify your CRM, projects, HR, finance, inventory, and team communication in a single, lightning-fast platform. Stop switching tabs and start growing.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link href="/signup">
            <Button size="lg" className="h-12 px-8 bg-emerald-500 hover:bg-emerald-600 text-white gap-2 font-medium shadow-lg shadow-emerald-500/20">
              Start Free Trial
              <ArrowRight className="size-4" />
            </Button>
          </Link>
          <Link href="/pricing">
            <Button size="lg" variant="outline" className="h-12 px-8 border-gray-200 dark:border-gray-800">
              View Pricing
            </Button>
          </Link>
        </div>

        {/* Dashboard Mockup */}
        <div className="mt-16 sm:mt-20 border border-gray-200/80 dark:border-gray-800/80 rounded-2xl p-2 bg-gray-50/50 dark:bg-gray-900/50 backdrop-blur-sm max-w-5xl mx-auto shadow-2xl relative">
          <div className="absolute inset-0 bg-gradient-to-t from-white dark:from-gray-950 via-transparent to-transparent z-10 h-32 bottom-0 top-auto rounded-b-2xl" />
          <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden bg-white dark:bg-gray-950 aspect-[16/10] flex flex-col">
            {/* Header Mock */}
            <div className="h-10 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 flex items-center px-4 justify-between">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-red-450" style={{backgroundColor: '#ff5f56'}} />
                <span className="size-2.5 rounded-full bg-yellow-450" style={{backgroundColor: '#ffbd2e'}} />
                <span className="size-2.5 rounded-full bg-green-450" style={{backgroundColor: '#27c93f'}} />
              </div>
              <div className="w-1/3 h-5 bg-gray-200 dark:bg-gray-800 rounded-md" />
              <div className="size-5 rounded-full bg-gray-200 dark:bg-gray-800" />
            </div>
            {/* Dashboard Content Mock */}
            <div className="flex-1 flex bg-gray-50/50 dark:bg-gray-950">
              {/* Sidebar Mock */}
              <div className="w-44 border-r border-gray-100 dark:border-gray-800 p-3 space-y-2 bg-white dark:bg-gray-900/30 text-left">
                <div className="h-6 bg-emerald-500/10 rounded w-2/3" />
                <div className="space-y-1.5 pt-4">
                  <div className="h-5 bg-gray-100 dark:bg-gray-800 rounded" />
                  <div className="h-5 bg-gray-100 dark:bg-gray-800 rounded" />
                  <div className="h-5 bg-emerald-500/10 rounded" />
                  <div className="h-5 bg-gray-100 dark:bg-gray-800 rounded" />
                </div>
              </div>
              {/* Main Content Mock */}
              <div className="flex-1 p-6 space-y-6 text-left">
                <div className="flex justify-between items-center">
                  <div className="space-y-1">
                    <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded w-32" />
                    <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-48" />
                  </div>
                  <div className="h-8 bg-emerald-500 rounded w-24" />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="border border-gray-100 dark:border-gray-800 rounded-lg p-4 bg-white dark:bg-gray-900/50 space-y-2">
                    <div className="h-3 bg-gray-150 dark:bg-gray-800 rounded w-2/3" />
                    <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                  </div>
                  <div className="border border-gray-100 dark:border-gray-800 rounded-lg p-4 bg-white dark:bg-gray-900/50 space-y-2">
                    <div className="h-3 bg-gray-155 dark:bg-gray-800 rounded w-2/3" />
                    <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                  </div>
                  <div className="border border-gray-100 dark:border-gray-800 rounded-lg p-4 bg-white dark:bg-gray-900/50 space-y-2">
                    <div className="h-3 bg-gray-155 dark:bg-gray-800 rounded w-2/3" />
                    <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                  </div>
                </div>
                <div className="border border-gray-100 dark:border-gray-800 rounded-lg p-4 bg-white dark:bg-gray-900/50 h-36 flex items-center justify-center">
                  <div className="w-full space-y-3">
                    <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-3/4" />
                    <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-1/2" />
                    <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-5/6" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Section */}
      <section className="py-20 bg-gray-50 dark:bg-gray-900/40 border-t border-b border-gray-150 dark:border-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-bold tracking-tight">Fully integrated modules</h2>
            <p className="mt-4 text-muted-foreground">Every department in your company connected out-of-the-box. Fully responsive and customizable.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { title: 'CRM & Sales', icon: Users, desc: 'Manage leads, pipeline, and customer relationships.' },
              { title: 'Projects', icon: FolderKanban, desc: 'Kanban, tasks, resource scheduling, and time logging.' },
              { title: 'Human Resources', icon: UserCog, desc: 'Employee directory, leave requests, and performance.' },
              { title: 'Finance', icon: DollarSign, desc: 'Invoices, expenses, and automated financial tracking.' },
              { title: 'Inventory', icon: Package, desc: 'Real-time stock tracking and warehouse management.' },
              { title: 'Communication', icon: MessageSquare, desc: 'Slack-style chat channels and direct messages.' },
              { title: 'Support', icon: Shield, desc: 'Ticket management, help center, and client portals.' },
              { title: 'Calendar', icon: Calendar, desc: 'Team schedules, meeting rooms, and task sync.' },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="bg-white dark:bg-gray-950 p-6 rounded-xl border border-gray-200 dark:border-gray-800/80 hover:border-emerald-500/50 transition-all hover:shadow-md hover:shadow-emerald-500/[0.02] group text-left">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-4 group-hover:bg-emerald-500/20 transition-colors">
                    <Icon className="size-5 text-emerald-500" />
                  </div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Metrics Section */}
      <section className="py-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <div className="text-4xl font-bold text-gray-900 dark:text-white">10,000+</div>
            <div className="text-sm text-muted-foreground mt-1">Active Teams</div>
          </div>
          <div>
            <div className="text-4xl font-bold text-gray-900 dark:text-white">99.99%</div>
            <div className="text-sm text-muted-foreground mt-1">Uptime SLA</div>
          </div>
          <div>
            <div className="text-4xl font-bold text-gray-900 dark:text-white">$1.2B+</div>
            <div className="text-sm text-muted-foreground mt-1">Processed</div>
          </div>
          <div>
            <div className="text-4xl font-bold text-emerald-500">SOC-2</div>
            <div className="text-sm text-muted-foreground mt-1">Certified Security</div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="relative rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-10 sm:p-16 text-center text-white overflow-hidden shadow-xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.15),transparent)]" />
          <h2 className="text-3xl font-bold tracking-tight mb-4 relative z-10">Run your business like a machine</h2>
          <p className="text-emerald-100 max-w-lg mx-auto mb-8 relative z-10">Start your 14-day free trial. No credit card required. Up and running in minutes.</p>
          <Link href="/signup" className="relative z-10">
            <Button size="lg" className="h-12 px-8 bg-white hover:bg-emerald-50 text-emerald-600 font-semibold shadow-md">
              Get Started Now
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
