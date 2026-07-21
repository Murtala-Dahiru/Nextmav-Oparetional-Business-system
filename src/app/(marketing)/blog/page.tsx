'use client';

import { useState } from 'react';
import {
  Calendar,
  Clock,
  ArrowRight,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

const categories = ['All', 'Product', 'Engineering', 'Company', 'Guides', 'News'];

const blogPosts = [
  {
    title: 'Introducing NexusCorp 2.0: A Complete Redesign',
    excerpt: 'We completely rebuilt the interface from the ground up with a focus on speed, clarity, and a modern design language that scales across all modules.',
    category: 'Product',
    date: 'Jan 12, 2024',
    readTime: '8 min read',
    color: 'bg-gradient-to-br from-emerald-400 to-emerald-600',
    featured: true,
  },
  {
    title: 'How We Migrated Our Infrastructure to Edge Computing',
    excerpt: 'A deep dive into our journey moving from traditional cloud servers to a global edge network, achieving sub-100ms response times worldwide.',
    category: 'Engineering',
    date: 'Jan 8, 2024',
    readTime: '12 min read',
    color: 'bg-gradient-to-br from-sky-400 to-sky-600',
    featured: false,
  },
  {
    title: 'The Ultimate Guide to CRM Pipeline Management',
    excerpt: 'Learn best practices for setting up and optimizing your sales pipeline to close more deals and forecast revenue accurately.',
    category: 'Guides',
    date: 'Jan 5, 2024',
    readTime: '6 min read',
    color: 'bg-gradient-to-br from-violet-400 to-violet-600',
    featured: false,
  },
  {
    title: 'NexusCorp Raises $50M Series C to Accelerate Growth',
    excerpt: 'We are thrilled to announce our Series C funding round, which will help us expand our platform capabilities and grow the team globally.',
    category: 'News',
    date: 'Dec 28, 2023',
    readTime: '4 min read',
    color: 'bg-gradient-to-br from-amber-400 to-amber-600',
    featured: false,
  },
  {
    title: 'Building Real-Time Collaborative Features with WebSockets',
    excerpt: 'An engineering deep-dive into how we implemented real-time collaboration, live cursors, and instant syncing across all modules.',
    category: 'Engineering',
    date: 'Dec 20, 2023',
    readTime: '10 min read',
    color: 'bg-gradient-to-br from-rose-400 to-rose-600',
    featured: false,
  },
  {
    title: '10 Project Management Tips from High-Growth Teams',
    excerpt: 'We surveyed 500+ teams using NexusCorp Projects and compiled their top strategies for delivering projects on time and under budget.',
    category: 'Guides',
    date: 'Dec 15, 2023',
    readTime: '7 min read',
    color: 'bg-gradient-to-br from-teal-400 to-teal-600',
    featured: false,
  },
  {
    title: 'Meet Our New Chief Technology Officer',
    excerpt: 'Sarah Chen joins NexusCorp as CTO, bringing 15 years of enterprise SaaS experience and a vision for our technical roadmap.',
    category: 'Company',
    date: 'Dec 10, 2023',
    readTime: '3 min read',
    color: 'bg-gradient-to-br from-orange-400 to-orange-600',
    featured: false,
  },
  {
    title: 'What Is New in the December Release',
    excerpt: 'This month we shipped custom dashboards, advanced filters for CRM, time tracking improvements, and 20+ other enhancements.',
    category: 'Product',
    date: 'Dec 1, 2023',
    readTime: '5 min read',
    color: 'bg-gradient-to-br from-fuchsia-400 to-fuchsia-600',
    featured: false,
  },
];

export default function BlogPage() {
  const [activeCategory, setActiveCategory] = useState('All');

  const filteredPosts =
    activeCategory === 'All'
      ? blogPosts
      : blogPosts.filter((p) => p.category === activeCategory);

  const featuredPost = blogPosts.find((p) => p.featured);
  const regularPosts = filteredPosts.filter((p) => !p.featured);
  const showFeatured = activeCategory === 'All' && featuredPost;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
      {/* Breadcrumbs */}
      <Breadcrumb className="mb-8">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Blog</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Hero */}
      <section className="max-w-2xl mb-12">
        <Badge variant="secondary" className="mb-4">
          <BookOpen className="size-3 mr-1" />
          Blog
        </Badge>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
          Insights &amp;{' '}
          <span className="text-emerald-500">updates</span>
        </h1>
        <p className="text-lg text-muted-foreground">
          Product news, engineering deep-dives, and guides from the NexusCorp team.
        </p>
      </section>

      {/* Category Tabs */}
      <div className="mb-10 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-2 text-sm font-medium rounded-lg border whitespace-nowrap shrink-0 transition-colors ${
                activeCategory === cat
                  ? 'border-emerald-500 text-emerald-500 bg-emerald-500/10'
                  : 'border-gray-200 dark:border-gray-800 text-muted-foreground hover:text-foreground hover:border-gray-300 dark:hover:border-gray-700'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Featured Post */}
      {showFeatured && (
        <article className="mb-10 group cursor-pointer">
          <a href="#" className="grid grid-cols-1 lg:grid-cols-2 gap-6 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-500/5 transition-all">
            <div className={`${featuredPost.color} h-56 lg:h-full min-h-[200px] flex items-center justify-center`}>
              <Sparkles className="size-16 text-white/30" />
            </div>
            <div className="p-6 lg:p-8 flex flex-col justify-center">
              <Badge variant="secondary" className="w-fit mb-3">{featuredPost.category}</Badge>
              <h2 className="text-xl sm:text-2xl font-bold mb-3 group-hover:text-emerald-500 transition-colors">
                {featuredPost.title}
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                {featuredPost.excerpt}
              </p>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Calendar className="size-3.5" />
                  {featuredPost.date}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="size-3.5" />
                  {featuredPost.readTime}
                </span>
              </div>
            </div>
          </a>
        </article>
      )}

      {/* Blog Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {(showFeatured ? regularPosts : filteredPosts).map((post) => (
          <article
            key={post.title}
            className="group cursor-pointer"
          >
            <a href="#" className="block rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden hover:border-emerald-500/50 hover:shadow-md hover:shadow-emerald-500/5 transition-all h-full">
              <div className={`${post.color} h-44 flex items-center justify-center`}>
                <BookOpen className="size-10 text-white/30" />
              </div>
              <div className="p-5">
                <Badge variant="secondary" className="mb-3 text-xs">{post.category}</Badge>
                <h3 className="font-semibold mb-2 group-hover:text-emerald-500 transition-colors line-clamp-2">
                  {post.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2 mb-4">
                  {post.excerpt}
                </p>
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-3 border-t border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3" />
                      {post.date}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {post.readTime}
                    </span>
                  </div>
                  <ArrowRight className="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-500" />
                </div>
              </div>
            </a>
          </article>
        ))}
      </div>

      {filteredPosts.length === 0 && (
        <div className="text-center py-20">
          <BookOpen className="size-10 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No posts found in this category.</p>
        </div>
      )}

      {/* Load More */}
      {filteredPosts.length > 0 && (
        <div className="text-center mt-12">
          <button
            type="button"
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-800 text-muted-foreground hover:text-foreground hover:border-emerald-500/50 transition-colors"
          >
            Load more posts
            <ArrowRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
