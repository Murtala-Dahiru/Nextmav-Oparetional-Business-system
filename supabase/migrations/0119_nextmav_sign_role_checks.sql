-- auth_role_in returns an enum: cast before the null-safe text fallback.
DO $$ DECLARE signature text; definition text; BEGIN
 FOREACH signature IN ARRAY ARRAY['sign_remind(uuid,date)','sign_revoke_recipient(uuid,uuid)','sign_archive(uuid,boolean)'] LOOP
 SELECT pg_get_functiondef(signature::regprocedure) INTO definition;
 definition:=replace(definition,'coalesce(auth_role_in(e.organization_id),','coalesce(auth_role_in(e.organization_id)::text,');
 EXECUTE definition;
 END LOOP;
END $$;
