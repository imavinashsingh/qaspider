CREATE TABLE memory_change_sets (
 id TEXT PRIMARY KEY NOT NULL, base_scope_id TEXT NOT NULL REFERENCES navigation_scopes(id), head_scope_id TEXT NOT NULL REFERENCES navigation_scopes(id), data_json TEXT NOT NULL CHECK(json_valid(data_json))
) STRICT;
CREATE TABLE memory_candidates (
 id TEXT PRIMARY KEY NOT NULL, scope_id TEXT NOT NULL REFERENCES navigation_scopes(id), source TEXT NOT NULL, data_json TEXT NOT NULL CHECK(json_valid(data_json))
) STRICT;
CREATE TABLE memory_revisions (
 id TEXT PRIMARY KEY NOT NULL, scope_id TEXT NOT NULL REFERENCES navigation_scopes(id), parent_id TEXT REFERENCES memory_revisions(id), data_json TEXT NOT NULL CHECK(json_valid(data_json))
) STRICT;
CREATE INDEX memory_candidates_scope ON memory_candidates(scope_id);
CREATE INDEX memory_revisions_scope ON memory_revisions(scope_id);
CREATE TRIGGER memory_changes_no_update BEFORE UPDATE ON memory_change_sets BEGIN SELECT RAISE(ABORT,'immutable memory change set'); END;
CREATE TRIGGER memory_changes_no_delete BEFORE DELETE ON memory_change_sets BEGIN SELECT RAISE(ABORT,'immutable memory change set'); END;
CREATE TRIGGER memory_candidates_no_update BEFORE UPDATE ON memory_candidates BEGIN SELECT RAISE(ABORT,'immutable memory candidate'); END;
CREATE TRIGGER memory_candidates_no_delete BEFORE DELETE ON memory_candidates BEGIN SELECT RAISE(ABORT,'immutable memory candidate'); END;
CREATE TRIGGER memory_revisions_no_update BEFORE UPDATE ON memory_revisions BEGIN SELECT RAISE(ABORT,'immutable memory revision'); END;
CREATE TRIGGER memory_revisions_no_delete BEFORE DELETE ON memory_revisions BEGIN SELECT RAISE(ABORT,'immutable memory revision'); END;
CREATE TRIGGER navigation_approvals_no_update BEFORE UPDATE ON navigation_approvals BEGIN SELECT RAISE(ABORT,'immutable navigation approval'); END;
CREATE TRIGGER navigation_approvals_no_delete BEFORE DELETE ON navigation_approvals BEGIN SELECT RAISE(ABORT,'immutable navigation approval'); END;
CREATE TRIGGER navigation_verifications_no_update BEFORE UPDATE ON navigation_verifications BEGIN SELECT RAISE(ABORT,'immutable navigation verification'); END;
CREATE TRIGGER navigation_verifications_no_delete BEFORE DELETE ON navigation_verifications BEGIN SELECT RAISE(ABORT,'immutable navigation verification'); END;
