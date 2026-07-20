'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Plus, FolderOpen, Folder, FileText, ChevronRight,
  ChevronDown, Grid3X3, List, Clock, Eye, MessageSquare,
  Tag, BookOpen, MoreHorizontal, Star, StarOff,
  Heart, Share2, Bookmark, ExternalLink,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

// ─── Types & Data ───────────────────────────────────────────────────────────

interface FolderItem {
  id: string;
  name: string;
  icon: 'folder';
  children: TreeItem[];
}

interface DocumentItem {
  id: string;
  name: string;
  icon: 'file';
  parentFolder: string;
  lastEdited: string;
  editedBy: string;
  tags: string[];
  content: string;
  comments: CommentItem[];
}

interface CommentItem {
  id: string;
  author: string;
  avatar: string;
  initials: string;
  time: string;
  text: string;
}

type TreeItem = FolderItem | DocumentItem;

const documentContent: Record<string, { content: string; comments: CommentItem[] }> = {
  'welcome-nexuscorp': {
    content: 'Welcome to NexusCorp! We are thrilled to have you as part of our growing family. NexusCorp was founded with a singular vision: to empower businesses through innovative technology solutions that drive measurable results and lasting impact.\n\nAt NexusCorp, our core values are the foundation of everything we do. **Innovation First** drives us to push boundaries and explore new frontiers in enterprise technology. **Customer Obsession** means we put our clients at the center of every decision, ensuring our solutions solve real problems and deliver genuine value. **Collaboration** is woven into our DNA — we believe the best ideas emerge when diverse minds work together toward a common goal.\n\nOur mission is simple yet ambitious: to be the most trusted technology partner for growing businesses worldwide. We achieve this by maintaining the highest standards of quality, fostering a culture of continuous learning, and building products that scale with our customers\' ambitions. Every team member, from engineering to sales, plays a vital role in making this vision a reality. Welcome aboard — your journey with NexusCorp starts now.',
    comments: [
      { id: 'c1', author: 'Emily Park', avatar: '', initials: 'EP', time: '2 days ago', text: 'Great overview! Should we add a section about our remote work policy?' },
      { id: 'c2', author: 'John Smith', avatar: '', initials: 'JS', time: '1 day ago', text: 'Added a link to the engineering onboarding doc in the related pages section.' },
      { id: 'c3', author: 'Lisa Taylor', avatar: '', initials: 'LT', time: '5 hours ago', text: 'Love the emphasis on collaboration. Can we add the company values poster here?' },
    ],
  },
  'company-values': {
    content: 'Our values define who we are and guide every decision we make. They are not just words on a wall — they are living principles that shape our culture, our products, and our relationships.\n\n**Integrity** is non-negotiable. We do the right thing, even when no one is watching. We are transparent with our clients, honest with each other, and accountable for our actions. Trust is the currency we trade in, and we earn it every day through consistency and authenticity.\n\n**Excellence** is our standard. We set ambitious goals and pursue them with relentless dedication. Whether we are writing a line of code, crafting a proposal, or supporting a customer, we bring our best selves to every interaction. We embrace feedback as a gift and view every challenge as an opportunity to grow.',
    comments: [
      { id: 'c4', author: 'Alex Johnson', avatar: '', initials: 'AJ', time: '1 week ago', text: 'These values represent who we aspire to be. Let us hold ourselves accountable.' },
      { id: 'c5', author: 'Maria Garcia', avatar: '', initials: 'MG', time: '3 days ago', text: 'Suggested adding examples for each value to make them more tangible.' },
    ],
  },
  'code-of-conduct': {
    content: 'All NexusCorp employees are expected to maintain the highest standards of professional conduct. This code outlines the behaviors and practices that define our workplace culture.\n\nWe are committed to providing a safe, inclusive, and respectful environment for everyone. Harassment, discrimination, and bullying of any kind will not be tolerated. We celebrate diversity and believe that different perspectives make us stronger as a team and as a company.\n\nProfessional development is encouraged and supported. Employees are expected to stay current with industry trends, share knowledge with colleagues, and actively contribute to our learning culture. Regular feedback sessions, both giving and receiving, are an essential part of our growth process.',
    comments: [
      { id: 'c6', author: 'Lisa Taylor', avatar: '', initials: 'LT', time: '2 weeks ago', text: 'Updated to reflect the new remote work guidelines.' },
    ],
  },
  'onboarding-guide': {
    content: 'Welcome to the HR onboarding guide. This document provides a comprehensive overview of the first-week experience for all new hires at NexusCorp.\n\nYour first day will include a welcome session with your team, an IT setup walkthrough, and an introduction to our communication tools. You will receive your badge, laptop, and access credentials during the morning orientation. By the end of day one, you should be set up with email, Slack, and access to all the tools you need.\n\nThroughout your first week, you will have one-on-one meetings with your manager, a buddy from your team, and representatives from HR, IT, and Facilities. These meetings are designed to help you understand your role, our processes, and the resources available to you. Do not hesitate to ask questions — we are here to help you succeed.',
    comments: [
      { id: 'c7', author: 'Lisa Taylor', avatar: '', initials: 'LT', time: '1 week ago', text: 'Added the new IT provisioning checklist.' },
      { id: 'c8', author: 'David Kim', avatar: '', initials: 'DK', time: '4 days ago', text: 'The DevOps onboarding section could use a link to our internal wiki.' },
    ],
  },
  'expense-policy': {
    content: 'This policy outlines the guidelines for business expense reimbursement at NexusCorp. All employees must adhere to these procedures when incurring expenses on behalf of the company.\n\nPre-approval is required for any expense exceeding $500. Submit your expense request through the Finance portal at least 48 hours before the anticipated expense. All receipts must be uploaded within 5 business days of the expense date. Reimbursements are processed on a bi-weekly cycle and typically appear in your account within 3-5 business days after approval.',
    comments: [
      { id: 'c9', author: 'Michael Brown', avatar: '', initials: 'MB', time: '3 days ago', text: 'Updated per diem rates for Q3 2026.' },
    ],
  },
  'sprint-process': {
    content: 'NexusCorp follows a two-week sprint cycle for all engineering teams. Each sprint begins with a planning session and ends with a review and retrospective.\n\nDuring sprint planning, the team selects items from the product backlog based on priority and capacity. Each task is assigned a story point estimate, and the team commits to a realistic sprint goal. Daily standups are held at 9:30 AM to discuss progress, blockers, and priorities. The sprint review demonstrates completed work to stakeholders, while the retrospective identifies process improvements for the next cycle.',
    comments: [
      { id: 'c10', author: 'John Smith', avatar: '', initials: 'JS', time: '1 week ago', text: 'Updated the definition of done to include code review requirements.' },
      { id: 'c11', author: 'David Kim', avatar: '', initials: 'DK', time: '2 days ago', text: 'Added section on sprint velocity tracking best practices.' },
    ],
  },
  'engineering-docs': {
    content: 'This section contains engineering-specific documentation including architecture decisions, API references, and deployment guides.\n\nOur technology stack centers on Next.js for frontend applications, Node.js/TypeScript for backend services, and PostgreSQL for data persistence. We use GitHub Actions for CI/CD, AWS for infrastructure, and Datadog for monitoring. All services follow a microservices architecture pattern with clear API boundaries and versioning.\n\nDocumentation is a first-class concern for our engineering team. Every pull request must include relevant documentation updates. We use Markdown for all technical docs and maintain them alongside the codebase. The engineering wiki is the single source of truth for architectural decisions and operational runbooks.',
    comments: [
      { id: 'c12', author: 'Sarah Chen', avatar: '', initials: 'SC', time: '5 days ago', text: 'Added the data pipeline architecture diagram.' },
    ],
  },
  'proposal-template': {
    content: 'This template should be used for all client-facing proposals. It provides a consistent structure that has been refined through dozens of successful engagements.\n\nA strong proposal begins with a clear executive summary that articulates the client\'s challenge and our proposed solution. Follow this with a detailed scope of work, timeline, pricing breakdown, and team composition. Include relevant case studies and testimonials to build credibility. End with clear next steps and a call to action.\n\nAll proposals must be reviewed by the sales manager and at least one subject matter expert before being sent to the client. Use the proposal checklist in the CRM to ensure all sections are complete and approved.',
    comments: [
      { id: 'c13', author: 'Robert Williams', avatar: '', initials: 'RW', time: '1 week ago', text: 'Updated pricing section to reflect 2026 rates.' },
    ],
  },
};

