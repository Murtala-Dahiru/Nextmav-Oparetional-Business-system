-- ============================================================
-- NexusCorp Business OS - Initial Schema Migration
-- Supabase (PostgreSQL) Production Migration
-- ============================================================

BEGIN;

-- ============================================================
-- EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM (
  'super_admin', 'owner', 'admin', 'manager', 'sales',
  'hr', 'finance', 'marketing', 'support', 'employee', 'client', 'vendor'
);

CREATE TYPE lead_status AS ENUM (
  'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'
);

CREATE TYPE deal_stage AS ENUM (
  'lead', 'qualified', 'proposal', 'negotiation', 'contract', 'won', 'lost'
);

CREATE TYPE project_status AS ENUM (
  'not_started', 'in_progress', 'on_hold', 'completed', 'cancelled'
);

CREATE TYPE task_status AS ENUM (
  'todo', 'in_progress', 'in_review', 'done', 'cancelled'
);

CREATE TYPE priority AS ENUM (
  'low', 'medium', 'high', 'urgent'
);

CREATE TYPE invoice_status AS ENUM (
  'draft', 'sent', 'paid', 'overdue', 'cancelled', 'refunded'
);

CREATE TYPE expense_category AS ENUM (
  'travel', 'meals', 'office', 'software', 'marketing', 'equipment', 'training', 'other'
);

CREATE TYPE expense_status AS ENUM (
  'pending', 'approved', 'rejected', 'cancelled'
);

CREATE TYPE leave_type AS ENUM (
  'vacation', 'sick', 'personal', 'maternity', 'paternity', 'bereavement', 'unpaid'
);

CREATE TYPE leave_status AS ENUM (
  'pending', 'approved', 'rejected', 'cancelled'
);

CREATE TYPE ticket_priority AS ENUM (
  'low', 'medium', 'high', 'critical'
);

CREATE TYPE ticket_status AS ENUM (
  'open', 'in_progress', 'pending', 'resolved', 'closed'
);

CREATE TYPE channel_type AS ENUM (
  'public', 'private', 'direct'
);

-- ============================================================
-- TABLES
-- ============================================================

-- -----------------------------------------------------------
-- Organizations
-- -----------------------------------------------------------
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo_url text,
  industry text,
  website text,
  email text,
  phone text,
  address text,
  city text,
  country text,
  currency text NOT NULL DEFAULT 'USD',
  tax_rate numeric(5, 2) NOT NULL DEFAULT 0,
  invoice_prefix text NOT NULL DEFAULT 'INV',
  fiscal_year_start text NOT NULL DEFAULT '01-01',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- Profiles (extends auth.users)
-- -----------------------------------------------------------
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  first_name text,
  last_name text,
  email text,
  phone text,
  avatar_url text,
  job_title text,
  department text,
  employee_id text,
  hire_date date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- Organization Members
-- -----------------------------------------------------------
CREATE TABLE organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'employee',
  is_active boolean NOT NULL DEFAULT true,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

-- -----------------------------------------------------------
-- Roles
-- -----------------------------------------------------------
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  permissions jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- Settings
-- -----------------------------------------------------------
CREATE TABLE settings (
  key text NOT NULL,
  value text,
  type text NOT NULL DEFAULT 'string',
  "group" text NOT NULL DEFAULT 'general',
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (key, organization_id)
);

