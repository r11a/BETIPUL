CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'therapist' CHECK (role IN ('admin','therapist','office','finance','supervisor','viewer')),
  ha_user_id TEXT UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  contact_name_enc TEXT,
  contact_email_enc TEXT,
  contact_phone_enc TEXT,
  billing_terms TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name_enc TEXT NOT NULL,
  id_number_enc TEXT,
  birth_date_enc TEXT,
  phone_enc TEXT,
  email_enc TEXT,
  address_enc TEXT,
  emergency_contact_enc TEXT,
  contact_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE care_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  case_type TEXT NOT NULL CHECK (case_type IN ('individual','couple','family','group')),
  title_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'intake' CHECK (status IN ('intake','active','paused','completed','archived')),
  lead_therapist_id UUID REFERENCES users(id),
  organization_id UUID REFERENCES organizations(id),
  payer_type TEXT NOT NULL DEFAULT 'private' CHECK (payer_type IN ('private','organization','mixed')),
  default_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  session_minutes INTEGER NOT NULL DEFAULT 50 CHECK (session_minutes BETWEEN 15 AND 240),
  opened_at DATE NOT NULL DEFAULT CURRENT_DATE,
  closed_at DATE,
  referral_enc TEXT,
  clinical_summary_enc TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE case_participants (
  case_id UUID REFERENCES care_cases(id) ON DELETE CASCADE,
  person_id UUID REFERENCES people(id) ON DELETE RESTRICT,
  participant_role TEXT NOT NULL DEFAULT 'client',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  billing_responsible BOOLEAN NOT NULL DEFAULT FALSE,
  consent_status TEXT NOT NULL DEFAULT 'pending' CHECK (consent_status IN ('pending','received','declined','expired')),
  joined_at DATE NOT NULL DEFAULT CURRENT_DATE,
  left_at DATE,
  PRIMARY KEY(case_id, person_id)
);

CREATE TABLE case_access (
  case_id UUID REFERENCES care_cases(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'clinical' CHECK (access_level IN ('administrative','clinical','supervision')),
  granted_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(case_id, user_id)
);

CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES care_cases(id) ON DELETE RESTRICT,
  therapist_id UUID NOT NULL REFERENCES users(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  location_type TEXT NOT NULL DEFAULT 'clinic' CHECK (location_type IN ('clinic','online','home','other')),
  location_enc TEXT,
  meeting_url_enc TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','completed','cancelled','no_show')),
  attendance TEXT NOT NULL DEFAULT 'planned',
  fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid','waived')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE clinical_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES care_cases(id) ON DELETE RESTRICT,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  author_id UUID NOT NULL REFERENCES users(id),
  template TEXT NOT NULL DEFAULT 'free' CHECK (template IN ('free','soap','dap','birp','intake','summary')),
  content_enc TEXT NOT NULL,
  risk_enc TEXT,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','signed','amended')),
  version INTEGER NOT NULL DEFAULT 1,
  signed_at TIMESTAMPTZ,
  signed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE treatment_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES care_cases(id) ON DELETE CASCADE,
  description_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','paused','cancelled')),
  target_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES care_cases(id) ON DELETE CASCADE,
  person_id UUID REFERENCES people(id) ON DELETE SET NULL,
  consent_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  granted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  evidence_enc TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES care_cases(id) ON DELETE RESTRICT,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('charge','payment','refund','adjustment')),
  amount NUMERIC(12,2) NOT NULL,
  occurred_at DATE NOT NULL DEFAULT CURRENT_DATE,
  reference TEXT NOT NULL DEFAULT '',
  notes_enc TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES care_cases(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES users(id),
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX appointments_time_idx ON appointments(starts_at);
CREATE INDEX appointments_case_idx ON appointments(case_id);
CREATE INDEX notes_case_idx ON clinical_notes(case_id, created_at DESC);
CREATE INDEX cases_status_idx ON care_cases(status);
CREATE INDEX participants_person_idx ON case_participants(person_id);
CREATE INDEX audit_created_idx ON audit_log(created_at DESC);

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit log is append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

INSERT INTO app_settings(key,value) VALUES
  ('clinic', '{"name":"הקליניקה שלי","timezone":"Asia/Jerusalem","currency":"ILS"}'),
  ('backupPolicy', '{"enabled":false,"frequency":"daily","retention":14,"hour":"02:00","destination":"share","relativePath":"BETIPUL/Backups"}')
ON CONFLICT DO NOTHING;
