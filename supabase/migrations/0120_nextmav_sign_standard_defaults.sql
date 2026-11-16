-- New organizations can use manual links without policy setup.
-- Existing settings (including explicit verification requirements) are untouched.
ALTER TABLE public.sign_settings ALTER COLUMN data SET DEFAULT
'{"allowPossession":true,"defaultDays":14,"senderName":"","supportEmail":"","consentAddendum":"","allowExternal":true}'::jsonb;