-- -----------------------------------------------------------
-- Leads
-- -----------------------------------------------------------
CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  first_name text,
  last_name text,
  email text,
  phone text,
  company text,
  source text NOT NULL DEFAULT 'manual',
  status lead_status NOT NULL DEFAULT 'new',
  score integer NOT NULL DEFAULT 0,
  value numeric(15, 2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- -----------------------------------------------------------
-- Contacts
-- -----------------------------------------------------------
CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name text,
  last_name text,
  email text,
  phone text,
  job_title text,
  company text,
  source text,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- -----------------------------------------------------------
-- Companies
-- -----------------------------------------------------------
CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  industry text,
  website text,
  email text,
  phone text,
  city text,
  country text,
  employee_count integer,
  annual_revenue numeric(15, 2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- -----------------------------------------------------------
-- Deals
-- -----------------------------------------------------------
CREATE TABLE deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  name text NOT NULL,
  contact_name text,
  company_name text,
  stage deal_stage NOT NULL DEFAULT 'lead',
  probability integer NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  value numeric(15, 2) NOT NULL DEFAULT 0,
  close_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- -----------------------------------------------------------
-- Projects
-- -----------------------------------------------------------
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  status project_status NOT NULL DEFAULT 'not_started',
  priority priority NOT NULL DEFAULT 'medium',
  budget numeric(15, 2),
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- -----------------------------------------------------------
-- Project Tasks
-- -----------------------------------------------------------
CREATE TABLE project_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assignee_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  status task_status NOT NULL DEFAULT 'todo',
  priority priority NOT NULL DEFAULT 'medium',
  due_date date,
  estimated_hours numeric(6, 2),
  logged_hours numeric(6, 2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- -----------------------------------------------------------
-- Invoices
-- -----------------------------------------------------------
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  invoice_number text NOT NULL UNIQUE,
  contact_name text,
  company_name text,
  status invoice_status NOT NULL DEFAULT 'draft',
  items jsonb,
  subtotal numeric(15, 2) NOT NULL DEFAULT 0,
  tax numeric(15, 2) NOT NULL DEFAULT 0,
  total numeric(15, 2) NOT NULL DEFAULT 0,
  due_date date,
  paid_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- -----------------------------------------------------------
-- Expenses
-- -----------------------------------------------------------
CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  amount numeric(15, 2) NOT NULL DEFAULT 0,
  category expense_category NOT NULL DEFAULT 'other',
  vendor text,
  date date NOT NULL DEFAULT now(),
  status expense_status NOT NULL DEFAULT 'pending',
  receipt_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- -----------------------------------------------------------
-- Leave Requests
-- -----------------------------------------------------------
CREATE TABLE leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type leave_type NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  status leave_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- Warehouses
-- -----------------------------------------------------------
CREATE TABLE warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  location text,
  capacity integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- -----------------------------------------------------------
-- Products
-- -----------------------------------------------------------
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  category text,
  price numeric(15, 2) NOT NULL DEFAULT 0,
  cost numeric(15, 2) NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'unit',
  reorder_level integer NOT NULL DEFAULT 10,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- -----------------------------------------------------------
-- Channels
-- -----------------------------------------------------------
CREATE TABLE channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  type channel_type NOT NULL DEFAULT 'public',
  description text,
  creator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- -----------------------------------------------------------
-- Channel Members
-- -----------------------------------------------------------
CREATE TABLE channel_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel_id, user_id)
);

-- -----------------------------------------------------------
-- Messages
-- -----------------------------------------------------------
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text,
  is_pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- Support Tickets
-- -----------------------------------------------------------
CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_number text NOT NULL UNIQUE,
  subject text NOT NULL,
  description text,
  priority ticket_priority NOT NULL DEFAULT 'medium',
  status ticket_status NOT NULL DEFAULT 'open',
  category text,
  contact_name text,
  contact_email text,
  assignee_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  due_date date,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- -----------------------------------------------------------
-- Calendar Events
-- -----------------------------------------------------------
CREATE TABLE calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  creator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  location text,
  color text NOT NULL DEFAULT '#10b981',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- -----------------------------------------------------------
-- Workspace Pages
-- -----------------------------------------------------------
CREATE TABLE workspace_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES workspace_pages(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Untitled',
  content text,
  icon text NOT NULL DEFAULT E'\U0001F4C4',
  color text,
  is_folder boolean NOT NULL DEFAULT false,
  is_starred boolean NOT NULL DEFAULT false,
  last_edited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- -----------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text,
  type text NOT NULL DEFAULT 'info',
  link text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- Audit Log
-- -----------------------------------------------------------
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  module text NOT NULL,
  entity_id uuid,
  entity_name text,
  details jsonb,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- Activity Log
-- -----------------------------------------------------------
CREATE TABLE activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  module text,
  entity_id uuid,
  link text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- Invitations
-- -----------------------------------------------------------
CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role user_role NOT NULL DEFAULT 'employee',
  token text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Organizations
CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_created_at ON organizations(created_at DESC);

-- Profiles
CREATE INDEX idx_profiles_organization_id ON profiles(organization_id);
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_profiles_is_active ON profiles(is_active) WHERE is_active = true;

-- Organization Members
CREATE INDEX idx_org_members_user_id ON organization_members(user_id);
CREATE INDEX idx_org_members_organization_id ON organization_members(organization_id);
CREATE INDEX idx_org_members_role ON organization_members(role);
CREATE INDEX idx_org_members_is_active ON organization_members(is_active) WHERE is_active = true;

-- Roles
CREATE INDEX idx_roles_organization_id ON roles(organization_id);
CREATE INDEX idx_roles_name ON roles(organization_id, name);

-- Settings
CREATE INDEX idx_settings_organization_id ON settings(organization_id);
CREATE INDEX idx_settings_group ON settings(organization_id, "group");

-- Leads
CREATE INDEX idx_leads_organization_id ON leads(organization_id);
CREATE INDEX idx_leads_owner_id ON leads(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX idx_leads_status ON leads(organization_id, status);
CREATE INDEX idx_leads_created_at ON leads(organization_id, created_at DESC);
CREATE INDEX idx_leads_email ON leads(email) WHERE email IS NOT NULL;
CREATE INDEX idx_leads_deleted_at ON leads(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_score ON leads(organization_id, score DESC);

-- Contacts
CREATE INDEX idx_contacts_organization_id ON contacts(organization_id);
CREATE INDEX idx_contacts_email ON contacts(email) WHERE email IS NOT NULL;
CREATE INDEX idx_contacts_is_active ON contacts(organization_id, is_active) WHERE is_active = true;
CREATE INDEX idx_contacts_created_at ON contacts(organization_id, created_at DESC);
CREATE INDEX idx_contacts_deleted_at ON contacts(deleted_at) WHERE deleted_at IS NULL;

-- Companies
CREATE INDEX idx_companies_organization_id ON companies(organization_id);
CREATE INDEX idx_companies_name ON companies(organization_id, name);
CREATE INDEX idx_companies_industry ON companies(organization_id, industry) WHERE industry IS NOT NULL;
CREATE INDEX idx_companies_deleted_at ON companies(deleted_at) WHERE deleted_at IS NULL;

-- Deals
CREATE INDEX idx_deals_organization_id ON deals(organization_id);
CREATE INDEX idx_deals_owner_id ON deals(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX idx_deals_stage ON deals(organization_id, stage);
CREATE INDEX idx_deals_close_date ON deals(organization_id, close_date) WHERE close_date IS NOT NULL;
CREATE INDEX idx_deals_value ON deals(organization_id, value DESC);
CREATE INDEX idx_deals_created_at ON deals(organization_id, created_at DESC);
CREATE INDEX idx_deals_deleted_at ON deals(deleted_at) WHERE deleted_at IS NULL;

-- Projects
CREATE INDEX idx_projects_organization_id ON projects(organization_id);
CREATE INDEX idx_projects_owner_id ON projects(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX idx_projects_status ON projects(organization_id, status);
CREATE INDEX idx_projects_priority ON projects(organization_id, priority);
CREATE INDEX idx_projects_start_date ON projects(organization_id, start_date) WHERE start_date IS NOT NULL;
CREATE INDEX idx_projects_deleted_at ON projects(deleted_at) WHERE deleted_at IS NULL;

-- Project Tasks
CREATE INDEX idx_project_tasks_organization_id ON project_tasks(organization_id);
CREATE INDEX idx_project_tasks_project_id ON project_tasks(project_id);
CREATE INDEX idx_project_tasks_assignee_id ON project_tasks(assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX idx_project_tasks_status ON project_tasks(organization_id, status);
CREATE INDEX idx_project_tasks_due_date ON project_tasks(organization_id, due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_project_tasks_sort_order ON project_tasks(project_id, sort_order);
CREATE INDEX idx_project_tasks_deleted_at ON project_tasks(deleted_at) WHERE deleted_at IS NULL;

-- Invoices
CREATE INDEX idx_invoices_organization_id ON invoices(organization_id);
CREATE INDEX idx_invoices_owner_id ON invoices(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX idx_invoices_status ON invoices(organization_id, status);
CREATE INDEX idx_invoices_due_date ON invoices(organization_id, due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_invoices_created_at ON invoices(organization_id, created_at DESC);
CREATE INDEX idx_invoices_deleted_at ON invoices(deleted_at) WHERE deleted_at IS NULL;

-- Expenses
CREATE INDEX idx_expenses_organization_id ON expenses(organization_id);
CREATE INDEX idx_expenses_owner_id ON expenses(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX idx_expenses_category ON expenses(organization_id, category);
CREATE INDEX idx_expenses_status ON expenses(organization_id, status);
CREATE INDEX idx_expenses_date ON expenses(organization_id, date DESC);
CREATE INDEX idx_expenses_deleted_at ON expenses(deleted_at) WHERE deleted_at IS NULL;

-- Leave Requests
CREATE INDEX idx_leave_requests_organization_id ON leave_requests(organization_id);
CREATE INDEX idx_leave_requests_requester_id ON leave_requests(requester_id);
CREATE INDEX idx_leave_requests_status ON leave_requests(organization_id, status);
CREATE INDEX idx_leave_requests_type ON leave_requests(organization_id, type);
CREATE INDEX idx_leave_requests_start_date ON leave_requests(organization_id, start_date);

-- Warehouses
CREATE INDEX idx_warehouses_organization_id ON warehouses(organization_id);
CREATE INDEX idx_warehouses_is_active ON warehouses(organization_id, is_active) WHERE is_active = true;
CREATE INDEX idx_warehouses_deleted_at ON warehouses(deleted_at) WHERE deleted_at IS NULL;

-- Products
CREATE INDEX idx_products_organization_id ON products(organization_id);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_category ON products(organization_id, category) WHERE category IS NOT NULL;
CREATE INDEX idx_products_warehouse_id ON products(warehouse_id) WHERE warehouse_id IS NOT NULL;
CREATE INDEX idx_products_is_active ON products(organization_id, is_active) WHERE is_active = true;
CREATE INDEX idx_products_deleted_at ON products(deleted_at) WHERE deleted_at IS NULL;

-- Channels
CREATE INDEX idx_channels_organization_id ON channels(organization_id);
CREATE INDEX idx_channels_type ON channels(organization_id, type);
CREATE INDEX idx_channels_creator_id ON channels(creator_id) WHERE creator_id IS NOT NULL;
CREATE INDEX idx_channels_deleted_at ON channels(deleted_at) WHERE deleted_at IS NULL;

-- Channel Members
CREATE INDEX idx_channel_members_channel_id ON channel_members(channel_id);
CREATE INDEX idx_channel_members_user_id ON channel_members(user_id);

-- Messages
CREATE INDEX idx_messages_organization_id ON messages(organization_id);
CREATE INDEX idx_messages_channel_id ON messages(channel_id);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_created_at ON messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_is_pinned ON messages(channel_id, is_pinned) WHERE is_pinned = true;

-- Support Tickets
CREATE INDEX idx_tickets_organization_id ON support_tickets(organization_id);
CREATE INDEX idx_tickets_ticket_number ON support_tickets(ticket_number);
CREATE INDEX idx_tickets_assignee_id ON support_tickets(assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX idx_tickets_status ON support_tickets(organization_id, status);
CREATE INDEX idx_tickets_priority ON support_tickets(organization_id, priority);
CREATE INDEX idx_tickets_created_at ON support_tickets(organization_id, created_at DESC);
CREATE INDEX idx_tickets_due_date ON support_tickets(organization_id, due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_tickets_deleted_at ON support_tickets(deleted_at) WHERE deleted_at IS NULL;

-- Calendar Events
CREATE INDEX idx_calendar_events_organization_id ON calendar_events(organization_id);
CREATE INDEX idx_calendar_events_creator_id ON calendar_events(creator_id) WHERE creator_id IS NOT NULL;
CREATE INDEX idx_calendar_events_start_date ON calendar_events(organization_id, start_date);
CREATE INDEX idx_calendar_events_end_date ON calendar_events(organization_id, end_date);
CREATE INDEX idx_calendar_events_deleted_at ON calendar_events(deleted_at) WHERE deleted_at IS NULL;

-- Workspace Pages
CREATE INDEX idx_workspace_pages_organization_id ON workspace_pages(organization_id);
CREATE INDEX idx_workspace_pages_parent_id ON workspace_pages(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_workspace_pages_is_folder ON workspace_pages(organization_id, is_folder);
CREATE INDEX idx_workspace_pages_is_starred ON workspace_pages(organization_id, is_starred) WHERE is_starred = true;
CREATE INDEX idx_workspace_pages_deleted_at ON workspace_pages(deleted_at) WHERE deleted_at IS NULL;

-- Notifications
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_created_at ON notifications(user_id, created_at DESC);

-- Audit Log
CREATE INDEX idx_audit_log_organization_id ON audit_log(organization_id);
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_audit_log_action ON audit_log(organization_id, action);
CREATE INDEX idx_audit_log_module ON audit_log(organization_id, module);
CREATE INDEX idx_audit_log_entity ON audit_log(organization_id, entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX idx_audit_log_created_at ON audit_log(organization_id, created_at DESC);

-- Activity Log
CREATE INDEX idx_activity_log_organization_id ON activity_log(organization_id);
CREATE INDEX idx_activity_log_user_id ON activity_log(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_activity_log_module ON activity_log(organization_id, module);
CREATE INDEX idx_activity_log_created_at ON activity_log(organization_id, created_at DESC);

-- Invitations
CREATE INDEX idx_invitations_organization_id ON invitations(organization_id);
CREATE INDEX idx_invitations_email ON invitations(email);
CREATE INDEX idx_invitations_token ON invitations(token);
CREATE INDEX idx_invitations_accepted_at ON invitations(accepted_at) WHERE accepted_at IS NULL;

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- -----------------------------------------------------------
-- update_updated_at() - auto-set updated_at on row change
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------
-- auto_audit_log() - log INSERT/UPDATE/DELETE to audit_log
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_audit_log()
RETURNS TRIGGER AS $$
DECLARE
  v_organization_id uuid;
  v_module text;
  v_entity_id uuid;
  v_entity_name text;
  v_action text;
  v_details jsonb;
  v_ip_address inet;
BEGIN
  v_action := lower(TG_OP);

  IF v_action = 'delete' THEN
    v_organization_id := OLD.organization_id;
    v_entity_id := OLD.id;
    v_entity_name := COALESCE(
      OLD.name,
      OLD.title,
      OLD.subject,
      OLD.invoice_number,
      OLD.ticket_number,
      OLD.sku,
      OLD.first_name || ' ' || OLD.last_name,
      NULL
    );
    v_details := to_jsonb(OLD);
  ELSE
    v_organization_id := NEW.organization_id;
    v_entity_id := NEW.id;
    v_entity_name := COALESCE(
      NEW.name,
      NEW.title,
      NEW.subject,
      NEW.invoice_number,
      NEW.ticket_number,
      NEW.sku,
      NEW.first_name || ' ' || NEW.last_name,
      NULL
    );
    v_details := to_jsonb(NEW);
  END IF;

  v_module := TG_TABLE_NAME;

  BEGIN
    SELECT inet_client_addr() INTO v_ip_address;
  EXCEPTION WHEN OTHERS THEN
    v_ip_address := NULL;
  END;

  INSERT INTO audit_log (organization_id, user_id, action, module, entity_id, entity_name, details, ip_address)
  VALUES (
    v_organization_id,
    COALESCE(current_setting('request.jwt.claims.sub', true)::uuid, NULL),
    v_action,
    v_module,
    v_entity_id,
    v_entity_name,
    v_details,
    v_ip_address
  );

  IF v_action = 'delete' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------
-- handle_new_user() - auto-create org/profile for new auth.users
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_organization_id uuid;
  v_invitation_record RECORD;
  v_slug text;
BEGIN
  -- Check if there is a pending invitation for this email
  SELECT * INTO v_invitation_record
  FROM invitations
  WHERE email = NEW.email
    AND accepted_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_invitation_record IS NOT NULL THEN
    -- User was invited: join the inviting organization
    v_organization_id := v_invitation_record.organization_id;

    INSERT INTO organization_members (user_id, organization_id, role, is_active, invited_by, invited_at, joined_at)
    VALUES (
      NEW.id,
      v_invitation_record.organization_id,
      v_invitation_record.role,
      true,
      v_invitation_record.invited_by,
      v_invitation_record.created_at,
      now()
    );

    -- Mark invitation as accepted
    UPDATE invitations SET accepted_at = now() WHERE id = v_invitation_record.id;

    -- Create profile
    INSERT INTO profiles (id, organization_id, first_name, last_name, email)
    VALUES (
      NEW.id,
      v_invitation_record.organization_id,
      COALESCE(NEW.raw_user_meta_data->>'first_name', split_part(NEW.email, '@', 1)),
      COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
      NEW.email
    );

  ELSE
    -- No invitation: create a new organization for this user
    v_slug := lower(regexp_replace(
      COALESCE(NEW.raw_user_meta_data->>'company', split_part(NEW.email, '@', 1)),
      '[^a-z0-9]+', '-', 'gi'
    ));
    v_slug := regexp_replace(v_slug, '(^-|-$)', '', 'g');

    -- Ensure slug uniqueness
    WHILE EXISTS (SELECT 1 FROM organizations WHERE slug = v_slug) LOOP
      v_slug := v_slug || '-' || floor(random() * 1000)::int;
    END LOOP;

    INSERT INTO organizations (name, slug, email, currency)
    VALUES (
      COALESCE(
        NEW.raw_user_meta_data->>'company',
        split_part(NEW.email, '@', 1) || ' Organization'
      ),
      v_slug,
      NEW.email,
      'USD'
    )
    RETURNING id INTO v_organization_id;

    -- Add user as owner
    INSERT INTO organization_members (user_id, organization_id, role, is_active, joined_at)
    VALUES (NEW.id, v_organization_id, 'owner', true, now());

    -- Create profile
    INSERT INTO profiles (id, organization_id, first_name, last_name, email)
    VALUES (
      NEW.id,
      v_organization_id,
      COALESCE(NEW.raw_user_meta_data->>'first_name', split_part(NEW.email, '@', 1)),
      COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
      NEW.email
    );

    -- Create default roles
    INSERT INTO roles (organization_id, name, description, is_system, permissions) VALUES
      (v_organization_id, 'Admin', 'Full administrative access', true, '{"admin": true, "all": true}'::jsonb),
      (v_organization_id, 'Manager', 'Manager access with team management', true, '{"manage": true}'::jsonb),
      (v_organization_id, 'Employee', 'Standard employee access', true, '{"read": true}'::jsonb);

    -- Create default settings
    INSERT INTO settings (key, value, type, "group", organization_id) VALUES
      ('timezone', 'UTC', 'string', 'general', v_organization_id),
      ('date_format', 'YYYY-MM-DD', 'string', 'general', v_organization_id),
      ('currency_symbol', '$', 'string', 'finance', v_organization_id),
      ('email_notifications', 'true', 'boolean', 'notifications', v_organization_id);

    -- Create default channels
    INSERT INTO channels (organization_id, name, type, description, creator_id, is_active)
    VALUES
      (v_organization_id, 'General', 'public', 'General discussion for the entire team', NEW.id, true),
      (v_organization_id, 'Announcements', 'public', 'Company-wide announcements', NEW.id, true);

    -- Auto-join default channels
    INSERT INTO channel_members (channel_id, user_id)
    SELECT ch.id, NEW.id
    FROM channels ch
    WHERE ch.organization_id = v_organization_id
      AND ch.type = 'public';

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------
-- notify_on_ticket_assignee_change()
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_on_ticket_assignee_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    IF NEW.assignee_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, message, type, link)
      VALUES (
        NEW.assignee_id,
        'Ticket Assigned to You',
        'You have been assigned to ticket #' || NEW.ticket_number || ': ' || NEW.subject,
        'ticket',
        '/support/tickets/' || NEW.id
      );
    END IF;

    IF OLD.assignee_id IS NOT NULL AND OLD.assignee_id IS DISTINCT FROM NEW.assignee_id THEN
      INSERT INTO notifications (user_id, title, message, type, link)
      VALUES (
        OLD.assignee_id,
        'Ticket Unassigned',
        'You have been unassigned from ticket #' || NEW.ticket_number || ': ' || NEW.subject,
        'ticket',
        '/support/tickets/' || NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------
-- notify_on_message() - notify channel members on new message
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_on_message()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO notifications (user_id, title, message, type, link)
  SELECT
    cm.user_id,
    'New message in #' || ch.name,
    CASE
      WHEN length(NEW.content) > 100 THEN substring(NEW.content from 1 for 100) || '...'
      ELSE NEW.content
    END,
    'message',
    '/communication/channels/' || NEW.channel_id
  FROM channel_members cm
  JOIN channels ch ON ch.id = cm.channel_id
  WHERE cm.channel_id = NEW.channel_id
    AND cm.user_id != NEW.sender_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Handle new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON organization_members FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON project_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON warehouses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON channels FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON calendar_events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON workspace_pages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Audit log triggers
CREATE TRIGGER audit_leads AFTER INSERT OR UPDATE OR DELETE ON leads FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();
CREATE TRIGGER audit_contacts AFTER INSERT OR UPDATE OR DELETE ON contacts FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();
CREATE TRIGGER audit_companies AFTER INSERT OR UPDATE OR DELETE ON companies FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();
CREATE TRIGGER audit_deals AFTER INSERT OR UPDATE OR DELETE ON deals FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();
CREATE TRIGGER audit_projects AFTER INSERT OR UPDATE OR DELETE ON projects FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();
CREATE TRIGGER audit_project_tasks AFTER INSERT OR UPDATE OR DELETE ON project_tasks FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();
CREATE TRIGGER audit_invoices AFTER INSERT OR UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();
CREATE TRIGGER audit_expenses AFTER INSERT OR UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();
CREATE TRIGGER audit_leave_requests AFTER INSERT OR UPDATE OR DELETE ON leave_requests FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();
CREATE TRIGGER audit_products AFTER INSERT OR UPDATE OR DELETE ON products FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();
CREATE TRIGGER audit_warehouses AFTER INSERT OR UPDATE OR DELETE ON warehouses FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();
CREATE TRIGGER audit_support_tickets AFTER INSERT OR UPDATE OR DELETE ON support_tickets FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();
CREATE TRIGGER audit_calendar_events AFTER INSERT OR UPDATE OR DELETE ON calendar_events FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();
CREATE TRIGGER audit_workspace_pages AFTER INSERT OR UPDATE OR DELETE ON workspace_pages FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();
CREATE TRIGGER audit_roles AFTER INSERT OR UPDATE OR DELETE ON roles FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();
CREATE TRIGGER audit_settings AFTER INSERT OR UPDATE OR DELETE ON settings FOR EACH ROW EXECUTE FUNCTION public.auto_audit_log();

-- Ticket assignment notification
CREATE TRIGGER on_ticket_assignee_change
  AFTER UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_ticket_assignee_change();

-- Message notification
CREATE TRIGGER on_new_message
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_message();

-- ============================================================
-- VIEWS
-- ============================================================

-- -----------------------------------------------------------
-- dashboard_stats
-- -----------------------------------------------------------
CREATE OR REPLACE VIEW public.dashboard_stats AS
SELECT
  om.organization_id,
  COALESCE(SUM(
    CASE
      WHEN i.status IN ('paid', 'sent')
        AND EXTRACT(MONTH FROM i.created_at) = EXTRACT(MONTH FROM now())
        AND EXTRACT(YEAR FROM i.created_at) = EXTRACT(YEAR FROM now())
      THEN i.total ELSE 0
    END
  ), 0) AS revenue_this_month,
  COALESCE(SUM(
    CASE
      WHEN i.status IN ('paid', 'sent')
        AND EXTRACT(MONTH FROM i.created_at) = EXTRACT(MONTH FROM now() - INTERVAL '1 month')
        AND EXTRACT(YEAR FROM i.created_at) = EXTRACT(YEAR FROM now() - INTERVAL '1 month')
      THEN i.total ELSE 0
    END
  ), 0) AS revenue_last_month,
  COALESCE(SUM(
    CASE WHEN d.stage NOT IN ('won', 'lost') AND d.deleted_at IS NULL THEN 1 ELSE 0 END
  ), 0) AS active_deals_count,
  COALESCE(SUM(
    CASE WHEN t.status IN ('open', 'in_progress', 'pending') AND t.deleted_at IS NULL THEN 1 ELSE 0 END
  ), 0) AS open_tickets_count,
  COALESCE(SUM(
    CASE WHEN p.status IN ('not_started', 'in_progress', 'on_hold') AND p.deleted_at IS NULL THEN 1 ELSE 0 END
  ), 0) AS active_projects_count,
  COALESCE(SUM(
    CASE
      WHEN pt.due_date >= date_trunc('week', now())::date
        AND pt.due_date < (date_trunc('week', now()) + INTERVAL '7 days')::date
        AND pt.status != 'done'
        AND pt.deleted_at IS NULL
      THEN 1 ELSE 0 END
  ), 0) AS tasks_due_this_week,
  COALESCE(SUM(
    CASE
      WHEN EXTRACT(MONTH FROM l.created_at) = EXTRACT(MONTH FROM now())
        AND EXTRACT(YEAR FROM l.created_at) = EXTRACT(YEAR FROM now())
        AND l.deleted_at IS NULL
      THEN 1 ELSE 0 END
  ), 0) AS new_leads_this_month
FROM organization_members om
LEFT JOIN invoices i ON i.organization_id = om.organization_id AND i.deleted_at IS NULL
LEFT JOIN deals d ON d.organization_id = om.organization_id
LEFT JOIN support_tickets t ON t.organization_id = om.organization_id
LEFT JOIN projects p ON p.organization_id = om.organization_id
LEFT JOIN project_tasks pt ON pt.organization_id = om.organization_id
LEFT JOIN leads l ON l.organization_id = om.organization_id
WHERE om.user_id = auth.uid()
  AND om.is_active = true
GROUP BY om.organization_id;

-- -----------------------------------------------------------
-- dashboard_deals_by_stage
-- -----------------------------------------------------------
CREATE OR REPLACE VIEW public.dashboard_deals_by_stage AS
SELECT
  om.organization_id,
  d.stage,
  COUNT(*) AS deal_count,
  COALESCE(SUM(d.value), 0) AS total_value,
  COALESCE(AVG(d.probability), 0) AS avg_probability
FROM organization_members om
JOIN deals d ON d.organization_id = om.organization_id AND d.deleted_at IS NULL
WHERE om.user_id = auth.uid()
  AND om.is_active = true
  AND d.stage NOT IN ('won', 'lost')
GROUP BY om.organization_id, d.stage
ORDER BY
  CASE d.stage
    WHEN 'lead' THEN 1
    WHEN 'qualified' THEN 2
    WHEN 'proposal' THEN 3
    WHEN 'negotiation' THEN 4
    WHEN 'contract' THEN 5
    ELSE 6
  END;

-- -----------------------------------------------------------
-- dashboard_lead_status_distribution
-- -----------------------------------------------------------
CREATE OR REPLACE VIEW public.dashboard_lead_status_distribution AS
SELECT
  om.organization_id,
  l.status,
  COUNT(*) AS lead_count,
  COALESCE(SUM(l.value), 0) AS total_value
FROM organization_members om
JOIN leads l ON l.organization_id = om.organization_id AND l.deleted_at IS NULL
WHERE om.user_id = auth.uid()
  AND om.is_active = true
GROUP BY om.organization_id, l.status
ORDER BY
  CASE l.status
    WHEN 'new' THEN 1
    WHEN 'contacted' THEN 2
    WHEN 'qualified' THEN 3
    WHEN 'proposal' THEN 4
    WHEN 'negotiation' THEN 5
    WHEN 'won' THEN 6
    WHEN 'lost' THEN 7
    ELSE 8
  END;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------
-- Organizations policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON organizations
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON organizations
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "update_own_org" ON organizations
  FOR UPDATE TO authenticated
  USING (
    id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  )
  WITH CHECK (
    id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  );

-- -----------------------------------------------------------
-- Profiles policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON profiles
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  );

CREATE POLICY "update_own_org" ON profiles
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid()
    OR organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin', 'hr')
    )
  )
  WITH CHECK (
    id = auth.uid()
    OR organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin', 'hr')
    )
  );

-- -----------------------------------------------------------
-- Organization Members policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON organization_members
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON organization_members
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin', 'manager')
    )
  );

CREATE POLICY "update_own_org" ON organization_members
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  );

-- -----------------------------------------------------------
-- Roles policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON roles
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON roles
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  );

CREATE POLICY "update_own_org" ON roles
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  );

CREATE POLICY "delete_own_org" ON roles
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner')
    )
    AND is_system = false
  );

-- -----------------------------------------------------------
-- Settings policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON settings
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON settings
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  );

CREATE POLICY "update_own_org" ON settings
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  );

-- -----------------------------------------------------------
-- Leads policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON leads
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON leads
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "update_own_org" ON leads
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "delete_own_org" ON leads
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  );

-- -----------------------------------------------------------
-- Contacts policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON contacts
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON contacts
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "update_own_org" ON contacts
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "delete_own_org" ON contacts
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  );

-- -----------------------------------------------------------
-- Companies policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON companies
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON companies
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "update_own_org" ON companies
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "delete_own_org" ON companies
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  );

