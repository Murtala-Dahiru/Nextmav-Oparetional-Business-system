CREATE OR REPLACE FUNCTION public.crm_commercial_transition(p_org uuid,p_id uuid,p_revision integer,p_operation text,p_note text DEFAULT '',p_evidence uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r crm_commercial_records%ROWTYPE; member uuid:=auth_member_id(p_org); next_status text; vid uuid; rid uuid:=p_id; policy crm_commercial_policies%ROWTYPE; source crm_commercial_records%ROWTYPE;
BEGIN
 IF member IS NULL OR auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN RAISE EXCEPTION 'Commercial editing not permitted' USING ERRCODE='42501'; END IF;
 IF length(coalesce(p_note,''))>4000 THEN RAISE EXCEPTION 'Comment too long' USING ERRCODE='22023';END IF;
 SELECT * INTO r FROM crm_commercial_records WHERE id=p_id AND organization_id=p_org AND crm_commercial_visible(p_org,id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Record not found' USING ERRCODE='P0002';END IF;
 IF r.revision<>p_revision THEN RAISE EXCEPTION 'Stale revision' USING ERRCODE='PT409';END IF;
 next_status:=r.status;
 CASE p_operation
 WHEN 'revise' THEN
  IF r.status IN ('draft','pending_approval','changes_requested') THEN RAISE EXCEPTION 'Edit the current draft or finish its review' USING ERRCODE='22023';END IF;
  rid:=gen_random_uuid();
  INSERT INTO crm_commercial_records(id,organization_id,kind,number,title,company_id,contact_id,deal_id,owner_id,parent_id,quote_version_id,currency,total,issue_date,expires_on,effective_on,content,pricing,created_by)
  VALUES(rid,p_org,r.kind,upper(left(r.kind,3))||'-'||upper(left(replace(rid::text,'-',''),12)),r.title,r.company_id,r.contact_id,r.deal_id,r.owner_id,r.id,r.quote_version_id,r.currency,r.total,current_date,r.expires_on,r.effective_on,r.content,r.pricing,member);
  INSERT INTO crm_commercial_history(organization_id,record_id,revision,operation,note,actor_id) VALUES(p_org,rid,1,'revision_created',p_note,member);
  RETURN rid;
 WHEN 'submit' THEN
  IF r.kind='renewal' OR r.status NOT IN ('draft','changes_requested','rejected') THEN RAISE EXCEPTION 'Record is not ready for review' USING ERRCODE='22023';END IF;
  IF r.kind='quote' AND jsonb_array_length(r.content->'items')=0 THEN RAISE EXCEPTION 'A quote requires line items' USING ERRCODE='22023';END IF;
  IF r.kind='contract' AND length(coalesce(r.content->>'parties',''))=0 THEN RAISE EXCEPTION 'Identify the legal parties before review' USING ERRCODE='22023';END IF;
  next_status:='pending_approval';
  INSERT INTO crm_commercial_versions(organization_id,record_id,revision,purpose,snapshot,created_by) VALUES(p_org,p_id,r.revision,'submitted',to_jsonb(r),member);
  UPDATE crm_commercial_records SET submitted_by=member WHERE id=p_id;
 WHEN 'approve','reject','request_changes' THEN
  SELECT * INTO policy FROM crm_commercial_policies WHERE organization_id=p_org FOR SHARE;
  IF auth_role_in(p_org)<>ALL(coalesce(policy.approver_roles,ARRAY['owner','administrator'])) OR (NOT coalesce(policy.allow_self_approval,false) AND member IN (r.created_by,r.submitted_by,r.owner_id)) THEN RAISE EXCEPTION 'Approval requires an authorized independent approver' USING ERRCODE='42501';END IF;
  IF r.status<>'pending_approval' THEN RAISE EXCEPTION 'Approval is stale or already decided' USING ERRCODE='PT409';END IF;
  IF p_operation<>'approve' AND length(trim(coalesce(p_note,'')))=0 THEN RAISE EXCEPTION 'Explain the requested changes or rejection' USING ERRCODE='22023';END IF;
  next_status:=CASE p_operation WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'changes_requested' END;
  IF p_operation='approve' THEN
   INSERT INTO crm_commercial_versions(organization_id,record_id,revision,purpose,snapshot,created_by) VALUES(p_org,p_id,r.revision,'approved',to_jsonb(r),member) RETURNING id INTO vid;
   UPDATE crm_commercial_records SET approved_version_id=vid WHERE id=p_id;
  END IF;
 WHEN 'issue' THEN
  IF r.kind NOT IN ('quote','proposal') OR r.status<>'approved' OR r.approved_version_id IS NULL THEN RAISE EXCEPTION 'Approval is required before issuing' USING ERRCODE='22023';END IF;
  IF r.expires_on IS NOT NULL AND r.expires_on<current_date THEN RAISE EXCEPTION 'This offer has expired' USING ERRCODE='22023';END IF;
  next_status:='issued';
  INSERT INTO crm_commercial_versions(organization_id,record_id,revision,purpose,snapshot,created_by) VALUES(p_org,p_id,r.revision,'issued',to_jsonb(r),member) RETURNING id INTO vid;
  UPDATE crm_commercial_records SET issued_version_id=vid WHERE id=p_id;
 WHEN 'record_sent' THEN
  IF (r.kind IN ('quote','proposal') AND r.status<>'issued') OR (r.kind='contract' AND r.status<>'approved') OR r.kind='renewal' OR length(trim(p_note))=0 THEN RAISE EXCEPTION 'Issue/approve first and record the external delivery evidence' USING ERRCODE='22023';END IF;
  next_status:=CASE r.kind WHEN 'contract' THEN 'sent_for_signature' WHEN 'proposal' THEN 'shared' ELSE 'sent' END;
 WHEN 'accept','decline' THEN
  IF r.kind NOT IN ('quote','proposal') OR r.status NOT IN ('issued','sent','shared') OR length(trim(p_note))=0 OR auth_role_in(p_org) NOT IN ('owner','administrator','manager') THEN RAISE EXCEPTION 'Authorized internal recording and customer decision evidence required' USING ERRCODE='42501';END IF;
  IF p_operation='accept' AND r.expires_on<current_date THEN RAISE EXCEPTION 'Expired offer requires a new revision' USING ERRCODE='22023';END IF;
  next_status:=CASE p_operation WHEN 'accept' THEN 'accepted' ELSE 'declined' END;
 WHEN 'execute' THEN
  IF r.kind<>'contract' OR r.status NOT IN ('approved','sent_for_signature') OR auth_role_in(p_org) NOT IN ('owner','administrator') OR length(trim(p_note))=0 OR NOT EXISTS(SELECT 1 FROM crm_commercial_files WHERE id=p_evidence AND organization_id=p_org AND record_id=p_id AND mime_type='application/pdf') THEN RAISE EXCEPTION 'Authorized execution recording requires a private executed PDF and evidence note' USING ERRCODE='42501';END IF;
  next_status:='executed';
  INSERT INTO crm_commercial_versions(organization_id,record_id,revision,purpose,snapshot,created_by) VALUES(p_org,p_id,r.revision,'executed',to_jsonb(r)||jsonb_build_object('executionEvidence',p_evidence,'executionNote',p_note,'recordedAt',now()),member) RETURNING id INTO vid;
  UPDATE crm_commercial_records SET executed_version_id=vid WHERE id=p_id;
 WHEN 'activate' THEN
  IF r.kind<>'contract' OR r.status<>'executed' OR r.executed_version_id IS NULL OR r.effective_on IS NULL OR r.effective_on>current_date OR (r.expires_on IS NOT NULL AND r.expires_on<current_date) THEN RAISE EXCEPTION 'An executed contract within its effective term is required' USING ERRCODE='22023';END IF;
  next_status:='active';
 WHEN 'expire' THEN
  IF r.expires_on IS NULL OR r.expires_on>=current_date OR r.status NOT IN ('issued','sent','shared','active','executed') THEN RAISE EXCEPTION 'Record has not expired' USING ERRCODE='22023';END IF;next_status:='expired';
 WHEN 'terminate' THEN
  IF r.kind<>'contract' OR r.status NOT IN ('active','executed') OR auth_role_in(p_org) NOT IN ('owner','administrator') OR length(trim(p_note))=0 THEN RAISE EXCEPTION 'Termination requires authorization and a reason' USING ERRCODE='42501';END IF;next_status:='terminated';
 WHEN 'cancel' THEN
  IF r.status IN ('active','executed','accepted','renewed','terminated','superseded','cancelled') OR length(trim(p_note))=0 THEN RAISE EXCEPTION 'Cannot cancel this record; provide a reason for cancellation' USING ERRCODE='22023';END IF;next_status:='cancelled';
 WHEN 'prepare','negotiate','propose_renewal','not_renewed','renewed' THEN
  IF r.kind<>'renewal' OR r.status IN ('renewed','not_renewed','cancelled') THEN RAISE EXCEPTION 'Renewal is not open' USING ERRCODE='22023';END IF;
  IF p_operation='renewed' THEN
   SELECT * INTO source FROM crm_commercial_records WHERE id=p_evidence AND organization_id=p_org AND company_id=r.company_id AND kind='contract' AND executed_version_id IS NOT NULL AND id<>r.parent_id AND crm_commercial_visible(p_org,id);
   IF NOT FOUND OR source.parent_id IS DISTINCT FROM r.parent_id THEN RAISE EXCEPTION 'Link a newly executed revision of the source contract to record renewal' USING ERRCODE='22023';END IF;
  END IF;
  next_status:=CASE p_operation WHEN 'prepare' THEN 'in_preparation' WHEN 'negotiate' THEN 'negotiating' WHEN 'propose_renewal' THEN 'renewal_proposed' ELSE p_operation END;
 ELSE RAISE EXCEPTION 'Unsupported transition' USING ERRCODE='22023';
 END CASE;
 UPDATE crm_commercial_records SET status=next_status,revision=revision+1,updated_at=now() WHERE id=p_id;
 INSERT INTO crm_commercial_history(organization_id,record_id,revision,operation,note,actor_id) VALUES(p_org,p_id,r.revision,p_operation,coalesce(p_note,''),member);
 RETURN rid;
END $$;
REVOKE ALL ON FUNCTION crm_commercial_transition(uuid,uuid,integer,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_commercial_transition(uuid,uuid,integer,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_commercial_settings(p_org uuid,p_revision integer,p_self boolean,p_tax_name text DEFAULT NULL,p_tax_rate numeric DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_revision integer;
BEGIN
 IF NOT crm_automation_admin(p_org) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('commercial-policy:'||p_org,0));
 SELECT revision INTO current_revision FROM crm_commercial_policies WHERE organization_id=p_org FOR UPDATE;
 IF coalesce(current_revision,0)<>p_revision THEN RAISE EXCEPTION 'Stale policy' USING ERRCODE='PT409';END IF;
 INSERT INTO crm_commercial_policies(organization_id,allow_self_approval) VALUES(p_org,p_self) ON CONFLICT(organization_id) DO UPDATE SET allow_self_approval=p_self,revision=crm_commercial_policies.revision+1,updated_at=now();
 IF nullif(trim(p_tax_name),'') IS NOT NULL THEN INSERT INTO crm_commercial_taxes(organization_id,name,rate) VALUES(p_org,trim(p_tax_name),p_tax_rate); END IF;
END $$;
REVOKE ALL ON FUNCTION crm_commercial_settings(uuid,integer,boolean,text,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_commercial_settings(uuid,integer,boolean,text,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_commercial_obligation(p_org uuid,p_record uuid,p_id uuid,p_revision integer,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r crm_commercial_records%ROWTYPE; o crm_commercial_obligations%ROWTYPE; rid uuid:=coalesce(p_id,gen_random_uuid()); aid uuid; owner uuid:=(p_data->>'ownerId')::uuid;
BEGIN
 IF auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') OR NOT crm_commercial_visible(p_org,p_record) THEN RAISE EXCEPTION 'Obligation not accessible' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM crm_commercial_records WHERE id=p_record AND organization_id=p_org FOR UPDATE;
 IF r.kind<>'contract' THEN RAISE EXCEPTION 'Obligations require a contract' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM organization_members WHERE id=owner AND organization_id=p_org AND is_active AND deleted_at IS NULL AND role IN ('owner','administrator','manager','sales_staff')) THEN RAISE EXCEPTION 'Invalid responsible owner' USING ERRCODE='42501';END IF;
 IF length(coalesce(p_data->>'description','')) NOT BETWEEN 1 AND 2000 OR length(coalesce(p_data->>'evidence',''))>4000 THEN RAISE EXCEPTION 'Invalid obligation' USING ERRCODE='22023';END IF;
 IF p_id IS NULL THEN
  INSERT INTO crm_activities(organization_id,company_id,deal_id,contact_id,member_id,activity_type,subject,description,due_at)
   VALUES(p_org,r.company_id,r.deal_id,r.contact_id,owner,'followup',left(p_data->>'description',200),'Contract obligation: '||r.number,(p_data->>'dueOn')::date::timestamptz) RETURNING id INTO aid;
  INSERT INTO crm_commercial_obligations(id,organization_id,record_id,description,owner_id,due_on,priority,activity_id) VALUES(rid,p_org,p_record,p_data->>'description',owner,(p_data->>'dueOn')::date,p_data->>'priority',aid);
 ELSE
  SELECT * INTO o FROM crm_commercial_obligations WHERE id=p_id AND organization_id=p_org AND record_id=p_record FOR UPDATE;
  IF NOT FOUND OR o.revision<>p_revision THEN RAISE EXCEPTION 'Stale obligation' USING ERRCODE='PT409';END IF;
  IF p_data->>'status'='completed' AND length(trim(coalesce(p_data->>'evidence','')))=0 THEN RAISE EXCEPTION 'Completion evidence required' USING ERRCODE='22023';END IF;
  UPDATE crm_commercial_obligations SET status=p_data->>'status',evidence=p_data->>'evidence',revision=revision+1,completed_at=CASE WHEN p_data->>'status'='completed' THEN now() END WHERE id=p_id;
  UPDATE crm_activities SET completed_at=CASE WHEN p_data->>'status' IN ('completed','cancelled') THEN now() END WHERE id=o.activity_id;
 END IF;
 INSERT INTO crm_commercial_history(organization_id,record_id,revision,operation,note,actor_id) VALUES(p_org,p_record,r.revision,'obligation_'||coalesce(p_data->>'status','created'),p_data->>'description',auth_member_id(p_org));
 RETURN rid;
END $$;
REVOKE ALL ON FUNCTION crm_commercial_obligation(uuid,uuid,uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_commercial_obligation(uuid,uuid,uuid,integer,jsonb) TO authenticated;

-- The established CRM private bucket is reused, with commercial-specific restrictive guards.
CREATE OR REPLACE FUNCTION public.crm_entity_visible(p_org uuid,p_kind text,p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.can_access_module(p_org,'crm') AND CASE p_kind
 WHEN 'lead' THEN EXISTS(SELECT 1 FROM leads WHERE id=p_id AND organization_id=p_org AND deleted_at IS NULL AND public.crm_record_visible(organization_id,owner_id))
 WHEN 'deal' THEN EXISTS(SELECT 1 FROM deals WHERE id=p_id AND organization_id=p_org AND deleted_at IS NULL AND public.crm_record_visible(organization_id,owner_id))
 WHEN 'contact' THEN EXISTS(SELECT 1 FROM contacts WHERE id=p_id AND organization_id=p_org AND deleted_at IS NULL)
 WHEN 'company' THEN EXISTS(SELECT 1 FROM companies WHERE id=p_id AND organization_id=p_org AND deleted_at IS NULL)
 WHEN 'commercial' THEN crm_commercial_visible(p_org,p_id)
 ELSE false END
$$;
GRANT INSERT ON crm_commercial_files TO authenticated;
DROP POLICY IF EXISTS commercial_file_insert ON crm_commercial_files;
CREATE POLICY commercial_file_insert ON crm_commercial_files FOR INSERT TO authenticated WITH CHECK(crm_commercial_visible(organization_id,record_id) AND auth_role_in(organization_id) IN ('owner','administrator','manager','sales_staff') AND created_by=auth_member_id(organization_id) AND storage_path=organization_id::text||'/commercial/'||record_id::text||'/'||id::text);
DROP POLICY IF EXISTS commercial_storage_immutable ON storage.objects;
CREATE POLICY commercial_storage_immutable ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(bucket_id<>'crm-files' OR split_part(name,'/',2)<>'commercial');
-- Commercial files are retained as evidence; no overwrite, delete or public URL path.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='crm_commercial_records') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE crm_commercial_records,crm_commercial_obligations;
 END IF;
END $$;
