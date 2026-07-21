import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { success, error } from '@/lib/api-response'
import type { UserRole } from '@/lib/supabase/types'

const DEFAULT_ROLES: { name: string; description: string }[] = [
  { name: 'admin', description: 'Full administrative access' },
  { name: 'manager', description: 'Team management capabilities' },
  { name: 'sales', description: 'Sales and CRM access' },
  { name: 'hr', description: 'HR and employee management' },
  { name: 'finance', description: 'Financial and billing access' },
  { name: 'marketing', description: 'Marketing tools and analytics' },
  { name: 'support', description: 'Customer support and ticketing' },
  { name: 'employee', description: 'Standard employee access' },
]

const DEFAULT_SETTINGS = [
  { key: 'company_name', value: '', type: 'text', group: 'company_info' },
  { key: 'company_email', value: '', type: 'email', group: 'company_info' },
  { key: 'company_phone', value: '', type: 'text', group: 'company_info' },
  { key: 'company_address', value: '', type: 'text', group: 'company_info' },
  { key: 'company_website', value: '', type: 'url', group: 'company_info' },
  { key: 'currency', value: 'USD', type: 'text', group: 'finance' },
  { key: 'tax_rate', value: '0', type: 'number', group: 'finance' },
  { key: 'invoice_prefix', value: 'INV', type: 'text', group: 'finance' },
  { key: 'fiscal_year_start', value: '01-01', type: 'date', group: 'finance' },
]

const DEFAULT_NOTIFICATION_PREFERENCES = [
  { type: 'email_assignments', enabled: true },
  { type: 'email_mentions', enabled: true },
  { type: 'email_comments', enabled: false },
  { type: 'email_updates', enabled: true },
  { type: 'email_digest', enabled: true },
  { type: 'email_reminders', enabled: true },
  { type: 'push_assignments', enabled: true },
  { type: 'push_mentions', enabled: true },
  { type: 'push_comments', enabled: true },
  { type: 'push_updates', enabled: false },
  { type: 'push_reminders', enabled: true },
]

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, first_name, last_name, organization_name } = body

    // Validation
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return error('A valid email address is required', 400, 'VALIDATION_ERROR')
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return error('Password must be at least 8 characters long', 400, 'VALIDATION_ERROR')
    }

    if (!first_name || typeof first_name !== 'string' || first_name.trim().length === 0) {
      return error('First name is required', 400, 'VALIDATION_ERROR')
    }

    if (!last_name || typeof last_name !== 'string' || last_name.trim().length === 0) {
      return error('Last name is required', 400, 'VALIDATION_ERROR')
    }

    if (!organization_name || typeof organization_name !== 'string' || organization_name.trim().length === 0) {
      return error('Organization name is required', 400, 'VALIDATION_ERROR')
    }

    const supabase = await createSupabaseServerClient(request)

    // 1. Create Supabase auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          first_name: first_name.trim(),
          last_name: last_name.trim(),
        },
      },
    })

    if (authError) {
      return error(authError.message, 400, 'AUTH_ERROR', authError)
    }

    if (!authData.user) {
      return error('Failed to create user account', 500, 'AUTH_ERROR')
    }

    const userId = authData.user.id
    const orgSlug = organization_name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

    // 2. Create organization
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: organization_name.trim(),
        slug: orgSlug,
        currency: 'USD',
        tax_rate: 0,
        invoice_prefix: 'INV',
        fiscal_year_start: '01-01',
      })
      .select()
      .single()

    if (orgError) {
      return error('Failed to create organization: ' + orgError.message, 500, 'ORG_ERROR', orgError)
    }

    // 3. Create user profile
    const { error: profileError } = await supabase
      .from('user_profiles')
      .insert({
        id: userId,
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        email: email.trim().toLowerCase(),
        is_active: true,
      })

    if (profileError) {
      return error('Failed to create user profile: ' + profileError.message, 500, 'PROFILE_ERROR', profileError)
    }

    // 4. Create organization_member with role 'owner'
    const { error: memberError } = await supabase
      .from('organization_members')
      .insert({
        user_id: userId,
        organization_id: org.id,
        role: 'owner' as UserRole,
        is_active: true,
        joined_at: new Date().toISOString(),
      })

    if (memberError) {
      return error('Failed to add member to organization: ' + memberError.message, 500, 'MEMBER_ERROR', memberError)
    }

    // 5. Create default role set
    const rolesToInsert = DEFAULT_ROLES.map((role) => ({
      organization_id: org.id,
      name: role.name,
      description: role.description,
      is_system: true,
      permissions: {},
    }))

    const { error: rolesError } = await supabase
      .from('roles')
      .insert(rolesToInsert)

    if (rolesError) {
      return error('Failed to create default roles: ' + rolesError.message, 500, 'ROLES_ERROR', rolesError)
    }

    // 6. Create default settings
    const settingsToInsert = DEFAULT_SETTINGS.map((setting) => ({
      key: setting.key,
      value: setting.key === 'company_name' ? organization_name.trim() : setting.value,
      type: setting.type,
      group: setting.group,
      organization_id: org.id,
      updated_by: userId,
    }))

    const { error: settingsError } = await supabase
      .from('settings')
      .insert(settingsToInsert)

    if (settingsError) {
      return error('Failed to create default settings: ' + settingsError.message, 500, 'SETTINGS_ERROR', settingsError)
    }

    // 7. Seed notification preferences
    const notificationsToInsert = DEFAULT_NOTIFICATION_PREFERENCES.map((pref) => ({
      user_id: userId,
      type: pref.type,
      enabled: pref.enabled,
    }))

    const { error: notifError } = await supabase
      .from('notification_preferences')
      .insert(notificationsToInsert)

    if (notifError) {
      return error('Failed to create notification preferences: ' + notifError.message, 500, 'NOTIF_ERROR', notifError)
    }

    return success({
      user: {
        id: authData.user.id,
        email: authData.user.email,
        first_name: first_name.trim(),
        last_name: last_name.trim(),
      },
      session: authData.session,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
      },
    })
  } catch (e: any) {
    return error(e.message || 'An unexpected error occurred during signup', 500, 'INTERNAL_ERROR')
  }
}