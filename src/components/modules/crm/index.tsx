'use client';
import { CrmNavigation } from './navigation';

import * as React from 'react';
import {
  LayoutGrid, Target, Users, Building2, Handshake, Columns3, Sparkles, Upload, UserPlus,
} from 'lucide-react';

import { useFocusRequest } from '@/hooks/use-focus-request';
import { useAppStore } from '@/store/app-store';
import { ExportButton } from '@/components/shared/export-button';

import { GovernanceSettings } from './governance-settings';
import { CrmHome } from './home';
import { AutomationStudio } from './automation-studio';
import { CommercialHub } from './commercial-hub';
import { LeadsSection } from './leads';
import { ContactsSection } from './contacts';
import { CompaniesSection } from './companies';
import { DealsSection } from './deals';
import { PipelineSection } from './pipeline';
import { ActivitiesSection, type ActivityView } from './activities';
import { ImportCenter } from './import-center';
import { PartnerQueue } from './partner-queue';
import type { CrmSection } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CRM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The shape of the module ──────────────────────────────────────────────
 *
 * Eight sections, each a screen in its own right, with Home as the way in.
 * They are deliberately *not* merged: a salesperson working a lead list, a
 * manager reading a forecast and somebody importing a spreadsheet are three
 * different jobs, and a single scrolling page that tried to serve all three
 * would serve none of them.
 *
 * ── Why sections are still local state ───────────────────────────────────
 *
 * Every module in this product holds its own sub-navigation in `useState`, and
 * lifting CRM's into the sidebar alone would make it the only one that behaves
 * that way. The design system's carried-forward list names this: sub-items are
 * lifted for all thirteen at once, or not at all. What changed here is that
 * the section bar is a real navigation - a row of named destinations with a
 * current one - rather than a `TabsList` of pills.
 *
 * ── Cross-module arrivals ────────────────────────────────────────────────
 *
 * `useFocusRequest` delivers "open this record" from the command palette, the
 * dashboard's attention queue, a project's client panel and the notification
 * tray. The id is held here rather than in the section, because a request for
 * a deal can arrive while Leads is showing: the section switches first, and
 * the id goes down as a prop to a component that is only then mounted.
 */

const SECTIONS: { id: CrmSection; label: string; icon: React.ElementType }[] = [
  { id: 'settings', label: 'Settings', icon: Columns3 },
  { id: 'home', label: 'Overview', icon: LayoutGrid },
  { id: 'leads', label: 'Leads', icon: Target },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'companies', label: 'Companies', icon: Building2 },
  { id: 'deals', label: 'Deals', icon: Handshake },
  { id: 'pipeline', label: 'Pipeline', icon: Columns3 },
  { id: 'activities', label: 'Activities', icon: Sparkles },
  { id: 'automations', label: 'Automation', icon: Sparkles },
  { id: 'commercial', label: 'Commercial Hub', icon: Handshake },
  { id: 'partners', label: 'Partners', icon: UserPlus },
  { id: 'import', label: 'Import', icon: Upload },
];

export default function CrmModule() {
  const identity = useAppStore(s => `${s.organization?.id ?? ''}:${s.user?.id ?? ''}:${s.user?.memberId ?? ''}:${s.user?.role ?? ''}`);
  return <CrmWorkspace key={identity} />;
}

