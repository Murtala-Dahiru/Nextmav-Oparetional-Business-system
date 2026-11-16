-- Preserve prior migrations; repair typed role comparison and reuse the activity body column.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('crm_commercial_transition(uuid,uuid,integer,text,text,uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,'auth_role_in(p_org)<>ALL','auth_role_in(p_org)::text<>ALL');
 EXECUTE definition;
 SELECT pg_get_functiondef('crm_commercial_obligation(uuid,uuid,uuid,integer,jsonb)'::regprocedure) INTO definition;
 definition:=replace(definition,'activity_type,subject,description,due_at','activity_type,subject,body,due_at');
 EXECUTE definition;
END $$;
