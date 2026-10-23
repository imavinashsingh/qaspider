CREATE TABLE applications (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE CHECK(length(trim(name)) > 0)
) STRICT;
CREATE TABLE environments (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL REFERENCES applications(id),
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  kind TEXT NOT NULL CHECK(kind IN ('development', 'qa', 'production')),
  allowed_origins TEXT NOT NULL CHECK(json_valid(allowed_origins) AND json_type(allowed_origins) = 'array' AND json_array_length(allowed_origins) > 0),
  UNIQUE(application_id, name)
) STRICT;
CREATE TABLE role_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  environment_id TEXT NOT NULL REFERENCES environments(id),
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  auth TEXT NOT NULL CHECK(json_valid(auth)),
  UNIQUE(environment_id, name)
) STRICT;
CREATE TABLE workspace_settings (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  retention_days INTEGER NOT NULL CHECK(retention_days BETWEEN 1 AND 3650),
  global_quota_bytes INTEGER NOT NULL CHECK(global_quota_bytes > 0),
  per_run_quota_bytes INTEGER NOT NULL CHECK(per_run_quota_bytes > 0 AND per_run_quota_bytes <= global_quota_bytes),
  capture_full_traces INTEGER NOT NULL CHECK(capture_full_traces IN (0, 1))
) STRICT;
INSERT INTO workspace_settings VALUES(1, 14, 10737418240, 1073741824, 1);
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('trace', 'screenshot', 'event-log')),
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at > created_at),
  active INTEGER NOT NULL CHECK(active IN (0, 1)),
  status TEXT NOT NULL CHECK(status IN ('available', 'expired', 'deleted'))
) STRICT;
CREATE INDEX artifacts_retention ON artifacts(status, active, expires_at);
CREATE INDEX artifacts_run ON artifacts(run_id, status);
