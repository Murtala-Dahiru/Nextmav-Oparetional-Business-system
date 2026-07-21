'use client';

import Link from 'next/link';
import {
  Target,
  Heart,
  Lightbulb,
  Shield,
  ArrowUpRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

const team = [
  {
    name: 'Sarah Chen',
    role: 'Co-Founder & CEO',
    bio: 'Former VP of Product at Salesforce. 15+ years in enterprise SaaS.',
    initials: 'SC',
  },
  {
    name: 'Marcus Williams',
    role: 'Co-Founder & CTO',
    bio: 'Ex-Principal Engineer at AWS. Expert in distributed systems and security.',
    initials: 'MW',
  },
  {
    name: 'Elena Rodriguez',
    role: 'VP of Design',
    bio: 'Previously led design at Figma. Passionate about intuitive enterprise UX.',
    initials: 'ER',
  },
  {
    name: 'James Park',
    role: 'VP of Engineering',
    bio: 'Former Engineering Director at Stripe. Building high-performance teams.',
    initials: 'JP',
  },
  {
    name: 'Aisha Patel',
    role: 'Head of Customer Success',
    bio: '10+ years helping enterprise customers achieve their goals.',
    initials: 'AP',
  },
  {
    name: 'David Kim',
    role: 'Head of Sales',
    bio: 'Scaled revenue from $0 to $50M at previous SaaS startups.',
    initials: 'DK',
  },
];

const values = [
  {
    icon: Target,
    title: 'Customer Obsession',
    description:
      'Every decision starts with the customer. We build what businesses actually need, not what looks good in a demo.',
  },
  {
    icon: Lightbulb,
    title: 'Relentless Innovation',
    description:
      'We push boundaries daily. Our team ships new features every week while maintaining rock-solid reliability.',
  },
  {
    icon: Shield,
    title: 'Trust & Transparency',
    description:
      'Honest pricing, clear communication, and a commitment to data privacy. We earn trust through actions.',
  },
  {
    icon: Heart,
    title: 'People First',
    description:
      'We believe great software is built by empowered, diverse teams who love what they do.',
  },
];

const stats = [
  { value: '10,000+', label: 'Teams worldwide' },
  { value: '99.99%', label: 'Uptime SLA' },
  { value: '50M+', label: 'Tasks completed' },
  { value: '4.9/5', label: 'Customer rating' },
];

export default function AboutPage() {
  return (
    <div>
      {/* Hero */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <div className="text-center max-w-3xl mx-auto">
            <Badge variant="secondary" className="mb-4">
              Our Story
            </Badge>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-6">
              Building the operating system for{' '}
              <span className="text-emerald-500">modern businesses</span>
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              NexusCorp was founded in 2021 with a simple belief: businesses deserve better tools.
              After years of watching companies struggle with fragmented software stacks — CRM here,
              project management there, finance apps everywhere — we set out to build something
              different.
            </p>
          </div>

          <div className="mt-12 text-center max-w-3xl mx-auto">
            <p className="text-lg text-muted-foreground leading-relaxed">
              Our co-founders, Sarah Chen and Marcus Williams, experienced firsthand how tool
              fragmentation slows teams down. They envisioned a single, unified platform where every
              department — sales, marketing, HR, finance, and operations — could work seamlessly
              together. Today, NexusCorp serves over 10,000 teams worldwide, helping them move
              faster, communicate better, and make smarter decisions.
            </p>
          </div>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center p-6 rounded-xl bg-gray-50 dark:bg-gray-900">
                <div className="text-3xl sm:text-4xl font-bold text-emerald-500 mb-1">
                  {stat.value}
                </div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Mission & Values */}
        <section className="bg-gray-50 dark:bg-gray-900 py-16 sm:py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
                Our Mission & Values
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                We&apos;re on a mission to eliminate tool fragmentation and help businesses
                operate as one unified team.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {values.map((value) => {
                const Icon = value.icon;
                return (
                  <Card key={value.title} className="border-gray-200 dark:border-gray-800">
                    <CardContent className="p-6">
                      <div className="rounded-lg bg-emerald-500/10 w-10 h-10 flex items-center justify-center mb-4">
                        <Icon className="size-5 text-emerald-500" />
                      </div>
                      <h3 className="font-semibold mb-2">{value.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {value.description}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* Team */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
              Meet our leadership
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              A team of seasoned builders passionate about making work better for everyone.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {team.map((member) => (
              <Card
                key={member.name}
                className="border-gray-200 dark:border-gray-800 group hover:shadow-md transition-shadow"
              >
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="size-14 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-semibold text-emerald-500">
                        {member.initials}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold group-hover:text-emerald-500 transition-colors">
                        {member.name}
                      </h3>
                      <p className="text-sm text-emerald-500 mb-2">{member.role}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{member.bio}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="bg-gray-50 dark:bg-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">
              Join the thousands of teams using NexusCorp
            </h2>
            <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
              Start your 14-day free trial and see why businesses are switching to a unified
              platform.
            </p>
            <Link href="/signup">
              <Button size="lg" className="bg-emerald-500 hover:bg-emerald-600 text-white h-12 px-8">
                Get started free
                <ArrowUpRight className="size-4" />
              </Button>
            </Link>
          </div>
        </section>
    </div>
  );
}