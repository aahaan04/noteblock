-- Security hardening: tighten RLS policies that were too permissive
-- Run this in the Supabase SQL Editor.

-- 1. Remove the policy that allowed any authenticated user to insert queue items
--    directly. All legitimate inserts go through the request_song() security
--    definer RPC (which bypasses RLS) or the service-role backend. Direct
--    client inserts would bypass the credit-deduction logic entirely.
drop policy if exists "queue_insert_any" on public.queue_items;

-- 2. Remove the policy that allowed any authenticated user to insert credit
--    transactions directly. All credit changes must go through security definer
--    RPCs (grant_welcome_credits, gift_credits, refund_credits, request_song).
drop policy if exists "transactions_insert_any" on public.credit_transactions;

-- 3. Tighten the users update policy to prevent a user from escalating their
--    own role (e.g. guest → host) or inflating their credit balance directly
--    via the Supabase JS client. Security definer RPCs run as the function
--    owner (superuser) and bypass RLS, so they are unaffected.
drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users
  for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    -- role must remain unchanged (only server-side operations may change it)
    and role = (select role from public.users where id = auth.uid())
    -- credits_balance must remain unchanged (only RPCs may credit/debit)
    and credits_balance = (select credits_balance from public.users where id = auth.uid())
  );
