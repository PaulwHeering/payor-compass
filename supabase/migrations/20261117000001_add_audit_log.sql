-- Create audit_log table to track all changes to payer data
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_id UUID NOT NULL REFERENCES payers(id) ON DELETE CASCADE,
  field_id UUID REFERENCES field_definitions(id) ON DELETE SET NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT NOT NULL, -- email or user identifier
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  change_type TEXT NOT NULL -- 'create', 'update', 'delete'
);

-- Create index for faster lookups
CREATE INDEX idx_audit_log_payer_id ON audit_log(payer_id);
CREATE INDEX idx_audit_log_changed_at ON audit_log(changed_at DESC);

-- Enable RLS
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Create RLS policy - allow all users to read audit logs (for development)
CREATE POLICY "Allow read audit_log for all" ON audit_log
  FOR SELECT
  USING (true);

-- Create RLS policy - allow authenticated users to insert
CREATE POLICY "Allow insert audit_log for authenticated" ON audit_log
  FOR INSERT
  WITH CHECK (true);
