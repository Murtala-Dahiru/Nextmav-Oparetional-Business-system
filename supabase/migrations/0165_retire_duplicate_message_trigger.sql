-- Both message triggers ran for direct messages and mentions. The message-row
-- producer already resolves the sender, preferences, recipient and exact channel.
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.messages'::regclass
   AND tgname='trg_notify_mentions' AND tgfoid='public.notify_message_mentions()'::regprocedure
   AND tgenabled IN ('O','A')) THEN
   RAISE EXCEPTION 'Canonical message notification producer is unavailable';
 END IF;
END $$;
DROP TRIGGER IF EXISTS trg_notify_message ON public.messages;
