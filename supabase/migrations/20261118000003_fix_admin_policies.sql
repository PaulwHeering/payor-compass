-- SECURITY DEFINER bypasses RLS, avoiding infinite recursion when a
-- user_profiles policy needs to look up the caller's own role
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

DROP POLICY IF EXISTS "Allow read all profiles for admin" ON user_profiles;
CREATE POLICY "Allow read all profiles for admin" ON user_profiles
  FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can insert job_titles" ON job_titles
  FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update job_titles" ON job_titles
  FOR UPDATE
  USING (public.is_admin());

CREATE POLICY "Admins can delete job_titles" ON job_titles
  FOR DELETE
  USING (public.is_admin());
