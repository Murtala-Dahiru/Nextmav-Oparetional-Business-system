-- RPC access must enforce mutation roles even when called without the HTTP layer.
DO $$ DECLARE signature text; definition text; BEGIN
 FOREACH signature IN ARRAY ARRAY['sign_remind(uuid,date)','sign_revoke_recipient(uuid,uuid)'] LOOP
 SELECT pg_get_functiondef(signature::regprocedure) INTO definition;
 IF position('auth_role_in(e.organization_id)' in definition)=0 THEN
 definition:=replace(definition,'IF NOT FOUND OR NOT crm_record_visible','IF NOT FOUND OR coalesce(auth_role_in(e.organization_id),'''') NOT IN (''owner'',''administrator'',''manager'',''sales_staff'') OR NOT crm_record_visible');
 EXECUTE definition;
 END IF;
 END LOOP;
END $$;
