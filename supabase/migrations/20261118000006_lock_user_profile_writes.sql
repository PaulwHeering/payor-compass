-- Users could update their own user_profiles row, including `role`, and promote themselves to admin.
-- Profiles are now written only by the server (service role key, which bypasses RLS) in
-- app/auth/callback/route.ts. With RLS on and no insert/update policy, clients cannot write at all.
--
-- DEPLOY ORDER: apply this ONLY after the callback change using SUPABASE_SERVICE_ROLE_KEY is
-- live in production. Applying it first would stop logins from saving roles.

drop policy if exists "Allow insert own profile" on user_profiles;
drop policy if exists "Allow update own profile" on user_profiles;