const folderTree: FolderItem[] = [
  {
    id: 'f-company-handbook',
    name: 'Company Handbook',
    icon: 'folder',
    children: [
      { id: 'd-welcome', name: 'Welcome to NexusCorp', icon: 'file', parentFolder: 'Company Handbook', lastEdited: 'Jul 15, 2026', editedBy: 'Alex Johnson', tags: ['onboarding', 'company'], content: 'welcome-nexuscorp', comments: [] } as DocumentItem,
      { id: 'd-values', name: 'Company Values', icon: 'file', parentFolder: 'Company Handbook', lastEdited: 'Jul 12, 2026', editedBy: 'Maria Garcia', tags: ['culture', 'values'], content: 'company-values', comments: [] } as DocumentItem,
    ],
  },
  {
    id: 'f-policies',
    name: 'Policies',
    icon: 'folder',
    children: [
      { id: 'd-conduct', name: 'Code of Conduct', icon: 'file', parentFolder: 'Policies', lastEdited: 'Jul 10, 2026', editedBy: 'Lisa Taylor', tags: ['hr', 'compliance'], content: 'code-of-conduct', comments: [] } as DocumentItem,
      { id: 'd-expense', name: 'Expense Policy', icon: 'file', parentFolder: 'Policies', lastEdited: 'Jul 8, 2026', editedBy: 'Michael Brown', tags: ['finance', 'policy'], content: 'expense-policy', comments: [] } as DocumentItem,
    ],
  },
  {
    id: 'f-procedures',
    name: 'Procedures',
    icon: 'folder',
    children: [
      { id: 'd-onboarding', name: 'New Hire Onboarding', icon: 'file', parentFolder: 'Procedures', lastEdited: 'Jul 14, 2026', editedBy: 'Lisa Taylor', tags: ['hr', 'onboarding'], content: 'onboarding-guide', comments: [] } as DocumentItem,
      { id: 'd-sprint', name: 'Sprint Process', icon: 'file', parentFolder: 'Procedures', lastEdited: 'Jul 11, 2026', editedBy: 'John Smith', tags: ['engineering', 'agile'], content: 'sprint-process', comments: [] } as DocumentItem,
    ],
  },
  {
    id: 'f-dept-docs',
    name: 'Department Docs',
    icon: 'folder',
    children: [
      { id: 'd-eng-docs', name: 'Engineering Docs', icon: 'file', parentFolder: 'Department Docs', lastEdited: 'Jul 13, 2026', editedBy: 'David Kim', tags: ['engineering', 'technical'], content: 'engineering-docs', comments: [] } as DocumentItem,
    ],
  },
  {
    id: 'f-templates',
    name: 'Templates',
    icon: 'folder',
    children: [
      { id: 'd-proposal', name: 'Proposal Template', icon: 'file', parentFolder: 'Templates', lastEdited: 'Jul 9, 2026', editedBy: 'Robert Williams', tags: ['sales', 'template'], content: 'proposal-template', comments: [] } as DocumentItem,
    ],
  },
];

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

