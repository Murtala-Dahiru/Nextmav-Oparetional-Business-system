-- ═══════════════════════════════════════════════════════════════════════════
--  Nigerian defaults, and the company details the settings screen collects
-- ═══════════════════════════════════════════════════════════════════════════
--
--  The product's initial market is Nigeria, but every default in the schema
--  was American: currency defaulted to USD and the address had nowhere to
--  record a state or a country at all.
--
--  ── What this does not do ────────────────────────────────────────────────
--
--  It does not rewrite the currency of any existing organization. A stored
--  currency is a deliberate choice by whoever set it, and silently converting
--  a workspace from dollars to naira would relabel every invoice, expense and
--  report in it without changing a single amount — the figures would be wrong
--  by a factor of roughly a thousand and nothing would say so.
--
--  Only the default for organizations created from now on changes. Existing
--  workspaces switch when an administrator chooses to, in Admin → Settings,
--  which now actually takes effect.

-- ── Currency default ──────────────────────────────────────────────────────

ALTER TABLE public.organizations
  ALTER COLUMN currency SET DEFAULT 'NGN';

COMMENT ON COLUMN public.organizations.currency IS
  'ISO 4217 code. The single source of truth for how money is displayed across '
  'every module; nothing else stores a currency. Validated against the '
  'supported set in lib/locale.ts before it is written.';

-- ── Company details ───────────────────────────────────────────────────────
--
-- The settings screen has always shown fields for phone, country and address,
-- and there was nowhere to put them: the update handler only ever wrote the
-- columns that existed, so those four inputs saved successfully and vanished.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS country char(2) NOT NULL DEFAULT 'NG';

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS address_line text;

-- Nigeria is divided into states, not provinces or counties. Naming the column
-- for what it holds keeps the address form honest about which country the
-- product was designed around.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS state text;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS city text;

COMMENT ON COLUMN public.organizations.country IS
  'ISO 3166-1 alpha-2. Defaults to NG — the initial market — and drives the '
  'address form and phone validation.';

-- ── Timezone ──────────────────────────────────────────────────────────────
--
-- 'UTC' is a safe default but not a real one for a Nigerian company: it puts
-- every attendance record an hour behind local time, so a 09:00 arrival is
-- recorded as 08:00 and the lateness calculation quietly disagrees with the
-- clock on the wall. West Africa Time has no daylight saving, so the offset
-- is constant and this is safe to default.
ALTER TABLE public.organizations
  ALTER COLUMN timezone SET DEFAULT 'Africa/Lagos';

-- Existing rows are left on whatever they have. An organization that has been
-- recording attendance against UTC should not have its history reinterpreted
-- by a migration; changing it is a decision for its administrator.
