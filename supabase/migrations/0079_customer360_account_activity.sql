-- Resolve the account once so contact-linked activity is included even without a
-- redundant company_id. Hidden deals and leads remain excluded by the view.
CREATE OR REPLACE VIEW public.crm_visible_activities WITH(security_invoker=true) AS
 SELECT a.*,coalesce(a.company_id,c.company_id,d.company_id) AS account_company_id
 FROM crm_activities a
 LEFT JOIN contacts c ON c.id=a.contact_id AND c.organization_id=a.organization_id AND c.deleted_at IS NULL
 LEFT JOIN deals d ON d.id=a.deal_id AND d.organization_id=a.organization_id AND d.deleted_at IS NULL
 WHERE public.can_access_module(a.organization_id,'crm')
 AND (a.deal_id IS NULL OR (d.id IS NOT NULL AND public.crm_record_visible(d.organization_id,d.owner_id)))
 AND (a.lead_id IS NULL OR EXISTS(SELECT 1 FROM leads l WHERE l.id=a.lead_id AND l.organization_id=a.organization_id AND l.deleted_at IS NULL AND public.crm_record_visible(l.organization_id,l.owner_id)));
GRANT SELECT ON public.crm_visible_activities TO authenticated;
