CREATE TABLE navigation_scopes (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL REFERENCES applications(id),
  environment_id TEXT NOT NULL REFERENCES environments(id),
  role_id TEXT NOT NULL REFERENCES role_profiles(id),
  scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
  seed_url TEXT NOT NULL,
  config_json TEXT NOT NULL CHECK(json_valid(config_json))
) STRICT;
CREATE TABLE ui_locations (
  id TEXT PRIMARY KEY NOT NULL,
  scope_id TEXT NOT NULL REFERENCES navigation_scopes(id),
  url TEXT NOT NULL,
  UNIQUE(scope_id, url), UNIQUE(scope_id, id)
) STRICT;
CREATE TABLE ui_states (
  id TEXT PRIMARY KEY NOT NULL,
  scope_id TEXT NOT NULL REFERENCES navigation_scopes(id),
  location_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  observation_json TEXT NOT NULL CHECK(json_valid(observation_json)),
  evidence_id TEXT NOT NULL REFERENCES artifacts(id),
  observed_at INTEGER NOT NULL,
  FOREIGN KEY(scope_id, location_id) REFERENCES ui_locations(scope_id, id),
  UNIQUE(scope_id, fingerprint), UNIQUE(scope_id, id)
) STRICT;
CREATE TABLE navigation_actions (
  id TEXT PRIMARY KEY NOT NULL,
  scope_id TEXT NOT NULL REFERENCES navigation_scopes(id),
  action_json TEXT NOT NULL CHECK(json_valid(action_json)),
  UNIQUE(scope_id, id)
) STRICT;
CREATE TABLE navigation_transitions (
  id TEXT PRIMARY KEY NOT NULL,
  scope_id TEXT NOT NULL REFERENCES navigation_scopes(id),
  from_state_id TEXT NOT NULL, to_state_id TEXT NOT NULL, action_id TEXT NOT NULL,
  precondition_json TEXT NOT NULL CHECK(json_valid(precondition_json)),
  postcondition_json TEXT NOT NULL CHECK(json_valid(postcondition_json)),
  status TEXT NOT NULL CHECK(status IN ('candidate', 'verified', 'approved', 'suspect')),
  successes INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER, evidence_id TEXT REFERENCES artifacts(id),
  FOREIGN KEY(scope_id, from_state_id) REFERENCES ui_states(scope_id, id),
  FOREIGN KEY(scope_id, to_state_id) REFERENCES ui_states(scope_id, id),
  FOREIGN KEY(scope_id, action_id) REFERENCES navigation_actions(scope_id, id)
) STRICT;
CREATE TABLE navigation_runs (
  id TEXT PRIMARY KEY NOT NULL, scope_id TEXT NOT NULL REFERENCES navigation_scopes(id),
  kind TEXT NOT NULL CHECK(kind IN ('map', 'replay')),
  status TEXT NOT NULL CHECK(status IN ('running', 'complete', 'budget-exhausted', 'cancelled', 'blocked', 'failed')),
  started_at INTEGER NOT NULL, finished_at INTEGER,
  actions INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0, states INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '', evidence_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_ids)),
  UNIQUE(scope_id, id)
) STRICT;
CREATE TABLE navigation_verifications (
  id TEXT PRIMARY KEY NOT NULL, scope_id TEXT NOT NULL REFERENCES navigation_scopes(id),
  transition_id TEXT NOT NULL REFERENCES navigation_transitions(id),
  run_id TEXT NOT NULL, evidence_id TEXT NOT NULL REFERENCES artifacts(id),
  passed INTEGER NOT NULL CHECK(passed IN (0,1)), checked_at INTEGER NOT NULL,
  FOREIGN KEY(scope_id, run_id) REFERENCES navigation_runs(scope_id, id)
) STRICT;
CREATE TABLE navigation_approvals (
  id TEXT PRIMARY KEY NOT NULL, scope_id TEXT NOT NULL REFERENCES navigation_scopes(id),
  approved_by TEXT NOT NULL, approved_at INTEGER NOT NULL,
  transition_ids TEXT NOT NULL CHECK(json_valid(transition_ids))
) STRICT;
CREATE INDEX navigation_transitions_scope ON navigation_transitions(scope_id, from_state_id, status);
