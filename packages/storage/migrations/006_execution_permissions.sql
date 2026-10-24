-- A workflow marker separates proposal-time policy hints from executable authority.
CREATE TABLE permission_workflows(plan_revision_id TEXT PRIMARY KEY REFERENCES plan_revisions(id), created_at INTEGER NOT NULL) STRICT;
CREATE TABLE permission_decisions(
 id TEXT PRIMARY KEY,
 plan_revision_id TEXT NOT NULL REFERENCES permission_workflows(plan_revision_id),
 plan_hash TEXT NOT NULL,
 scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
 permission_id TEXT NOT NULL,
 request_json TEXT NOT NULL CHECK(json_valid(request_json)),
 decision TEXT NOT NULL CHECK(decision IN ('allow','deny')),
 reviewer TEXT NOT NULL,
 decided_at INTEGER NOT NULL
) STRICT;
CREATE INDEX permission_decisions_plan ON permission_decisions(plan_revision_id,permission_id);
CREATE TRIGGER permission_decisions_no_update BEFORE UPDATE ON permission_decisions BEGIN SELECT RAISE(ABORT, 'Immutable authorization history'); END;
CREATE TRIGGER permission_decisions_no_delete BEFORE DELETE ON permission_decisions BEGIN SELECT RAISE(ABORT, 'Immutable authorization history'); END;
CREATE TRIGGER permission_workflows_no_update BEFORE UPDATE ON permission_workflows BEGIN SELECT RAISE(ABORT, 'Immutable authorization workflow'); END;
CREATE TRIGGER permission_workflows_no_delete BEFORE DELETE ON permission_workflows BEGIN SELECT RAISE(ABORT, 'Immutable authorization workflow'); END;
