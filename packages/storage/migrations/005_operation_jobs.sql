CREATE TABLE operation_jobs (
 id TEXT PRIMARY KEY NOT NULL,
 scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
 kind TEXT NOT NULL CHECK(kind IN ('map','explore')),
 status TEXT NOT NULL CHECK(status IN ('running','complete','failed','cancelled','interrupted')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json))
) STRICT;