-- -----------------------------------------------------------
-- Deals policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON deals
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON deals
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "update_own_org" ON deals
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "delete_own_org" ON deals
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  );

-- -----------------------------------------------------------
-- Projects policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON projects
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON projects
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "update_own_org" ON projects
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "delete_own_org" ON projects
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin', 'manager')
    )
  );

-- -----------------------------------------------------------
-- Project Tasks policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON project_tasks
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON project_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "update_own_org" ON project_tasks
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "delete_own_org" ON project_tasks
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- -----------------------------------------------------------
-- Invoices policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON invoices
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "update_own_org" ON invoices
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "delete_own_org" ON invoices
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin', 'finance')
    )
  );

-- -----------------------------------------------------------
-- Expenses policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON expenses
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "update_own_org" ON expenses
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND (
      owner_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.user_id = auth.uid()
          AND om.organization_id = expenses.organization_id
          AND om.role IN ('super_admin', 'owner', 'admin', 'finance')
      )
    )
  );

CREATE POLICY "delete_own_org" ON expenses
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin', 'finance')
    )
  );

-- -----------------------------------------------------------
-- Leave Requests policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON leave_requests
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "update_own_org" ON leave_requests
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND (
      requester_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.user_id = auth.uid()
          AND om.organization_id = leave_requests.organization_id
          AND om.role IN ('super_admin', 'owner', 'admin', 'hr', 'manager')
      )
    )
  );

