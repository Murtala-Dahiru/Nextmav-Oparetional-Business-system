DO $$ DECLARE definition text; needle text:='OR NOT EXISTS(SELECT 1 FROM crm_field_definitions WHERE id::text=fid'; BEGIN
 SELECT pg_get_functiondef('crm_layout_save(uuid,text,integer,text,jsonb)'::regprocedure) INTO definition;
 IF position('standard:email' in definition)=0 THEN
  IF position(needle in definition)=0 THEN RAISE EXCEPTION 'Unexpected layout validator'; END IF;
  EXECUTE replace(definition,needle,'OR fid NOT IN (''standard:email'',''standard:phone'',''standard:company'',''standard:job_title'',''standard:source'',''standard:campaign'',''standard:estimated_value'',''standard:recorded_score'',''standard:owner'',''standard:added'',''standard:notes'',''standard:status'',''standard:value'',''standard:weighted'',''standard:won_on'',''standard:lost_on'',''standard:expected_close'',''standard:age'',''standard:industry'',''standard:website'') AND NOT EXISTS(SELECT 1 FROM crm_field_definitions WHERE id::text=fid');
 END IF;
END $$;
