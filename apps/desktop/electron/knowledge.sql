CREATE TABLE IF NOT EXISTS desktop_knowledge_scopes (
  id TEXT PRIMARY KEY, project TEXT NOT NULL, environment TEXT NOT NULL, role TEXT NOT NULL, application TEXT NOT NULL,
  UNIQUE(project,environment,role,application)
);
CREATE TABLE IF NOT EXISTS desktop_workflows (
  id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES desktop_knowledge_scopes(id), operation_key TEXT NOT NULL,
  description TEXT NOT NULL, UNIQUE(scope_id,operation_key)
);
CREATE VIRTUAL TABLE IF NOT EXISTS desktop_workflow_search USING fts5(workflow_id UNINDEXED, description);
CREATE TABLE IF NOT EXISTS desktop_knowledge_revisions (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES desktop_workflows(id), number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('VERIFIED','CANDIDATE')), steps_json TEXT NOT NULL,
  execution_id TEXT NOT NULL REFERENCES desktop_plan_executions(id), scenario_id TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(workflow_id,number)
);
CREATE TABLE IF NOT EXISTS desktop_knowledge_verifications (
  id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES desktop_knowledge_revisions(id),
  execution_id TEXT NOT NULL REFERENCES desktop_plan_executions(id), scenario_id TEXT NOT NULL,
  outcome TEXT NOT NULL, reused_steps INTEGER NOT NULL, metrics_json TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(execution_id,scenario_id)
);
CREATE TABLE IF NOT EXISTS desktop_knowledge_findings (
  id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES desktop_knowledge_revisions(id),
  execution_id TEXT NOT NULL REFERENCES desktop_plan_executions(id), scenario_id TEXT NOT NULL,
  step_number INTEGER NOT NULL, evidence_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
);