const avatarColors = [
  'bg-emerald-500', 'bg-teal-500', 'bg-cyan-500', 'bg-indigo-500',
  'bg-violet-500', 'bg-rose-500', 'bg-amber-500', 'bg-sky-500',
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function WorkspaceModule() {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(['f-company-handbook'])
  );
  const [activeDocId, setActiveDocId] = useState('d-welcome');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [starred, setStarred] = useState<Set<string>>(new Set(['d-welcome', 'd-values']));

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const toggleStar = (docId: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  // Find active document
  const findDoc = (items: TreeItem[], docId: string): DocumentItem | null => {
    for (const item of items) {
      if (item.icon === 'file' && item.id === docId) return item as DocumentItem;
      if (item.icon === 'folder') {
        const found = findDoc((item as FolderItem).children, docId);
        if (found) return found;
      }
    }
    return null;
  };

  const activeDoc = findDoc(folderTree as unknown as TreeItem[], activeDocId);
  const docData = activeDoc ? documentContent[activeDoc.content] : null;

  // Render tree item
  const renderTreeItem = (item: TreeItem, depth: number = 0) => {
    if (item.icon === 'folder') {
      const folder = item as FolderItem;
      const isExpanded = expandedFolders.has(folder.id);
      return (
        <div key={folder.id}>
          <motion.button
            whileHover={{ x: 2 }}
            onClick={() => toggleFolder(folder.id)}
            className={cn(
              'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-sm transition-colors group',
              'hover:bg-muted text-muted-foreground hover:text-foreground'
            )}
            style={{ paddingLeft: `${depth * 16 + 10}px` }}
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />
            )}
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 flex-shrink-0 text-amber-500" />
            ) : (
              <Folder className="h-4 w-4 flex-shrink-0 text-amber-500/70" />
            )}
            <span className="font-medium truncate flex-1">{folder.name}</span>
            <span className="text-[10px] text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity">
              {folder.children.length}
            </span>
          </motion.button>
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                {folder.children.map((child) => renderTreeItem(child as TreeItem, depth + 1))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    }

    // File item
    const doc = item as DocumentItem;
    const isActive = doc.id === activeDocId;
    const isStarredDoc = starred.has(doc.id);
    return (
      <motion.button
        key={doc.id}
        whileHover={{ x: 2 }}
        onClick={() => setActiveDocId(doc.id)}
        className={cn(
          'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-sm transition-all group',
          isActive
            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-medium'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
        style={{ paddingLeft: `${depth * 16 + 10}px` }}
      >
        <span className="w-3.5" />
        <FileText
          className={cn(
            'h-4 w-4 flex-shrink-0',
            isActive ? 'text-emerald-500' : 'text-slate-400'
          )}
        />
        <span className="truncate flex-1">{doc.name}</span>
        {isStarredDoc && (
          <Star className="h-3 w-3 fill-amber-400 text-amber-400 flex-shrink-0" />
        )}
      </motion.button>
    );
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full bg-background">
        {/* ── Left Panel: Folder Tree ──────────────────────────────────── */}
        <motion.div
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="w-64 flex-shrink-0 border-r border-border bg-muted/30 flex flex-col"
        >
          {/* Header */}
          <div className="p-3 pb-2">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-emerald-500" />
                <h2 className="font-semibold text-sm text-foreground">Workspace</h2>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>New folder</TooltipContent>
              </Tooltip>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search pages..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-sm bg-background border-border"
              />
            </div>
          </div>

          <Separator className="opacity-50" />

          {/* Tree */}
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-0.5">
              {folderTree.map((folder) => renderTreeItem(folder as unknown as TreeItem))}
            </div>
          </ScrollArea>

          {/* Bottom stats */}
          <div className="p-3 border-t border-border">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              <span>{folderTree.reduce((acc, f) => acc + f.children.length, 0)} pages</span>
              <span className="text-muted-foreground/40">&bull;</span>
              <Folder className="h-3.5 w-3.5" />
              <span>{folderTree.length} folders</span>
            </div>
          </div>
        </motion.div>

        {/* ── Right Panel: Document Viewer ─────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <div className="h-14 flex items-center justify-between px-4 border-b border-border bg-background/80 backdrop-blur-sm flex-shrink-0">
            {/* Breadcrumb */}
            {activeDoc && (
              <Breadcrumb className="flex-1 min-w-0">
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink className="text-xs">Workspace</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbLink className="text-xs">{activeDoc.parentFolder}</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      {activeDoc.name}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            )}
            <div className="flex items-center gap-1.5 ml-4 flex-shrink-0">
              {/* View toggle */}
              <div className="flex items-center rounded-md border border-border bg-muted/50 p-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'h-7 w-7',
                    viewMode === 'list'
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground'
                  )}
                >
                  <List className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setViewMode('grid')}
                  className={cn(
                    'h-7 w-7',
                    viewMode === 'grid'
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground'
                  )}
                >
                  <Grid3X3 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Separator orientation="vertical" className="h-6 mx-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => activeDocId && toggleStar(activeDocId)}>
                    {starred.has(activeDocId) ? (
                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    ) : (
                      <StarOff className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{starred.has(activeDocId) ? 'Remove from favorites' : 'Add to favorites'}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Share2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Share</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Bookmark className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Bookmark</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>More</TooltipContent>
              </Tooltip>
              <Separator orientation="vertical" className="h-6 mx-1" />
              <Button size="sm" className="h-8 bg-emerald-500 hover:bg-emerald-600 text-white gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                New Page
              </Button>
            </div>
          </div>

          {/* Document Content */}
          <ScrollArea className="flex-1">
            <AnimatePresence mode="wait">
              {activeDoc && docData ? (
                <motion.div
                  key={activeDocId}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="max-w-3xl mx-auto p-6 pb-24"
                >
                  {/* Title */}
                  <h1 className="text-2xl font-bold text-foreground mb-2">{activeDoc.name}</h1>

                  {/* Meta info */}
                  <div className="flex items-center gap-4 mb-6 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className={cn('text-white text-[9px] font-medium', getAvatarColor(activeDoc.editedBy))}>
                            {getInitials(activeDoc.editedBy)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-foreground/80">{activeDoc.editedBy}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      <span>Last edited {activeDoc.lastEdited}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      <span>142 views</span>
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="flex items-center gap-1.5 mb-6">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                    {activeDoc.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="text-[11px] h-5 px-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 cursor-pointer"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>

                  <Separator className="mb-6" />

                  {/* Content */}
                  <div className="prose prose-sm prose-slate dark:prose-invert max-w-none">
                    {docData.content.split('\n\n').map((paragraph, idx) => (
                      <motion.p
                        key={idx}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 * idx, duration: 0.3 }}
                        className="text-sm leading-relaxed text-foreground/85 mb-4"
                      >
                        {paragraph.split('**').map((part, pi) =>
                          pi % 2 === 1 ? (
                            <strong key={pi} className="font-semibold text-foreground">{part}</strong>
                          ) : (
                            <span key={pi}>{part}</span>
                          )
                        )}
                      </motion.p>
                    ))}
                  </div>

                  <Separator className="my-8" />

                  {/* Comments Section */}
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <MessageSquare className="h-4 w-4 text-emerald-500" />
                      <h3 className="font-semibold text-sm text-foreground">Comments</h3>
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                        {docData.comments.length}
                      </Badge>
                    </div>

                    <div className="space-y-4">
                      {docData.comments.map((comment, idx) => (
                        <motion.div
                          key={comment.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.1 * idx, duration: 0.25 }}
                          className="flex gap-3 group"
                        >
                          <Avatar className="h-7 w-7 mt-0.5 flex-shrink-0">
                            <AvatarFallback
                              className={cn(
                                'text-white text-[10px] font-medium',
                                getAvatarColor(comment.author)
                              )}
                            >
                              {comment.initials}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium text-foreground">{comment.author}</span>
                              <span className="text-[11px] text-muted-foreground">{comment.time}</span>
                            </div>
                            <p className="text-sm text-foreground/80 leading-relaxed">
                              {comment.text}
                            </p>
                            {/* Hover actions */}
                            <div className="flex items-center gap-3 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-emerald-500 transition-colors">
                                <Heart className="h-3 w-3" />
                                Like
                              </button>
                              <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-emerald-500 transition-colors">
                                <MessageSquare className="h-3 w-3" />
                                Reply
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    {/* Add comment input */}
                    <div className="mt-6 flex gap-3 items-start">
                      <Avatar className="h-7 w-7 mt-0.5 flex-shrink-0">
                        <AvatarFallback className="bg-emerald-600 text-white text-[10px] font-semibold">
                          AJ
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <Input
                          placeholder="Add a comment..."
                          className="h-9 text-sm border-border focus-visible:ring-emerald-500/30"
                        />
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground">
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          </div>
                          <Button
                            size="sm"
                            className="h-7 px-3 bg-emerald-500 hover:bg-emerald-600 text-white text-xs"
                          >
                            Comment
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center h-full text-center py-20"
                >
                  <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-1">No page selected</h3>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    Select a page from the sidebar or create a new one to get started.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </ScrollArea>
        </div>
      </div>
    </TooltipProvider>
  );
}