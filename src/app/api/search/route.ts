import { db } from '@/lib/db';
import { success, error } from '@/lib/api-response';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') || '';

  if (!q || q.trim().length === 0) {
    return success({ results: {} });
  }

  const searchWildcard = { contains: q };

  const [
    leads,
    contacts,
    companies,
    deals,
    projects,
    tickets,
    invoices,
    pages,
  ] = await Promise.all([
    db.lead.findMany({
      where: {
        OR: [
          { firstName: searchWildcard },
          { lastName: searchWildcard },
          { email: searchWildcard },
          { company: searchWildcard },
        ],
      },
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),
    db.contact.findMany({
      where: {
        OR: [
          { firstName: searchWildcard },
          { lastName: searchWildcard },
          { email: searchWildcard },
          { company: searchWildcard },
        ],
      },
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),
    db.company.findMany({
      where: {
        OR: [
          { name: searchWildcard },
          { industry: searchWildcard },
          { city: searchWildcard },
        ],
      },
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),
    db.deal.findMany({
      where: {
        OR: [
          { name: searchWildcard },
          { contactName: searchWildcard },
          { companyName: searchWildcard },
        ],
      },
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),
    db.project.findMany({
      where: {
        OR: [
          { name: searchWildcard },
          { description: searchWildcard },
        ],
      },
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),
    db.supportTicket.findMany({
      where: {
        OR: [
          { subject: searchWildcard },
          { description: searchWildcard },
          { contactName: searchWildcard },
          { ticketNumber: searchWildcard },
        ],
      },
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),
    db.invoice.findMany({
      where: {
        OR: [
          { invoiceNumber: searchWildcard },
          { contactName: searchWildcard },
          { companyName: searchWildcard },
        ],
      },
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),
    db.workspacePage.findMany({
      where: {
        OR: [
          { title: searchWildcard },
          { content: searchWildcard },
        ],
      },
      take: 5,
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  return success({
    results: {
      leads: leads.map((l) => ({ id: l.id, label: `${l.firstName} ${l.lastName}`, sub: l.company, module: 'crm' })),
      contacts: contacts.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}`, sub: c.company, module: 'crm' })),
      companies: companies.map((c) => ({ id: c.id, label: c.name, sub: c.industry, module: 'crm' })),
      deals: deals.map((d) => ({ id: d.id, label: d.name, sub: `$${d.value} — ${d.stage}`, module: 'crm' })),
      projects: projects.map((p) => ({ id: p.id, label: p.name, sub: p.status, module: 'projects' })),
      tickets: tickets.map((t) => ({ id: t.id, label: `${t.ticketNumber}: ${t.subject}`, sub: t.status, module: 'support' })),
      invoices: invoices.map((i) => ({ id: i.id, label: i.invoiceNumber, sub: i.companyName, module: 'finance' })),
      pages: pages.map((p) => ({ id: p.id, label: p.title, sub: 'Workspace', module: 'workspace' })),
    },
  });
}