-- -----------------------------------------------------------
-- Warehouses policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON warehouses
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON warehouses
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  );

CREATE POLICY "update_own_org" ON warehouses
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  );

CREATE POLICY "delete_own_org" ON warehouses
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner')
    )
  );

-- -----------------------------------------------------------
-- Products policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON products
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON products
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "update_own_org" ON products
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "delete_own_org" ON products
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  );

-- -----------------------------------------------------------
-- Channels policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON channels
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND (
      type = 'public'
      OR creator_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM channel_members cm
        WHERE cm.channel_id = channels.id AND cm.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "insert_own_org" ON channels
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "update_own_org" ON channels
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "delete_own_org" ON channels
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  );

-- -----------------------------------------------------------
-- Channel Members policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON channel_members
  FOR SELECT TO authenticated
  USING (
    channel_id IN (
      SELECT c.id FROM channels c
      JOIN organization_members om ON om.organization_id = c.organization_id
      WHERE om.user_id = auth.uid() AND om.is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON channel_members
  FOR INSERT TO authenticated
  WITH CHECK (
    channel_id IN (
      SELECT c.id FROM channels c
      JOIN organization_members om ON om.organization_id = c.organization_id
      WHERE om.user_id = auth.uid() AND om.is_active = true
    )
    AND user_id = auth.uid()
  );

CREATE POLICY "delete_own_org" ON channel_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- -----------------------------------------------------------
-- Messages policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON messages
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND (
      channel_id IN (
        SELECT c.id FROM channels c
        WHERE c.type = 'public'
          AND c.organization_id IN (
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid() AND is_active = true
          )
      )
      OR channel_id IN (
        SELECT channel_id FROM channel_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "insert_own_org" ON messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND channel_id IN (
      SELECT c.id FROM channels c
      JOIN organization_members om ON om.organization_id = c.organization_id
      WHERE om.user_id = auth.uid() AND om.is_active = true
    )
  );

-- -----------------------------------------------------------
-- Support Tickets policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON support_tickets
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON support_tickets
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "update_own_org" ON support_tickets
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "delete_own_org" ON support_tickets
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin', 'support')
    )
  );

-- -----------------------------------------------------------
-- Calendar Events policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON calendar_events
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON calendar_events
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "update_own_org" ON calendar_events
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "delete_own_org" ON calendar_events
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND (
      creator_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.user_id = auth.uid()
          AND om.organization_id = calendar_events.organization_id
          AND om.role IN ('super_admin', 'owner', 'admin')
      )
    )
  );

-- -----------------------------------------------------------
-- Workspace Pages policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON workspace_pages
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON workspace_pages
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "update_own_org" ON workspace_pages
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "delete_own_org" ON workspace_pages
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND (
      last_edited_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.user_id = auth.uid()
          AND om.organization_id = workspace_pages.organization_id
          AND om.role IN ('super_admin', 'owner', 'admin')
      )
    )
  );

-- -----------------------------------------------------------
-- Notifications policies (user-scoped, not org-scoped)
-- -----------------------------------------------------------
CREATE POLICY "select_own" ON notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "insert_own" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "update_own" ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "delete_own" ON notifications
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- -----------------------------------------------------------
-- Audit Log policies (admin-only read)
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON audit_log
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin')
    )
  );

-- -----------------------------------------------------------
-- Activity Log policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON activity_log
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- -----------------------------------------------------------
-- Invitations policies
-- -----------------------------------------------------------
CREATE POLICY "select_own_org" ON invitations
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "insert_own_org" ON invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('super_admin', 'owner', 'admin', 'manager')
    )
  );

CREATE POLICY "update_own_org" ON invitations
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "delete_own_org" ON invitations
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND invited_by = auth.uid()
  );

COMMIT;
