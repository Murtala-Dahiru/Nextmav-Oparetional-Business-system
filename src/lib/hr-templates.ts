import type { ChecklistCategory, ChecklistOwner, JourneyKind } from '@/lib/hr';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Starter checklists.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A first draft of what a company does when somebody joins or leaves, offered
 * to an organisation that has not written its own yet.
 *
 * ── Why these are here and not in the database ───────────────────────────
 *
 * The migrations deliberately ship no template rows. Seeding "Sign your
 * contract" into every tenant would be fabricated data: it looks like the
 * company's process and nobody at that company wrote it, so the first time
 * somebody reads the onboarding screen they are reading a stranger's opinion
 * presented as their own policy. That is the same failure as the three
 * candidates the recruitment tab used to invent, one step further from being
 * noticed.
 *
 * Offering them from here is a different act. `POST /api/hr/templates` with a
 * `starter` key writes ordinary template rows owned by the organisation, which
 * they can then edit or delete like any other - because somebody chose it.
 *
 * ── What is in them, and what is not ─────────────────────────────────────
 *
 * Only steps that are true of essentially every employer, and none that this
 * product cannot support. There is no "add to the payroll system" step,
 * because payroll is here; there is no "order business cards", because that is
 * a guess about a company we know nothing about.
 *
 * `owner` is a role in the process rather than a person -
 * `start_employee_checklist()` resolves `manager` to the new starter's manager
 * and `employee` to the starter - and `dueOffsetDays` is signed, because the
 * contract and the laptop are both *before* the first day.
 */

export interface StarterItem {
  title: string;
  description: string;
  category: ChecklistCategory;
  owner: ChecklistOwner;
  dueOffsetDays: number;
  requiresDocument?: boolean;
}

export interface StarterTemplate {
  key: string;
  kind: JourneyKind;
  name: string;
  description: string;
  items: StarterItem[];
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: 'onboarding_standard',
    kind: 'onboarding',
    name: 'Standard onboarding',
    description:
      'The fortnight around somebody starting: paperwork before day one, ' +
      'access and equipment on it, and the first conversations in week one.',
    items: [
      {
        title: 'Signed contract on file',
        description:
          'Upload the countersigned contract against the employee record. ' +
          'It is stored confidentially and is visible to them and to HR.',
        category: 'paperwork', owner: 'hr', dueOffsetDays: -7,
        requiresDocument: true,
      },
      {
        title: 'Collect identification and right-to-work documents',
        description:
          'Whatever this jurisdiction requires before a first day. Filed ' +
          'against the employee, not in a shared folder.',
        category: 'paperwork', owner: 'hr', dueOffsetDays: -5,
        requiresDocument: true,
      },
      {
        title: 'Collect bank and tax details for payroll',
        description: 'Needed before the first pay run that includes them.',
        category: 'payroll', owner: 'hr', dueOffsetDays: -3,
      },
      {
        title: 'Prepare equipment',
        description: 'Laptop, phone and anything else the role needs, ready on the desk.',
        category: 'equipment', owner: 'it', dueOffsetDays: -2,
      },
      {
        title: 'Create accounts and grant access',
        description:
          'The NextMav account is created by the hire itself. This covers ' +
          'everything outside it that the role needs.',
        category: 'access', owner: 'it', dueOffsetDays: -1,
      },
      {
        title: 'Welcome and first-day walkthrough',
        description: 'Where things are, who is who, and what the first week looks like.',
        category: 'introductions', owner: 'manager', dueOffsetDays: 0,
      },
      {
        title: 'Read the workplace policies',
        description: 'The policy documents filed in HR. Ask anything that is unclear.',
        category: 'training', owner: 'employee', dueOffsetDays: 2,
      },
      {
        title: 'Introduce to the team and to key contacts',
        description: 'The people they will work with weekly, in person or on a call.',
        category: 'introductions', owner: 'manager', dueOffsetDays: 3,
      },
      {
        title: 'Set first goals',
        description:
          'Two or three, in Performance, so the first review has something to ' +
          'be about other than an impression.',
        category: 'training', owner: 'manager', dueOffsetDays: 7,
      },
      {
        title: 'First one-to-one',
        description: 'How the first week actually went, before it becomes the first month.',
        category: 'introductions', owner: 'manager', dueOffsetDays: 7,
      },
      {
        title: 'Thirty-day check-in',
        description: 'Settling in, blockers, and whether the role is what was described.',
        category: 'other', owner: 'hr', dueOffsetDays: 30,
      },
    ],
  },
  {
    key: 'offboarding_standard',
    kind: 'offboarding',
    name: 'Standard offboarding',
    description:
      'The two weeks around somebody leaving: handover first, because it is ' +
      'the part that stops being possible after their last day.',
    items: [
      {
        title: 'Confirm the last working day in writing',
        description: 'And whether any notice is being worked or paid.',
        category: 'paperwork', owner: 'hr', dueOffsetDays: -14,
      },
      {
        title: 'Write the handover',
        description:
          'What they own, where it is, and who picks it up. In Workspace, so ' +
          'it outlives the conversation.',
        category: 'handover', owner: 'employee', dueOffsetDays: -7,
      },
      {
        title: 'Reassign open work',
        description:
          'Projects, tasks and any customer they are the named contact for. ' +
          'Their profile lists all three.',
        category: 'handover', owner: 'manager', dueOffsetDays: -5,
      },
      {
        title: 'Exit conversation',
        description:
          'Why they are leaving, in their words. Recorded on the exit record, ' +
          'which only HR can read.',
        category: 'other', owner: 'hr', dueOffsetDays: -2,
      },
      {
        title: 'Return equipment',
        description: 'Laptop, phone, keys, cards. Anything the company issued.',
        category: 'return', owner: 'employee', dueOffsetDays: 0,
      },
      {
        title: 'Final pay and outstanding balances',
        description:
          'Untaken leave, expenses owed, anything being recovered. Reflected ' +
          'in the pay run that covers their last day.',
        category: 'payroll', owner: 'finance', dueOffsetDays: 0,
      },
      {
        title: 'Close access',
        description:
          'Every system outside NextMav. The NextMav account itself is ' +
          'suspended or terminated by an administrator, which is a separate ' +
          'and deliberate act.',
        category: 'access', owner: 'it', dueOffsetDays: 0,
      },
      {
        title: 'File the leaving paperwork',
        description: 'Whatever this jurisdiction requires the employer to issue.',
        category: 'paperwork', owner: 'hr', dueOffsetDays: 3,
        requiresDocument: true,
      },
    ],
  },
];
