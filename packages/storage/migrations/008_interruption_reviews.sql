CREATE TABLE interruption_reviews(
 run_id TEXT PRIMARY KEY REFERENCES test_runs(id),
 plan_hash TEXT NOT NULL,
 scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
 reviewer TEXT NOT NULL,
 notes TEXT NOT NULL,
 reviewed_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER interruption_reviews_no_update BEFORE UPDATE ON interruption_reviews BEGIN SELECT RAISE(ABORT,'Immutable interruption review'); END;
CREATE TRIGGER interruption_reviews_no_delete BEFORE DELETE ON interruption_reviews BEGIN SELECT RAISE(ABORT,'Immutable interruption review'); END;