function CrmWorkspace() {
  const [section, setSection] = React.useState<CrmSection>('home');

  const [focusLead, setFocusLead] = React.useState<string | null>(null);
  const [leadSource, setLeadSource] = React.useState<string | undefined>();
  const [focusContact, setFocusContact] = React.useState<string | null>(null);
  const [focusCompany, setFocusCompany] = React.useState<string | null>(null);
  const [focusDeal, setFocusDeal] = React.useState<string | null>(null);
  const [commercialFocus, setCommercialFocus] = React.useState<{type:string;id:string}|null>(null);
  const [activityView, setActivityView] = React.useState<ActivityView | undefined>();

  const allows = useAppStore(s => s.allows);
  const mayImport = allows('crm', 'create');

  const go = React.useCallback((next: CrmSection, focus?: { type: string; id: string }) => {
    if (!window.dispatchEvent(new Event('crm-automation-before-leave', { cancelable: true }))) return;
    setSection(next);
    if (next === 'leads') setLeadSource(focus?.type === 'lead-source' ? focus.id : undefined);
    if (next === 'activities') setActivityView(
      focus?.type === 'activity-view' && ['overdue', 'today', 'upcoming', 'done', 'history'].includes(focus.id)
        ? focus.id as ActivityView : undefined,
    );
    if (!focus) return;
    if (focus.type === 'lead') setFocusLead(focus.id);
    if (focus.type === 'contact') setFocusContact(focus.id);
    if (focus.type === 'company') setFocusCompany(focus.id);
    if (focus.type === 'deal') setFocusDeal(focus.id);
    if (focus.type === 'commercial') setCommercialFocus(focus);
  }, []);

  useFocusRequest('crm', ({ type, id }) => {
    switch (type) {
      case 'lead': go('leads', { type, id }); break;
      case 'contact': go('contacts', { type, id }); break;
      case 'company': go('companies', { type, id }); break;
      case 'deal': go('deals', { type, id }); break;
      case 'agreement': case 'commercial': case 'commercial-company': case 'commercial-deal': case 'commercial-contact':
        setCommercialFocus({type,id}); go('commercial'); break;
    }
  });

  const visible = SECTIONS.filter(s => (s.id !== 'import' || mayImport) && (!['automations', 'settings'].includes(s.id) || allows('crm', 'manage')));

  return (
    <div className="flex-1 overflow-auto">
      <CrmNavigation sections={visible} active={section} onChange={next => go(next)}>
        <ExportButton module="crm" datasets={[{ key: 'leads', label: 'Leads' }, { key: 'deals', label: 'Deals' }, { key: 'contacts', label: 'Contacts' }, { key: 'companies', label: 'Companies' }]} />
      </CrmNavigation>

      <div className="p-4 md:p-6">
        {section === 'settings' && allows('crm', 'manage') && <GovernanceSettings onGo={go} />}
        {section === 'home' && <CrmHome onGo={go} />}

        {section === 'leads' && (
          <LeadsSection initialSource={leadSource} focusId={focusLead} onFocusHandled={() => setFocusLead(null)} />
        )}

        {section === 'contacts' && (
          <ContactsSection focusId={focusContact} onFocusHandled={() => setFocusContact(null)} />
        )}

        {section === 'companies' && (
          <CompaniesSection focusId={focusCompany} onFocusHandled={() => setFocusCompany(null)} />
        )}

        {section === 'deals' && (
          <DealsSection focusId={focusDeal} onFocusHandled={() => setFocusDeal(null)} />
        )}

        {section === 'pipeline' && <PipelineSection />}
        {section === 'commercial' && <CommercialHub initialAgreementId={commercialFocus?.type==='agreement'?commercialFocus.id:undefined} key={`${commercialFocus?.type}:${commercialFocus?.id}`} initialId={commercialFocus?.type==='commercial'?commercialFocus.id:undefined} initialCompanyId={commercialFocus?.type==='commercial-company'?commercialFocus.id:undefined} initialDealId={commercialFocus?.type==='commercial-deal'?commercialFocus.id:undefined} initialContactId={commercialFocus?.type==='commercial-contact'?commercialFocus.id:undefined}/>}
        {section === 'automations' && allows('crm', 'manage') && <AutomationStudio onGo={go} />}

        {section === 'activities' && <ActivitiesSection key={activityView ?? 'auto'} initialView={activityView} />}

        {/*
          The partner queue.

          Behind the same grant as everything else here, which is what keeps
          external partners out of it: they hold no CRM grant at any scope, so
          this path refuses them at the door and the row policy refuses them
          again.
        */}
        {section === 'partners' && (
          <PartnerQueue onOpenLead={id => go('leads', { type: 'lead', id })} />
        )}

        {section === 'import' && mayImport && <ImportCenter onGo={go} />}
      </div>
    </div>
  );
}
