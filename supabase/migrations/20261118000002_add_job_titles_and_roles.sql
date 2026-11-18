-- Create job_titles table
CREATE TABLE job_titles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer', -- 'viewer', 'manager', 'admin'
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create user_profiles table to track user info
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  job_title TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',
  entra_id TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE job_titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Allow read job_titles for all" ON job_titles
  FOR SELECT
  USING (true);

CREATE POLICY "Allow read own profile" ON user_profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Allow read all profiles for admin" ON user_profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'admin'
    )
  );

CREATE POLICY "Allow insert own profile" ON user_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Allow update own profile" ON user_profiles
  FOR UPDATE
  USING (auth.uid() = id);

-- Create indexes
CREATE INDEX idx_job_titles_enabled ON job_titles(enabled);
CREATE INDEX idx_user_profiles_role ON user_profiles(role);
CREATE INDEX idx_user_profiles_entra_id ON user_profiles(entra_id);

-- Insert initial job title
INSERT INTO job_titles (title, role, enabled) VALUES
  ('VP of Data & Product Innovation', 'admin', true);
