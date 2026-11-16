CREATE TABLE IF NOT EXISTS crm_capture_forms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),fields jsonb NOT NULL,
 source text NOT NULL CHECK(length(source) BETWEEN 1 AND 100),campaign text NOT NULL DEFAULT '',
 consent_text text NOT NULL CHECK(length(consent_text) BETWEEN 1 AND 2000),enabled boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_capture_submissions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),form_id uuid NOT NULL REFERENCES crm_capture_forms(id),
 lead_id uuid REFERENCES leads(id),form_version integer NOT NULL,consent_text text NOT NULL,consented_at timestamptz NOT NULL DEFAULT now(),
 duplicate_status text NOT NULL CHECK(duplicate_status IN ('new','exact','possible')),submitted_values jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_capture_limits (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 form_id uuid NOT NULL REFERENCES crm_capture_forms(id),bucket text NOT NULL,window_start timestamptz NOT NULL,hits integer NOT NULL,
 PRIMARY KEY(form_id,bucket,window_start)
);
ALTER TABLE public.crm_capture_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_capture_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_capture_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_capture_forms,public.crm_capture_submissions,public.crm_capture_limits FROM anon,authenticated;
GRANT SELECT ON public.crm_capture_forms,public.crm_capture_submissions TO authenticated;
DROP POLICY IF EXISTS capture_form_read ON public.crm_capture_forms;
CREATE POLICY capture_form_read ON public.crm_capture_forms FOR SELECT TO authenticated USING(public.can_access_module(organization_id,'crm'));
DROP POLICY IF EXISTS capture_submission_read ON public.crm_capture_submissions;
CREATE POLICY capture_submission_read ON public.crm_capture_submissions FOR SELECT TO authenticated USING(public.auth_role_in(organization_id) IN ('owner','administrator'));
CREATE OR REPLACE FUNCTION public.crm_save_capture_form(p_org uuid,p_id uuid,p_version integer,p_config jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result uuid; current_version integer; field jsonb; keys text[]:='{}'; targets text[]:='{}';
BEGIN
 IF public.auth_member_id(p_org) IS NULL OR public.auth_role_in(p_org) NOT IN ('owner','administrator') THEN RAISE EXCEPTION 'Capture configuration not permitted' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_config->'fields') IS DISTINCT FROM 'array' OR jsonb_array_length(p_config->'fields') NOT BETWEEN 1 AND 15 THEN RAISE EXCEPTION 'Define 1 to 15 capture fields' USING ERRCODE='22023';END IF;
 FOR field IN SELECT * FROM jsonb_array_elements(p_config->'fields') LOOP
  IF coalesce(field->>'key','')!~'^[a-z][a-z0-9]{0,39}$' OR field->>'key'=ANY(keys) OR field->>'target'=ANY(targets) OR coalesce(field->>'target','') NOT IN ('first_name','last_name','email','phone','company_name','job_title','notes','territory','industry','service_interest') OR coalesce(length(field->>'label'),0) NOT BETWEEN 1 AND 100 OR jsonb_typeof(field->'required') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid capture field mapping' USING ERRCODE='22023';END IF;
  keys:=array_append(keys,field->>'key');targets:=array_append(targets,field->>'target');
 END LOOP;
 IF NOT('email'=ANY(targets) OR 'phone'=ANY(targets)) THEN RAISE EXCEPTION 'Capture requires an email or phone field' USING ERRCODE='22023';END IF;
 IF p_id IS NULL THEN
  IF p_version IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Invalid initial version' USING ERRCODE='22023';END IF;
  INSERT INTO crm_capture_forms(organization_id,name,fields,source,campaign,consent_text,enabled) VALUES(p_org,p_config->>'name',p_config->'fields',p_config->>'source',coalesce(p_config->>'campaign',''),p_config->>'consentText',coalesce((p_config->>'enabled')::boolean,false)) RETURNING id INTO result;
 ELSE
  SELECT version INTO current_version FROM crm_capture_forms WHERE id=p_id AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Capture form not found' USING ERRCODE='P0002';END IF;
  IF current_version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Capture form changed; reload first' USING ERRCODE='40001';END IF;
  UPDATE crm_capture_forms SET name=p_config->>'name',fields=p_config->'fields',source=p_config->>'source',campaign=coalesce(p_config->>'campaign',''),consent_text=p_config->>'consentText',enabled=coalesce((p_config->>'enabled')::boolean,false),version=version+1,updated_at=now() WHERE id=p_id;result:=p_id;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.crm_save_capture_form(uuid,uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_save_capture_form(uuid,uuid,integer,jsonb) TO authenticated;

-- Public metadata contains no tenant/member identifiers or submission data.
CREATE OR REPLACE FUNCTION public.crm_public_capture_form(p_form uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',id,'name',name,'fields',fields,'consentText',consent_text,'version',version) FROM crm_capture_forms WHERE id=p_form AND enabled
$$;
REVOKE ALL ON FUNCTION public.crm_public_capture_form(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_public_capture_form(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_submit_capture(p_form uuid,p_version integer,p_request uuid,p_values jsonb,p_consent boolean,p_address_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE form crm_capture_forms%ROWTYPE; field jsonb; mapped jsonb:='{}'; value text; hits_now integer; matches uuid[]; lead_id uuid; duplicate text:='new'; window_at timestamptz; previous crm_capture_submissions%ROWTYPE;
BEGIN
 IF p_request IS NULL OR p_consent IS DISTINCT FROM true OR p_address_hash IS NULL OR length(p_address_hash)<>64 OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR octet_length(p_values::text)>20000 THEN RAISE EXCEPTION 'Invalid capture submission' USING ERRCODE='22023';END IF;
 SELECT * INTO form FROM crm_capture_forms WHERE id=p_form AND enabled FOR SHARE;
 IF NOT FOUND THEN RETURN 'unavailable';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-capture:'||p_form::text,0));
 SELECT * INTO previous FROM crm_capture_submissions WHERE id=p_request;
 IF FOUND THEN IF previous.form_id=p_form AND previous.submitted_values=p_values THEN RETURN 'accepted';ELSE RETURN 'invalid';END IF;END IF;
 IF form.version IS DISTINCT FROM p_version THEN RETURN 'changed';END IF;
 -- Distributed counters live in PostgreSQL, including across app instances.
 window_at:=date_trunc('hour',now());
 INSERT INTO crm_capture_limits(organization_id,form_id,bucket,window_start,hits) VALUES(form.organization_id,p_form,'all',window_at,1) ON CONFLICT(form_id,bucket,window_start) DO UPDATE SET hits=crm_capture_limits.hits+1 RETURNING hits INTO hits_now;
 IF hits_now>1000 THEN RETURN 'limited';END IF;
 INSERT INTO crm_capture_limits(organization_id,form_id,bucket,window_start,hits) VALUES(form.organization_id,p_form,p_address_hash,window_at,1) ON CONFLICT(form_id,bucket,window_start) DO UPDATE SET hits=crm_capture_limits.hits+1 RETURNING hits INTO hits_now;
 IF hits_now>20 THEN RETURN 'limited';END IF;
 DELETE FROM crm_capture_limits WHERE form_id=p_form AND window_start<now()-interval '2 days';
 FOR field IN SELECT * FROM jsonb_array_elements(form.fields) LOOP
  IF p_values?(field->>'key') AND jsonb_typeof(p_values->(field->>'key'))<>'string' THEN RETURN 'invalid';END IF;
  value:=btrim(coalesce(p_values->>(field->>'key'),''));
  IF length(value)>(CASE WHEN field->>'target'='notes' THEN 4000 ELSE 250 END) OR ((field->>'required')::boolean AND value='') THEN RETURN 'invalid';END IF;
  IF field->>'target'='email' AND value<>'' AND value!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RETURN 'invalid';END IF;
  mapped:=mapped||jsonb_build_object(field->>'target',value);
 END LOOP;
 IF coalesce(mapped->>'email','')='' AND coalesce(mapped->>'phone','')='' THEN RETURN 'invalid';END IF;
 IF coalesce(mapped->>'first_name','')='' AND coalesce(mapped->>'last_name','')='' AND coalesce(mapped->>'company_name','')='' THEN RETURN 'invalid';END IF;
 -- Serialize duplicate checks with conversion/merge to avoid split relationships.
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-convert:'||form.organization_id::text,0));
 SELECT array_agg(id) INTO matches FROM leads WHERE organization_id=form.organization_id AND deleted_at IS NULL AND (
  (coalesce(mapped->>'email','')<>'' AND lower(btrim(email::text))=lower(mapped->>'email')) OR
  (length(regexp_replace(coalesce(mapped->>'phone',''),'[^0-9]','','g'))>=7 AND regexp_replace(coalesce(phone,''),'[^0-9]','','g')=regexp_replace(mapped->>'phone','[^0-9]','','g')));
 IF cardinality(matches)=1 THEN lead_id:=matches[1];duplicate:='exact';
 ELSE
  IF cardinality(matches)>1 THEN duplicate:='possible';END IF;
  INSERT INTO leads(organization_id,first_name,last_name,email,phone,company_name,job_title,notes,source,territory,industry,service_interest,campaign)
  VALUES(form.organization_id,coalesce(mapped->>'first_name',''),coalesce(mapped->>'last_name',''),nullif(mapped->>'email',''),nullif(mapped->>'phone',''),mapped->>'company_name',mapped->>'job_title',coalesce(mapped->>'notes',''),form.source,coalesce(mapped->>'territory',''),coalesce(mapped->>'industry',''),coalesce(mapped->>'service_interest',''),form.campaign) RETURNING id INTO lead_id;
  PERFORM public.crm_assign_lead_internal(form.organization_id,lead_id,p_request,false);
 END IF;
 INSERT INTO crm_capture_submissions(id,organization_id,form_id,lead_id,form_version,consent_text,duplicate_status,submitted_values) VALUES(p_request,form.organization_id,p_form,lead_id,form.version,form.consent_text,duplicate,p_values);
 RETURN 'accepted';
END $$;
REVOKE ALL ON FUNCTION public.crm_submit_capture(uuid,integer,uuid,jsonb,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_submit_capture(uuid,integer,uuid,jsonb,boolean,text) TO service_role;
