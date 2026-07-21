---
Task ID: 6
Agent: Main (Lead Architect)
Task: Create Supabase client utilities (client, server, middleware, types)

Work Log:
- Created /home/z/my-project/src/lib/supabase/client.ts (browser-side Supabase client)
- Created /home/z/my-project/src/lib/supabase/server.ts (server-side Supabase client with cookie-based auth)
- Created /home/z/my-project/src/lib/supabase/middleware.ts (auth middleware for API routes and page routes)
- Created /home/z/my-project/src/lib/supabase/types.ts (complete TypeScript interfaces for all 22 entities + enums + invitation type)
- Added NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_APP_URL to .env
- Types file covers: Organization, OrganizationMember, UserProfile, Role, Setting, Lead, Contact, Company, Deal, Project, ProjectTask, Invoice, InvoiceItem, Expense, LeaveRequest, Product, Warehouse, Channel, Message, SupportTicket, CalendarEvent, WorkspacePage, Notification, AuditLog, ActivityLog, Invitation

Stage Summary:
- Complete Supabase client infrastructure ready for integration
- Auth middleware supports both API (401 JSON) and page (redirect) protection
- Server client handles cookie-based session management
- Types provide full type safety for all entities
- NEXT_PUBLIC_APP_URL set for Caddy/proxy