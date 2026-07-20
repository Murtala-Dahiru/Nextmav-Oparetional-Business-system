import { db } from '@/lib/db';
import { v4 as uuid } from 'uuid';

const NOW = new Date('2026-07-21T00:00:00Z');
const DAYS = (n: number) => new Date(NOW.getTime() + n * 86400000);
const HOURS = (n: number) => new Date(NOW.getTime() + n * 3600000);

const userIds = {
  alex: 'u1',
  sarah: 'u2',
  john: 'u3',
  emily: 'u4',
  michael: 'u5',
  lisa: 'u6',
};

async function seed() {
  console.log('Seeding database...');

  // ── Roles ────────────────────────────────────────────────────────
  await db.role.createMany({
    data: [
      { id: 'role-admin', name: 'Admin', description: 'Full system access', isSystem: true, permissions: JSON.stringify({ all: true }), createdAt: NOW },
      { id: 'role-manager', name: 'Manager', description: 'Module management access', isSystem: true, permissions: JSON.stringify({ crm: ['read','write'], projects: ['read','write'], hr: ['read'], finance: ['read','write'], inventory: ['read','write'], support: ['read','write'], calendar: ['read','write'], workspace: ['read','write'], communication: ['read','write'], admin: ['read'] }), createdAt: NOW },
      { id: 'role-user', name: 'User', description: 'Standard user access', isSystem: true, permissions: JSON.stringify({ crm: ['read'], projects: ['read','write'], hr: ['read'], finance: ['read'], inventory: ['read'], support: ['read','write'], calendar: ['read','write'], workspace: ['read','write'], communication: ['read','write'], admin: [] }), createdAt: NOW },
    ],
  });

  // ── Users ────────────────────────────────────────────────────────
  await db.user.createMany({
    data: [
      { id: userIds.alex, email: 'alex.johnson@nexuscorp.com', firstName: 'Alex', lastName: 'Johnson', jobTitle: 'CEO', department: 'Executive', phone: '+1 555-0101', roleId: 'role-admin', isActive: true, lastSeen: NOW, createdAt: DAYS(-365) },
      { id: userIds.sarah, email: 'sarah.chen@nexuscorp.com', firstName: 'Sarah', lastName: 'Chen', jobTitle: 'VP of Sales', department: 'Sales', phone: '+1 555-0102', roleId: 'role-manager', isActive: true, lastSeen: HOURS(-1), createdAt: DAYS(-300) },
      { id: userIds.john, email: 'john.davis@nexuscorp.com', firstName: 'John', lastName: 'Davis', jobTitle: 'Senior Developer', department: 'Engineering', phone: '+1 555-0103', roleId: 'role-user', isActive: true, lastSeen: HOURS(-3), createdAt: DAYS(-250) },
      { id: userIds.emily, email: 'emily.martinez@nexuscorp.com', firstName: 'Emily', lastName: 'Martinez', jobTitle: 'HR Manager', department: 'Human Resources', phone: '+1 555-0104', roleId: 'role-manager', isActive: true, lastSeen: HOURS(-2), createdAt: DAYS(-200) },
      { id: userIds.michael, email: 'michael.lee@nexuscorp.com', firstName: 'Michael', lastName: 'Lee', jobTitle: 'Finance Director', department: 'Finance', phone: '+1 555-0105', roleId: 'role-manager', isActive: true, lastSeen: DAYS(-1), createdAt: DAYS(-180) },
      { id: userIds.lisa, email: 'lisa.thompson@nexuscorp.com', firstName: 'Lisa', lastName: 'Thompson', jobTitle: 'Support Lead', department: 'Customer Success', phone: '+1 555-0106', roleId: 'role-user', isActive: true, lastSeen: HOURS(-5), createdAt: DAYS(-150) },
    ],
  });

  // ── Companies ────────────────────────────────────────────────────
  const companies = [
    { id: 'comp-1', name: 'Acme Corp', industry: 'Technology', website: 'acmecorp.com', city: 'San Francisco', country: 'USA', employeeCount: 500, annualRevenue: 25000000 },
    { id: 'comp-2', name: 'TechStart Inc', industry: 'SaaS', website: 'techstart.io', city: 'New York', country: 'USA', employeeCount: 120, annualRevenue: 8500000 },
    { id: 'comp-3', name: 'Global Dynamics', industry: 'Manufacturing', website: 'globaldyn.com', city: 'Chicago', country: 'USA', employeeCount: 2000, annualRevenue: 150000000 },
    { id: 'comp-4', name: 'Pinnacle Solutions', industry: 'Consulting', website: 'pinnacle.co', city: 'London', country: 'UK', employeeCount: 350, annualRevenue: 18000000 },
    { id: 'comp-5', name: 'NexaTech', industry: 'AI & ML', website: 'nexatech.ai', city: 'Austin', country: 'USA', employeeCount: 80, annualRevenue: 4200000 },
    { id: 'comp-6', name: 'Meridian Health', industry: 'Healthcare', website: 'meridianhealth.com', city: 'Boston', country: 'USA', employeeCount: 1200, annualRevenue: 95000000 },
    { id: 'comp-7', name: 'Orbit Logistics', industry: 'Logistics', website: 'orbitlog.com', city: 'Atlanta', country: 'USA', employeeCount: 450, annualRevenue: 32000000 },
    { id: 'comp-8', name: 'Brightwave Media', industry: 'Media', website: 'brightwave.com', city: 'Los Angeles', country: 'USA', employeeCount: 200, annualRevenue: 12000000 },
  ];
  await db.company.createMany({ data: companies.map(c => ({ ...c, createdAt: DAYS(-90) })) });

  // ── Leads ────────────────────────────────────────────────────────
  const leadSources = ['web', 'referral', 'social', 'email', 'manual'] as const;
  const leadStatuses = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
  const leads = [
    { firstName: 'Robert', lastName: 'Williams', email: 'r.williams@acmecorp.com', company: 'Acme Corp', title: 'CTO', source: 'referral', status: 'qualified', score: 85, value: 45000, ownerId: userIds.sarah },
    { firstName: 'Amanda', lastName: 'Taylor', email: 'a.taylor@techstart.io', company: 'TechStart Inc', title: 'VP Engineering', source: 'web', status: 'proposal', score: 92, value: 28000, ownerId: userIds.sarah },
    { firstName: 'David', lastName: 'Brown', email: 'd.brown@globaldyn.com', company: 'Global Dynamics', title: 'Director of IT', source: 'referral', status: 'negotiation', score: 78, value: 120000, ownerId: userIds.alex },
    { firstName: 'Jennifer', lastName: 'Wilson', email: 'j.wilson@pinnacle.co', company: 'Pinnacle Solutions', title: 'Managing Partner', source: 'social', status: 'contacted', score: 65, value: 35000, ownerId: userIds.sarah },
    { firstName: 'Chris', lastName: 'Anderson', email: 'c.anderson@nexatech.ai', company: 'NexaTech', title: 'CEO', source: 'web', status: 'new', score: 72, value: 18000, ownerId: userIds.sarah },
    { firstName: 'Patricia', lastName: 'Garcia', email: 'p.garcia@meridianhealth.com', company: 'Meridian Health', title: 'CIO', source: 'email', status: 'qualified', score: 88, value: 85000, ownerId: userIds.alex },
    { firstName: 'James', lastName: 'Miller', email: 'j.miller@orbitlog.com', company: 'Orbit Logistics', title: 'Operations Director', source: 'referral', status: 'won', score: 95, value: 65000, ownerId: userIds.sarah },
    { firstName: 'Megan', lastName: 'Thomas', email: 'm.thomas@brightwave.com', company: 'Brightwave Media', title: 'Head of Digital', source: 'social', status: 'lost', score: 45, value: 22000, ownerId: userIds.sarah },
    { firstName: 'Kevin', lastName: 'Jackson', email: 'k.jackson@startupco.io', company: 'StartupCo', title: 'Founder', source: 'web', status: 'new', score: 58, value: 15000, ownerId: userIds.sarah },
    { firstName: 'Laura', lastName: 'White', email: 'l.white@innovatelab.com', company: 'InnovateLab', title: 'Product Manager', source: 'manual', status: 'contacted', score: 70, value: 32000, ownerId: userIds.alex },
    { firstName: 'Daniel', lastName: 'Harris', email: 'd.harris@cloudnine.io', company: 'CloudNine', title: 'CTO', source: 'web', status: 'new', score: 82, value: 52000, ownerId: userIds.sarah },
    { firstName: 'Rachel', lastName: 'Clark', email: 'r.clark@datavault.com', company: 'DataVault', title: 'VP Data', source: 'referral', status: 'proposal', score: 90, value: 78000, ownerId: userIds.alex },
  ];
  await db.lead.createMany({ data: leads.map((l, i) => ({ ...l, id: `lead-${i+1}`, createdAt: DAYS(-30 + i * 2) })) });

  // ── Contacts ─────────────────────────────────────────────────────
  const contacts = [
    { firstName: 'Robert', lastName: 'Williams', email: 'r.williams@acmecorp.com', phone: '+1 555-2001', jobTitle: 'CTO', company: 'Acme Corp', source: 'referral', isActive: true },
    { firstName: 'Amanda', lastName: 'Taylor', email: 'a.taylor@techstart.io', phone: '+1 555-2002', jobTitle: 'VP Engineering', company: 'TechStart Inc', source: 'web', isActive: true },
    { firstName: 'David', lastName: 'Brown', email: 'd.brown@globaldyn.com', phone: '+1 555-2003', jobTitle: 'Director of IT', company: 'Global Dynamics', source: 'referral', isActive: true },
    { firstName: 'Jennifer', lastName: 'Wilson', email: 'j.wilson@pinnacle.co', phone: '+1 555-2004', jobTitle: 'Managing Partner', company: 'Pinnacle Solutions', source: 'social', isActive: true },
    { firstName: 'Patricia', lastName: 'Garcia', email: 'p.garcia@meridianhealth.com', phone: '+1 555-2005', jobTitle: 'CIO', company: 'Meridian Health', source: 'email', isActive: true },
    { firstName: 'James', lastName: 'Miller', email: 'j.miller@orbitlog.com', phone: '+1 555-2006', jobTitle: 'Operations Director', company: 'Orbit Logistics', source: 'referral', isActive: true },
    { firstName: 'Megan', lastName: 'Thomas', email: 'm.thomas@brightwave.com', phone: '+1 555-2007', jobTitle: 'Head of Digital', company: 'Brightwave Media', source: 'social', isActive: false },
    { firstName: 'Rachel', lastName: 'Clark', email: 'r.clark@datavault.com', phone: '+1 555-2008', jobTitle: 'VP Data', company: 'DataVault', source: 'referral', isActive: true },
  ];
  await db.contact.createMany({ data: contacts.map((c, i) => ({ ...c, id: `contact-${i+1}`, createdAt: DAYS(-60 + i * 5) })) });

  // ── Deals ────────────────────────────────────────────────────────
  const deals = [
    { name: 'Acme Corp Enterprise License', value: 45000, stage: 'proposal', probability: 60, closeDate: DAYS(30), contactName: 'Robert Williams', companyName: 'Acme Corp', ownerId: userIds.sarah },
    { name: 'TechStart Annual Contract', value: 28000, stage: 'negotiation', probability: 75, closeDate: DAYS(14), contactName: 'Amanda Taylor', companyName: 'TechStart Inc', ownerId: userIds.sarah },
    { name: 'Global Dynamics Platform Deal', value: 120000, stage: 'negotiation', probability: 50, closeDate: DAYS(60), contactName: 'David Brown', companyName: 'Global Dynamics', ownerId: userIds.alex },
    { name: 'Pinnacle Consulting Package', value: 35000, stage: 'qualification', probability: 30, closeDate: DAYS(90), contactName: 'Jennifer Wilson', companyName: 'Pinnacle Solutions', ownerId: userIds.sarah },
    { name: 'Meridian Health Integration', value: 85000, stage: 'proposal', probability: 65, closeDate: DAYS(45), contactName: 'Patricia Garcia', companyName: 'Meridian Health', ownerId: userIds.alex },
    { name: 'Orbit Logistics Deployment', value: 65000, stage: 'closed-won', probability: 100, closeDate: DAYS(-10), contactName: 'James Miller', companyName: 'Orbit Logistics', ownerId: userIds.sarah },
    { name: 'NexaTech Starter Plan', value: 18000, stage: 'prospecting', probability: 15, closeDate: DAYS(120), contactName: 'Chris Anderson', companyName: 'NexaTech', ownerId: userIds.sarah },
    { name: 'DataVault Analytics Suite', value: 78000, stage: 'proposal', probability: 55, closeDate: DAYS(35), contactName: 'Rachel Clark', companyName: 'DataVault', ownerId: userIds.alex },
  ];
  await db.deal.createMany({ data: deals.map((d, i) => ({ ...d, id: `deal-${i+1}`, createdAt: DAYS(-45 + i * 5) })) });

  // ── Projects ─────────────────────────────────────────────────────
  const projects = [
    { name: 'Website Redesign', description: 'Complete redesign of the corporate website with new branding and improved UX', status: 'active', priority: 'high', startDate: DAYS(-30), endDate: DAYS(30), budget: 45000, ownerId: userIds.alex },
    { name: 'Mobile App v2.0', description: 'Second major release of the mobile application with offline support', status: 'active', priority: 'critical', startDate: DAYS(-45), endDate: DAYS(60), budget: 120000, ownerId: userIds.alex },
    { name: 'API Gateway Migration', description: 'Migrate from legacy API gateway to modern cloud-native solution', status: 'active', priority: 'high', startDate: DAYS(-20), endDate: DAYS(40), budget: 35000, ownerId: userIds.john },
    { name: 'Data Pipeline Optimization', description: 'Optimize ETL pipelines for real-time analytics processing', status: 'planning', priority: 'medium', startDate: DAYS(10), endDate: DAYS(80), budget: 28000, ownerId: userIds.john },
    { name: 'Customer Portal', description: 'Self-service portal for enterprise customers', status: 'active', priority: 'high', startDate: DAYS(-15), endDate: DAYS(45), budget: 55000, ownerId: userIds.sarah },
    { name: 'Security Audit Q3', description: 'Quarterly security audit and compliance review', status: 'on-hold', priority: 'medium', startDate: DAYS(-5), endDate: DAYS(25), budget: 15000, ownerId: userIds.alex },
  ];
  await db.project.createMany({ data: projects.map((p, i) => ({ ...p, id: `proj-${i+1}`, createdAt: DAYS(-45 + i * 8) })) });

  // ── Tasks ────────────────────────────────────────────────────────
  const taskTemplates = [
    { title: 'Design system audit', description: 'Audit current design system for inconsistencies', status: 'done', priority: 'high', projectId: 'proj-1', assigneeId: userIds.john, dueDate: DAYS(-20), estimatedHours: 8, loggedHours: 7.5, sortOrder: 0 },
    { title: 'Create wireframes', description: 'Design wireframes for all key pages', status: 'done', priority: 'high', projectId: 'proj-1', assigneeId: userIds.john, dueDate: DAYS(-15), estimatedHours: 16, loggedHours: 14, sortOrder: 1 },
    { title: 'Implement header component', description: 'Build responsive header with navigation', status: 'done', priority: 'medium', projectId: 'proj-1', assigneeId: userIds.john, dueDate: DAYS(-10), estimatedHours: 6, loggedHours: 5, sortOrder: 2 },
    { title: 'Build landing page', description: 'Implement the new landing page design', status: 'in-progress', priority: 'high', projectId: 'proj-1', assigneeId: userIds.john, dueDate: DAYS(-2), estimatedHours: 12, loggedHours: 8, sortOrder: 3 },
    { title: 'Setup offline storage', description: 'Implement SQLite offline storage layer', status: 'done', priority: 'critical', projectId: 'proj-2', assigneeId: userIds.john, dueDate: DAYS(-30), estimatedHours: 20, loggedHours: 18, sortOrder: 0 },
    { title: 'Implement sync engine', description: 'Build conflict-free sync mechanism', status: 'in-progress', priority: 'critical', projectId: 'proj-2', assigneeId: userIds.john, dueDate: DAYS(10), estimatedHours: 24, loggedHours: 12, sortOrder: 1 },
    { title: 'Push notifications', description: 'Integrate push notification service', status: 'todo', priority: 'high', projectId: 'proj-2', assigneeId: userIds.john, dueDate: DAYS(25), estimatedHours: 10, loggedHours: 0, sortOrder: 2 },
    { title: 'Performance optimization', description: 'Optimize app startup and render performance', status: 'todo', priority: 'medium', projectId: 'proj-2', assigneeId: userIds.john, dueDate: DAYS(40), estimatedHours: 16, loggedHours: 0, sortOrder: 3 },
    { title: 'Evaluate gateway options', description: 'Research and evaluate API gateway solutions', status: 'done', priority: 'high', projectId: 'proj-3', assigneeId: userIds.john, dueDate: DAYS(-10), estimatedHours: 8, loggedHours: 7, sortOrder: 0 },
    { title: 'Migrate authentication', description: 'Migrate auth service to new gateway', status: 'in-progress', priority: 'critical', projectId: 'proj-3', assigneeId: userIds.john, dueDate: DAYS(15), estimatedHours: 16, loggedHours: 6, sortOrder: 1 },
    { title: 'Migrate billing endpoints', description: 'Move billing API endpoints to new gateway', status: 'todo', priority: 'high', projectId: 'proj-3', assigneeId: userIds.john, dueDate: DAYS(25), estimatedHours: 12, loggedHours: 0, sortOrder: 2 },
    { title: 'Design portal wireframes', description: 'Create UX wireframes for customer portal', status: 'in-progress', priority: 'high', projectId: 'proj-5', assigneeId: userIds.sarah, dueDate: DAYS(5), estimatedHours: 10, loggedHours: 6, sortOrder: 0 },
    { title: 'Build authentication flow', description: 'Implement SSO and MFA for customer portal', status: 'todo', priority: 'critical', projectId: 'proj-5', assigneeId: userIds.john, dueDate: DAYS(20), estimatedHours: 14, loggedHours: 0, sortOrder: 1 },
    { title: 'Implement dashboard', description: 'Build the customer-facing dashboard', status: 'todo', priority: 'high', projectId: 'proj-5', assigneeId: userIds.john, dueDate: DAYS(35), estimatedHours: 20, loggedHours: 0, sortOrder: 2 },
  ];
  await db.projectTask.createMany({ data: taskTemplates.map((t, i) => ({ ...t, id: `task-${i+1}`, createdAt: DAYS(-30 + i * 2) })) });

  // ── Workspace Pages ──────────────────────────────────────────────
  const pages = [
    { title: 'Product Roadmap', content: '## Q3 2026 Roadmap\n\n### Priority 1\n- [x] Design system v2\n- [ ] API Gateway migration\n- [ ] Mobile app v2.0\n\n### Priority 2\n- [ ] Customer portal\n- [ ] Analytics dashboard\n- [ ] Workflow automation', icon: 'map', color: '#10b981', parentId: '', isFolder: false, isStarred: true, lastEditedBy: userIds.alex },
    { title: 'Engineering Standards', content: '## Code Review Guidelines\n\n1. All PRs require at least 1 approval\n2. Tests must pass before merge\n3. No direct commits to main\n4. Use conventional commits\n5. Document public APIs', icon: 'book-open', color: '#14b8a6', parentId: '', isFolder: false, isStarred: true, lastEditedBy: userIds.john },
    { title: 'Meeting Notes', content: '## Sprint Planning - July 21\n\n### Decisions\n- Focus on mobile app v2.0\n- Defer security audit to Q4\n- Hire 2 more frontend engineers\n\n### Action Items\n- @john: Complete sync engine by Aug 1\n- @sarah: Finalize portal wireframes by July 28', icon: 'file-text', color: '#f59e0b', parentId: '', isFolder: false, isStarred: false, lastEditedBy: userIds.sarah },
    { title: 'Architecture Decisions', content: '## ADR-001: Database Selection\n\n**Status**: Accepted\n\nWe chose SQLite for the initial release due to zero-config deployment and sufficient performance for single-tenant use.\n\n## ADR-002: State Management\n\n**Status**: Accepted\n\nZustand for client state, TanStack Query for server state.', icon: 'file-text', color: '#8b5cf6', parentId: '', isFolder: false, isStarred: false, lastEditedBy: userIds.alex },
    { title: 'Project Documentation', content: '', icon: 'folder', color: '#64748b', parentId: '', isFolder: true, isStarred: false, lastEditedBy: '' },
    { title: 'Onboarding Guide', content: '## New Employee Onboarding\n\n### Week 1\n- Setup development environment\n- Review codebase architecture\n- Shadow team members\n\n### Week 2\n- First small task assignment\n- Code review training\n- Meet all team members', icon: 'file-text', color: '#06b6d4', parentId: 'page-5', isFolder: false, isStarred: false, lastEditedBy: userIds.emily },
  ];
  await db.workspacePage.createMany({ data: pages.map((p, i) => ({ ...p, id: `page-${i+1}`, createdAt: DAYS(-60 + i * 10) })) });

  // ── Channels & Messages ──────────────────────────────────────────
  const channels = [
    { name: 'general', type: 'public', description: 'Company-wide announcements and discussions', creatorId: userIds.alex },
    { name: 'engineering', type: 'public', description: 'Engineering team discussions', creatorId: userIds.john },
    { name: 'sales', type: 'public', description: 'Sales team updates and deal discussions', creatorId: userIds.sarah },
    { name: 'random', type: 'public', description: 'Non-work conversations and fun', creatorId: userIds.alex },
    { name: 'leadership', type: 'private', description: 'Executive team discussions', creatorId: userIds.alex },
    { name: 'sarah-chen', type: 'direct', description: '', creatorId: userIds.alex },
  ];
  await db.channel.createMany({ data: channels.map((c, i) => ({ ...c, id: `ch-${i+1}`, createdAt: DAYS(-90) })) });

  const messageTemplates = [
    { content: 'Good morning everyone! Sprint planning starts at 10 AM today. Please have your updates ready.', senderId: userIds.alex, channelId: 'ch-1', isPinned: true, createdAt: HOURS(-8) },
    { content: 'The new design system documentation is live. Check the Engineering Standards page in Workspace.', senderId: userIds.john, channelId: 'ch-2', isPinned: true, createdAt: HOURS(-24) },
    { content: 'Acme Corp deal moved to proposal stage. The demo went really well yesterday.', senderId: userIds.sarah, channelId: 'ch-3', isPinned: false, createdAt: HOURS(-4) },
    { content: 'Welcome to the team! Feel free to ask anything in #general.', senderId: userIds.alex, channelId: 'ch-1', isPinned: false, createdAt: HOURS(-6) },
    { content: 'Has anyone tested the new offline sync on iOS? I\'m seeing some edge cases.', senderId: userIds.john, channelId: 'ch-2', isPinned: false, createdAt: HOURS(-3) },
    { content: 'TechStart contract negotiation is progressing. They want a 20% volume discount.', senderId: userIds.sarah, channelId: 'ch-3', isPinned: false, createdAt: HOURS(-2) },
    { content: 'Q3 revenue targets have been distributed. Let me know if you have questions.', senderId: userIds.michael, channelId: 'ch-5', isPinned: false, createdAt: HOURS(-12) },
    { content: 'Can we schedule a review for the API migration? I want to make sure we\'re not missing anything.', senderId: userIds.john, channelId: 'ch-2', isPinned: false, createdAt: HOURS(-1) },
  ];
  await db.message.createMany({ data: messageTemplates.map((m, i) => ({ ...m, id: `msg-${i+1}` })) });

  // ── Support Tickets ──────────────────────────────────────────────
  const tickets = [
    { ticketNumber: 'TKT-001', subject: 'Unable to export reports to PDF', description: 'When clicking "Export to PDF" in the Reports module, nothing happens. No error shown. Using Chrome 120 on macOS.', priority: 'high', status: 'in-progress', category: 'technical', contactName: 'Robert Williams', contactEmail: 'r.williams@acmecorp.com', assigneeId: userIds.john, dueDate: DAYS(2), createdAt: DAYS(-3) },
    { ticketNumber: 'TKT-002', subject: 'Invoice shows incorrect tax calculation', description: 'Invoice #INV-2024-045 shows 8.5% tax instead of 10%. The subtotal is correct but the tax line is wrong.', priority: 'medium', status: 'open', category: 'billing', contactName: 'Amanda Taylor', contactEmail: 'a.taylor@techstart.io', assigneeId: userIds.michael, dueDate: DAYS(5), createdAt: DAYS(-2) },
    { ticketNumber: 'TKT-003', subject: 'Feature request: Dark mode for reports', description: 'It would be great if the reports module supported dark mode. Currently the charts are hard to read in dark theme.', priority: 'low', status: 'pending', category: 'feature-request', contactName: 'Jennifer Wilson', contactEmail: 'j.wilson@pinnacle.co', assigneeId: null, dueDate: DAYS(30), createdAt: DAYS(-1) },
    { ticketNumber: 'TKT-004', subject: 'Login page crashes on Safari mobile', description: 'The login page shows a blank white screen on Safari for iOS 17. Reproducible on iPhone 15 Pro.', priority: 'urgent', status: 'in-progress', category: 'technical', contactName: 'Patricia Garcia', contactEmail: 'p.garcia@meridianhealth.com', assigneeId: userIds.john, dueDate: DAYS(1), createdAt: HOURS(-12) },
    { ticketNumber: 'TKT-005', subject: 'Need to add custom fields to contacts', description: 'We need to add custom fields like "Account Tier" and "Contract Renewal Date" to contact records.', priority: 'medium', status: 'open', category: 'feature-request', contactName: 'David Brown', contactEmail: 'd.brown@globaldyn.com', assigneeId: userIds.lisa, dueDate: DAYS(14), createdAt: HOURS(-6) },
    { ticketNumber: 'TKT-006', subject: 'Data export timeout for large datasets', description: 'When exporting more than 10,000 records, the export times out after 30 seconds.', priority: 'high', status: 'resolved', category: 'technical', contactName: 'James Miller', contactEmail: 'j.miller@orbitlog.com', assigneeId: userIds.john, dueDate: DAYS(-5), resolution: 'Implemented chunked export with streaming. Resolved in v2.4.1.', createdAt: DAYS(-10) },
  ];
  await db.supportTicket.createMany({ data: tickets.map((t, i) => ({ ...t, id: `ticket-${i+1}` })) });

  // ── Leave Requests ───────────────────────────────────────────────
  await db.leaveRequest.createMany({
    data: [
      { id: 'leave-1', requesterId: userIds.emily, type: 'vacation', startDate: DAYS(5), endDate: DAYS(9), status: 'pending', reason: 'Family vacation', createdAt: DAYS(-2) },
      { id: 'leave-2', requesterId: userIds.john, type: 'sick', startDate: DAYS(-3), endDate: DAYS(-2), status: 'approved', reason: 'Flu', approverId: userIds.alex, createdAt: DAYS(-5) },
      { id: 'leave-3', requesterId: userIds.sarah, type: 'personal', startDate: DAYS(15), endDate: DAYS(15), status: 'pending', reason: 'Doctor appointment', createdAt: DAYS(-1) },
      { id: 'leave-4', requesterId: userIds.lisa, type: 'vacation', startDate: DAYS(-10), endDate: DAYS(-5), status: 'approved', reason: 'Summer vacation', approverId: userIds.emily, createdAt: DAYS(-15) },
    ],
  });

  // ── Invoices ─────────────────────────────────────────────────────
  const invoices = [
    { invoiceNumber: 'INV-2026-001', contactName: 'Robert Williams', companyName: 'Acme Corp', status: 'paid', items: JSON.stringify([{description: 'Enterprise License', quantity: 1, unitPrice: 30000}, {description: 'Support Package', quantity: 1, unitPrice: 5000}]), subtotal: 35000, tax: 3500, total: 38500, dueDate: DAYS(-30), paidAt: DAYS(-25), ownerId: userIds.michael },
    { invoiceNumber: 'INV-2026-002', contactName: 'Amanda Taylor', companyName: 'TechStart Inc', status: 'sent', items: JSON.stringify([{description: 'Annual Subscription', quantity: 1, unitPrice: 24000}, {description: 'Onboarding Fee', quantity: 1, unitPrice: 4000}]), subtotal: 28000, tax: 2800, total: 30800, dueDate: DAYS(15), ownerId: userIds.michael },
    { invoiceNumber: 'INV-2026-003', contactName: 'James Miller', companyName: 'Orbit Logistics', status: 'paid', items: JSON.stringify([{description: 'Platform Deployment', quantity: 1, unitPrice: 45000}, {description: 'Training', quantity: 2, unitPrice: 5000}]), subtotal: 55000, tax: 5500, total: 60500, dueDate: DAYS(-15), paidAt: DAYS(-12), ownerId: userIds.michael },
    { invoiceNumber: 'INV-2026-004', contactName: 'Jennifer Wilson', companyName: 'Pinnacle Solutions', status: 'overdue', items: JSON.stringify([{description: 'Consulting Package', quantity: 1, unitPrice: 25000}]), subtotal: 25000, tax: 2500, total: 27500, dueDate: DAYS(-5), ownerId: userIds.michael },
    { invoiceNumber: 'INV-2026-005', contactName: 'Patricia Garcia', companyName: 'Meridian Health', status: 'draft', items: JSON.stringify([{description: 'Integration Services', quantity: 1, unitPrice: 65000}, {description: 'Data Migration', quantity: 1, unitPrice: 20000}]), subtotal: 85000, tax: 8500, total: 93500, dueDate: DAYS(45), ownerId: userIds.michael },
    { invoiceNumber: 'INV-2026-006', contactName: 'Rachel Clark', companyName: 'DataVault', status: 'sent', items: JSON.stringify([{description: 'Analytics Suite', quantity: 1, unitPrice: 52000}, {description: 'API Access', quantity: 1, unitPrice: 8000}]), subtotal: 60000, tax: 6000, total: 66000, dueDate: DAYS(25), ownerId: userIds.alex },
  ];
  await db.invoice.createMany({ data: invoices.map((inv, i) => ({ ...inv, id: `inv-${i+1}`, createdAt: DAYS(-60 + i * 10) })) });

  // ── Expenses ─────────────────────────────────────────────────────
  await db.expense.createMany({
    data: [
      { id: 'exp-1', title: 'AWS Cloud Services', amount: 4250, category: 'software', vendor: 'Amazon Web Services', date: DAYS(-1), status: 'approved', ownerId: userIds.michael },
      { id: 'exp-2', title: 'Office Rent - July', amount: 8500, category: 'office', vendor: 'Skyline Properties', date: DAYS(-3), status: 'approved', ownerId: userIds.michael },
      { id: 'exp-3', title: 'Team Lunch - Sprint Review', amount: 185, category: 'office', vendor: 'The Capital Grille', date: DAYS(-5), status: 'pending', ownerId: userIds.alex },
      { id: 'exp-4', title: 'Google Ads Campaign', amount: 3200, category: 'marketing', vendor: 'Google', date: DAYS(-7), status: 'approved', ownerId: userIds.sarah },
      { id: 'exp-5', title: 'Flight to NYC - Client Meeting', amount: 650, category: 'travel', vendor: 'Delta Airlines', date: DAYS(-10), status: 'approved', ownerId: userIds.sarah },
      { id: 'exp-6', title: 'Figma Enterprise License', amount: 1440, category: 'software', vendor: 'Figma', date: DAYS(-15), status: 'approved', ownerId: userIds.john },
      { id: 'exp-7', title: 'Conference Tickets - SaaStr', amount: 2400, category: 'travel', vendor: 'SaaStr Annual', date: DAYS(-20), status: 'pending', ownerId: userIds.alex },
    ],
  });

  // ── Products ─────────────────────────────────────────────────────
  await db.product.createMany({
    data: [
      { id: 'prod-1', name: 'Enterprise License', sku: 'LIC-ENT-001', category: 'License', price: 30000, cost: 5000, stock: 999, unit: 'license', reorderLevel: 50 },
      { id: 'prod-2', name: 'Professional License', sku: 'LIC-PRO-002', category: 'License', price: 12000, cost: 2000, stock: 999, unit: 'license', reorderLevel: 50 },
      { id: 'prod-3', name: 'Starter License', sku: 'LIC-STR-003', category: 'License', price: 3600, cost: 600, stock: 999, unit: 'license', reorderLevel: 50 },
      { id: 'prod-4', name: 'Support Package - Premium', sku: 'SUP-PRM-001', category: 'Support', price: 6000, cost: 1500, stock: 999, unit: 'year', reorderLevel: 20 },
      { id: 'prod-5', name: 'Support Package - Standard', sku: 'SUP-STD-002', category: 'Support', price: 2400, cost: 800, stock: 999, unit: 'year', reorderLevel: 20 },
      { id: 'prod-6', name: 'Onboarding Service', sku: 'SRV-ONB-001', category: 'Service', price: 5000, cost: 2000, stock: 50, unit: 'session', reorderLevel: 10 },
      { id: 'prod-7', name: 'Custom Integration', sku: 'SRV-INT-002', category: 'Service', price: 15000, cost: 6000, stock: 20, unit: 'project', reorderLevel: 5 },
      { id: 'prod-8', name: 'Training Workshop', sku: 'SRV-TRN-003', category: 'Service', price: 3000, cost: 1000, stock: 100, unit: 'session', reorderLevel: 15 },
    ],
  });

  // ── Warehouses ───────────────────────────────────────────────────
  await db.warehouse.createMany({
    data: [
      { id: 'wh-1', name: 'US East Warehouse', location: 'Atlanta, GA', capacity: 5000 },
      { id: 'wh-2', name: 'US West Warehouse', location: 'Los Angeles, CA', capacity: 3000 },
      { id: 'wh-3', name: 'EU Warehouse', location: 'London, UK', capacity: 2000 },
    ],
  });

  // ── Calendar Events ──────────────────────────────────────────────
  await db.calendarEvent.createMany({
    data: [
      { id: 'evt-1', title: 'Sprint Planning', description: 'Q3 Sprint 4 planning session', startDate: DAYS(0).setHours(10, 0, 0, 0) ? new Date(DAYS(0).setHours(10, 0, 0, 0)) : DAYS(0), endDate: DAYS(0).setHours(11, 30, 0, 0) ? new Date(DAYS(0).setHours(11, 30, 0, 0)) : DAYS(0), allDay: false, location: 'Conference Room A', color: '#10b981', creatorId: userIds.alex },
      { id: 'evt-2', title: 'Client Demo - Acme Corp', description: 'Product demo for Acme Corp enterprise deal', startDate: new Date(DAYS(1).setHours(14, 0, 0, 0)), endDate: new Date(DAYS(1).setHours(15, 0, 0, 0)), allDay: false, location: 'Zoom Meeting', color: '#f59e0b', creatorId: userIds.sarah },
      { id: 'evt-3', title: 'Team All-Hands', description: 'Monthly company-wide all-hands meeting', startDate: new Date(DAYS(2).setHours(15, 0, 0, 0)), endDate: new Date(DAYS(2).setHours(16, 0, 0, 0)), allDay: false, location: 'Main Auditorium', color: '#8b5cf6', creatorId: userIds.alex },
      { id: 'evt-4', title: 'Design Review', description: 'Review new dashboard designs', startDate: new Date(DAYS(3).setHours(11, 0, 0, 0)), endDate: new Date(DAYS(3).setHours(12, 0, 0, 0)), allDay: false, location: 'Design Lab', color: '#06b6d4', creatorId: userIds.john },
      { id: 'evt-5', title: 'Quarterly Business Review', description: 'Q2 business review with leadership', startDate: new Date(DAYS(5).setHours(9, 0, 0, 0)), endDate: new Date(DAYS(5).setHours(12, 0, 0, 0)), allDay: false, location: 'Executive Suite', color: '#f43f5e', creatorId: userIds.alex },
      { id: 'evt-6', title: 'Company Offsite', description: 'Annual company retreat', startDate: DAYS(14), endDate: DAYS(16), allDay: true, location: 'Lake Tahoe Resort', color: '#10b981', creatorId: userIds.emily },
    ],
  });

  // ── Notifications ────────────────────────────────────────────────
  await db.notification.createMany({
    data: [
      { id: 'notif-1', userId: userIds.alex, type: 'info', title: 'New lead assigned', message: 'Sarah assigned lead "Chris Anderson - NexaTech" to you', link: 'crm', isRead: false },
      { id: 'notif-2', userId: userIds.alex, type: 'warning', title: 'Invoice overdue', message: 'Invoice INV-2026-004 for Pinnacle Solutions is 5 days overdue', link: 'finance', isRead: false },
      { id: 'notif-3', userId: userIds.alex, type: 'success', title: 'Deal closed won', message: 'Orbit Logistics deployment deal ($65,000) has been closed', link: 'crm', isRead: false },
      { id: 'notif-4', userId: userIds.john, type: 'info', title: 'New support ticket', message: 'Ticket TKT-004 (urgent) assigned to you: Login page crashes on Safari mobile', link: 'support', isRead: false },
      { id: 'notif-5', userId: userIds.alex, type: 'info', title: 'Leave request', message: 'Emily Martinez requested vacation (Jul 26 - Jul 30)', link: 'hr', isRead: true },
      { id: 'notif-6', userId: userIds.michael, type: 'success', title: 'Payment received', message: 'Payment of $38,500 received from Acme Corp', link: 'finance', isRead: true },
    ],
  });

  // ── Activity Log ─────────────────────────────────────────────────
  await db.activityLog.createMany({
    data: [
      { id: 'act-1', userId: userIds.sarah, module: 'crm', action: 'update', title: 'Deal stage updated', description: 'Moved "TechStart Annual Contract" to negotiation stage' },
      { id: 'act-2', userId: userIds.john, module: 'projects', action: 'create', title: 'Task completed', description: 'Completed "Evaluate gateway options" in API Gateway Migration' },
      { id: 'act-3', userId: userIds.michael, module: 'finance', action: 'create', title: 'Invoice created', description: 'Created invoice INV-2026-006 for DataVault ($66,000)' },
      { id: 'act-4', userId: userIds.lisa, module: 'support', action: 'update', title: 'Ticket resolved', description: 'Resolved TKT-006: Data export timeout for large datasets' },
      { id: 'act-5', userId: userIds.emily, module: 'hr', action: 'update', title: 'Leave approved', description: 'Approved Lisa Thompson\'s vacation request (Jul 11 - Jul 16)' },
    ],
  });

  // ── Settings ─────────────────────────────────────────────────────
  await db.setting.createMany({
    data: [
      { id: 'set-1', key: 'company_name', value: 'NexusCorp', type: 'string', group: 'general' },
      { id: 'set-2', key: 'company_industry', value: 'Technology', type: 'string', group: 'general' },
      { id: 'set-3', key: 'company_website', value: 'nexuscorp.com', type: 'string', group: 'general' },
      { id: 'set-4', key: 'company_email', value: 'info@nexuscorp.com', type: 'string', group: 'general' },
      { id: 'set-5', key: 'company_phone', value: '+1 555-1000', type: 'string', group: 'general' },
      { id: 'set-6', key: 'company_address', value: '100 Innovation Drive, San Francisco, CA 94107', type: 'string', group: 'general' },
      { id: 'set-7', key: 'default_currency', value: 'USD', type: 'string', group: 'finance' },
      { id: 'set-8', key: 'tax_rate', value: '10', type: 'number', group: 'finance' },
      { id: 'set-9', key: 'invoice_prefix', value: 'INV-', type: 'string', group: 'finance' },
      { id: 'set-10', key: 'fiscal_year_start', value: 'January', type: 'string', group: 'finance' },
    ],
  });

  console.log('Database seeded successfully!');
}

seed()
  .catch(console.error)
  .finally(() => process.exit(0));