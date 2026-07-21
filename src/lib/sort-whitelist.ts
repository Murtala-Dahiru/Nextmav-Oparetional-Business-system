/**
 * Whitelist of sortable database columns per entity.
 * Used by API routes to prevent arbitrary column injection.
 */
export const SORT_WHITELIST: Record<string, string[]> = {
  lead: ['id', 'createdAt', 'updatedAt', 'firstName', 'lastName', 'email', 'company', 'status', 'score', 'value'],
  contact: ['id', 'createdAt', 'updatedAt', 'firstName', 'lastName', 'email', 'company', 'isActive'],
  company: ['id', 'createdAt', 'updatedAt', 'name', 'industry', 'city', 'country', 'employeeCount', 'annualRevenue'],
  deal: ['id', 'createdAt', 'updatedAt', 'name', 'value', 'stage', 'probability', 'closeDate'],
  project: ['id', 'createdAt', 'updatedAt', 'name', 'status', 'priority', 'budget', 'startDate', 'endDate'],
  projectTask: ['id', 'createdAt', 'updatedAt', 'title', 'status', 'priority', 'dueDate', 'sortOrder'],
  user: ['id', 'createdAt', 'updatedAt', 'firstName', 'lastName', 'email', 'jobTitle', 'department', 'isActive', 'lastSeen'],
  leaveRequest: ['id', 'createdAt', 'updatedAt', 'type', 'status', 'startDate', 'endDate'],
  invoice: ['id', 'createdAt', 'updatedAt', 'invoiceNumber', 'contactName', 'companyName', 'status', 'total', 'dueDate', 'paidAt'],
  expense: ['id', 'createdAt', 'updatedAt', 'title', 'amount', 'category', 'status', 'date'],
  product: ['id', 'createdAt', 'updatedAt', 'name', 'sku', 'category', 'price', 'stock', 'isActive'],
  warehouse: ['id', 'createdAt', 'updatedAt', 'name', 'location', 'capacity', 'isActive'],
  calendarEvent: ['id', 'createdAt', 'updatedAt', 'title', 'startDate', 'endDate'],
  channel: ['id', 'createdAt', 'updatedAt', 'name', 'type'],
  message: ['id', 'createdAt', 'content'],
  supportTicket: ['id', 'createdAt', 'updatedAt', 'ticketNumber', 'subject', 'status', 'priority', 'category', 'contactName'],
  workspacePage: ['id', 'createdAt', 'updatedAt', 'title', 'isFolder', 'isStarred'],
  role: ['id', 'createdAt', 'updatedAt', 'name', 'isSystem'],
  auditLog: ['id', 'createdAt', 'action', 'module', 'userId'],
  notification: ['id', 'createdAt', 'type', 'isRead'],
  setting: ['createdAt', 'updatedAt', 'group', 'key'],
};

/**
 * Sanitize a sort field against the whitelist.
 * Returns the field if allowed, otherwise falls back to `fallback`.
 */
export function safeSortField(entity: string, field: string, fallback = 'createdAt'): string {
  const allowed = SORT_WHITELIST[entity];
  if (!allowed) return fallback;
  return allowed.includes(field) ? field : fallback;
}