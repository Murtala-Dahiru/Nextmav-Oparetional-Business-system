'use client';

import { useState } from 'react';
import {
  Search,
  Rocket,
  UserCircle,
  Users,
  FolderKanban,
  CreditCard,
  Puzzle,
  ShieldCheck,
  Code2,
  BookOpen,
  ArrowRight,
  MessageCircle,
  Mail,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const categories = [
  {
    icon: Rocket,
    title: 'Getting Started',
    description: 'Learn the basics and set up your workspace in minutes.',
    articleCount: 12,
    color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  {
    icon: UserCircle,
    title: 'Account',
    description: 'Manage your profile, preferences, and account settings.',
    articleCount: 8,
    color: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
  {
    icon: Users,
    title: 'CRM',
    description: 'Contacts, leads, deals, and pipeline management.',
    articleCount: 24,
    color: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
  {
    icon: FolderKanban,
    title: 'Projects',
    description: 'Task boards, time tracking, and project planning.',
    articleCount: 18,
    color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  {
    icon: CreditCard,
    title: 'Billing',
    description: 'Invoices, subscriptions, payment methods, and receipts.',
    articleCount: 10,
    color: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  },
  {
    icon: Puzzle,
    title: 'Integrations',
    description: 'Connect with third-party tools and customize workflows.',
    articleCount: 15,
    color: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  },
  {
    icon: ShieldCheck,
    title: 'Security',
    description: 'SSO, 2FA, audit logs, and data protection policies.',
    articleCount: 9,
    color: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  },
  {
    icon: Code2,
    title: 'API',
    description: 'REST API reference, webhooks, and developer guides.',
    articleCount: 22,
    color: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400',
  },
];

const popularArticles = [
  {
    title: 'How to set up your first project',
    category: 'Getting Started',
    views: '12.4k',
  },
  {
    title: 'Creating and managing deal pipelines',
    category: 'CRM',
    views: '9.8k',
  },
  {
    title: 'Configuring SSO with SAML 2.0',
    category: 'Security',
    views: '7.2k',
  },
  {
    title: 'Using the REST API for custom integrations',
    category: 'API',
    views: '6.5k',
  },
  {
    title: 'Understanding billing and invoicing',
    category: 'Billing',
    views: '5.9k',
  },
  {
    title: 'Managing team roles and permissions',
    category: 'Account',
    views: '5.1k',
  },
];

export default function HelpCenterPage() {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCategories = searchQuery
    ? categories.filter(
        (c) =>
          c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : categories;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
      {/* Hero */}
      <section className="text-center max-w-2xl mx-auto mb-16">
        <Badge variant="secondary" className="mb-4">
          <BookOpen className="size-3 mr-1" />
          Help Center
        </Badge>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
          How can we{' '}
          <span className="text-emerald-500">help you</span>?
        </h1>
        <p className="text-lg text-muted-foreground mb-8">
          Search our knowledge base or browse by category to find the answers you need.
        </p>
        <div className="relative max-w-lg mx-auto">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search for articles, guides, and tutorials..."
            className="pl-10 h-12 text-base rounded-xl border-gray-200 dark:border-gray-800 focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search help articles"
          />
        </div>
      </section>

      {/* Categories Grid */}
      <section aria-labelledby="categories-heading" className="mb-20">
        <h2 id="categories-heading" className="sr-only">Help Categories</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {filteredCategories.map((category) => {
            const Icon = category.icon;
            return (
              <Card
                key={category.title}
                className="group cursor-pointer hover:border-emerald-500/50 hover:shadow-md hover:shadow-emerald-500/5 transition-all py-0 gap-0"
              >
                <CardHeader className="pb-0">
                  <div className={`rounded-lg w-10 h-10 flex items-center justify-center mb-3 ${category.color} group-hover:scale-110 transition-transform`}>
                    <Icon className="size-5" />
                  </div>
                  <CardTitle className="text-base group-hover:text-emerald-500 transition-colors flex items-center justify-between">
                    {category.title}
                    <ChevronRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <CardDescription className="leading-relaxed mb-3">
                    {category.description}
                  </CardDescription>
                  <Badge variant="secondary" className="text-xs">
                    {category.articleCount} articles
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {filteredCategories.length === 0 && (
          <div className="text-center py-16">
            <Search className="size-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              No categories match &ldquo;{searchQuery}&rdquo;
            </p>
          </div>
        )}
      </section>

      {/* Popular Articles */}
      <section aria-labelledby="popular-heading" className="mb-20">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 id="popular-heading" className="text-2xl font-bold tracking-tight">
              Popular Articles
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Most viewed articles by our community
            </p>
          </div>
          <Badge variant="outline" className="hidden sm:flex items-center gap-1.5">
            <BookOpen className="size-3" />
            118 total articles
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {popularArticles.map((article) => (
            <a
              key={article.title}
              href="#"
              className="group flex items-start gap-4 rounded-xl border border-gray-200 dark:border-gray-800 p-4 hover:border-emerald-500/50 hover:shadow-sm hover:shadow-emerald-500/5 transition-all"
            >
              <div className="rounded-lg bg-emerald-500/10 w-9 h-9 flex items-center justify-center shrink-0 mt-0.5">
                <BookOpen className="size-4 text-emerald-500" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium group-hover:text-emerald-500 transition-colors line-clamp-1">
                  {article.title}
                </h3>
                <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-[11px] px-1.5 py-0">
                    {article.category}
                  </Badge>
                  <span>{article.views} views</span>
                </div>
              </div>
              <ArrowRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1 shrink-0" />
            </a>
          ))}
        </div>
      </section>

      {/* Contact Support CTA */}
      <section aria-labelledby="support-heading">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-8 sm:p-12 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <MessageCircle className="size-6 text-white" />
            <h2 id="support-heading" className="text-2xl sm:text-3xl font-bold text-white">
              Still need help?
            </h2>
          </div>
          <p className="text-emerald-100 mb-8 max-w-lg mx-auto">
            Our support team is available 24/7 to assist you. Get in touch and we&apos;ll resolve your issue as quickly as possible.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              size="lg"
              className="bg-white text-emerald-600 hover:bg-emerald-50 h-11 px-6"
            >
              <MessageCircle className="size-4 mr-2" />
              Live Chat
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white/30 text-white hover:bg-white/10 h-11 px-6 bg-transparent"
            >
              <Mail className="size-4 mr-2" />
              Email Support
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
