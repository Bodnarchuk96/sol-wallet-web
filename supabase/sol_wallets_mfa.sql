-- SOL Wallet separate private Supabase project.
-- Run manually in the dedicated SOL project, NOT in BMH Portal or a client database.
-- Existing cloud data is NOT changed/deleted; this migration only adds schema/stronger access control.
-- IMPORTANT: first enroll TOTP for the owner; then apply this migration while prepared to sign in with AAL2.
begin;

create table if not exists public.sol_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null check (revision >= 1),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.sol_wallets enable row level security;

revoke all on public.sol_wallets from public, anon;
grant select, insert, update on public.sol_wallets to authenticated;

drop policy if exists sol_wallet_owner_access on public.sol_wallets;
create policy sol_wallet_owner_access
  on public.sol_wallets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Restrictive policies intersect with any existing permissive policy,
-- even when previous projects accidentally granted broad permissions.
drop policy if exists sol_wallet_restrict_to_owner on public.sol_wallets;
create policy sol_wallet_restrict_to_owner
  on public.sol_wallets
  as restrictive for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists sol_wallet_require_aal2 on public.sol_wallets;
create policy sol_wallet_require_aal2
  on public.sol_wallets
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

commit;

-- After applying, verify with a throwaway test user:
--  1. No access with anon key alone.
--  2. AAL1 (email/password before TOTP) cannot select/insert/update.
--  3. AAL2 can access only its own encrypted row; cross-user access denied.
--  4. Take an encrypted backup before enabling cloud migration.
