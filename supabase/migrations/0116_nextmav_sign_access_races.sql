-- Invalidating access must also invalidate an already-loaded completion transaction.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('sign_revoke_recipient(uuid,uuid)'::regprocedure) INTO definition;
 IF position('revision=revision+1' in definition)=0 THEN
 definition:=replace(definition,'DELETE FROM sign_credentials WHERE envelope_id=p_id',
 'UPDATE sign_envelopes SET revision=revision+1 WHERE id=p_id;
 DELETE FROM sign_credentials WHERE envelope_id=p_id');
 EXECUTE definition;
 END IF;
END $$;
