-- Reject null revision bypasses and suspended sequence task owners.
CREATE OR REPLACE FUNCTION public.crm_sales_template_save(p_org uuid,p_id uuid,p_revision integer,p_value jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing crm_sales_templates%ROWTYPE; rid uuid:=coalesce(p_id,gen_random_uuid());
BEGIN
 IF NOT can_access_module(p_org,'crm') OR auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN RAISE EXCEPTION 'CRM write permission required' USING ERRCODE='42501'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO existing FROM crm_sales_templates WHERE id=p_id AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR (existing.owner_id<>auth_member_id(p_org) AND NOT(existing.visibility='organization' AND crm_automation_admin(p_org))) THEN RAISE EXCEPTION 'Template unavailable' USING ERRCODE='42501'; END IF;
  IF existing.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Template changed; reload before saving' USING ERRCODE='PT409'; END IF;
 END IF;
 IF (p_value->>'visibility'='organization' OR existing.visibility='organization') AND NOT crm_automation_admin(p_org) THEN RAISE EXCEPTION 'Administrator required for shared templates' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO crm_sales_templates(id,organization_id,owner_id,visibility,name,category,subject,body) VALUES(rid,p_org,auth_member_id(p_org),p_value->>'visibility',p_value->>'name',p_value->>'category',p_value->>'subject',p_value->>'body');
 ELSE
  UPDATE crm_sales_templates SET visibility=p_value->>'visibility',name=p_value->>'name',category=p_value->>'category',subject=p_value->>'subject',body=p_value->>'body',archived=coalesce((p_value->>'archived')::boolean,false),revision=revision+1,updated_at=now() WHERE id=rid;
 END IF;
 RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.crm_sales_sequence_task_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e crm_sales_enrollments%ROWTYPE; run uuid:=nullif(current_setting('nextmav.automation_run',true),'')::uuid;
BEGIN
 IF run IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO e FROM crm_sales_enrollments WHERE run_id=run;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM organization_members m JOIN profiles p ON p.id=m.user_id WHERE m.id=e.owner_id AND m.organization_id=e.organization_id AND m.is_active AND m.deleted_at IS NULL AND m.role IN ('owner','administrator','manager','sales_staff') AND p.is_active AND p.auth_deleted_at IS NULL) THEN RAISE EXCEPTION 'Sequence owner is no longer authorized' USING ERRCODE='42501'; END IF;
 IF e.state<>'active' OR NOT crm_sales_recipient_eligible(e.organization_id,e.record_type,e.record_id) THEN RAISE EXCEPTION 'Sales recipient suppressed or enrollment stopped' USING ERRCODE='42501'; END IF;
 IF e.record_type='lead' AND NOT EXISTS(SELECT 1 FROM leads WHERE id=e.record_id AND organization_id=e.organization_id AND (owner_id=e.owner_id OR EXISTS(SELECT 1 FROM organization_members WHERE id=e.owner_id AND role IN ('owner','administrator')))) THEN RAISE EXCEPTION 'Sequence owner no longer has record access' USING ERRCODE='42501'; END IF;
 NEW.member_id:=e.owner_id;
 RETURN NEW;
END $$;
