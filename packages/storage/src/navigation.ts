import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { approvalSchema, scopeSchema, scopeId, hash, navigationConfigSchema, navigationActionSchema, normalizeObservation, normalizeUrl, httpUrlSchema, isSafeNavigation, type Scope, type NavigationRepository, type NavigationScope, type NavigationConfig, type NormalizedObservation, type UIState, type Transition, type NavigationAction, type NavigationGraph, type NavigationRun, type NavigationApproval, type Environment, type RoleProfile } from '../../core/src/index.js';
type Row = Record<string, unknown>;
export class SqliteNavigationRepository implements NavigationRepository {
  constructor(private readonly db: Database.Database, private readonly environment: (id: string) => Environment | undefined, private readonly role: (id: string) => RoleProfile | undefined) {}
  private atomic<T>(operation: () => T): T { return this.db.transaction(operation).immediate(); }
  private assertScope(scope: Scope) {
    scopeSchema.parse(scope); const environment = this.environment(scope.environmentId); const role = this.role(scope.roleId);
    if (!environment || environment.applicationId !== scope.applicationId || !role || role.environmentId !== scope.environmentId) throw new Error('Invalid application/environment/role scope');
    return environment;
  }
  private scoped(scope: Scope): NavigationScope {
    this.assertScope(scope); const row = this.db.prepare('SELECT * FROM navigation_scopes WHERE id = ?').get(scopeId(scope)) as Row | undefined;
    if (!row) throw new Error('Unknown navigation scope'); return this.scope(row);
  }
  private scope(row: Row): NavigationScope { return { id: String(row.id), scope: scopeSchema.parse(JSON.parse(String(row.scope_json))), seedUrl: String(row.seed_url), config: navigationConfigSchema.parse(JSON.parse(String(row.config_json))) }; }
  ensureScope(scope: Scope, seedUrl: string, input: NavigationConfig): NavigationScope {
    const env = this.assertScope(scope); const config = navigationConfigSchema.parse(input); httpUrlSchema.parse(seedUrl);
    if (!isSafeNavigation({ kind: 'link', locator: { kind: 'role', role: 'link', name: 'Entry' }, targetUrl: seedUrl }, env.allowedOrigins, config)) throw new Error('Unsafe seed URL');
    if (config.auth && (![config.auth.url, config.auth.submitUrl].every(url => env.allowedOrigins.includes(new URL(url).origin)))) throw new Error('Authentication origin is not allowed');
    if (scope.tenant !== 'public' && !config.auth?.tenantReady) throw new Error('Non-public tenants require an explicit tenant assertion');
    const id = scopeId(scope); const previous = this.db.prepare('SELECT * FROM navigation_scopes WHERE id = ?').get(id) as Row | undefined;
    const canonical = normalizeUrl(seedUrl, config);
    if (previous && (String(previous.seed_url) !== canonical || hash(navigationConfigSchema.parse(JSON.parse(String(previous.config_json)))) !== hash(config))) throw new Error('Scope configuration changed; use a new build');
    this.db.prepare('INSERT OR IGNORE INTO navigation_scopes VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, scope.applicationId, scope.environmentId, scope.roleId, JSON.stringify(scope), canonical, JSON.stringify(config));
    return this.scoped(scope);
  }
  listScopes(): NavigationScope[] { return (this.db.prepare('SELECT * FROM navigation_scopes ORDER BY id').all() as Row[]).map(row => this.scope(row)); }
  private assertEvidence(scope: Scope, evidenceId: string, runId?: string) {
    const row = this.db.prepare("SELECT a.run_id FROM artifacts a JOIN navigation_runs r ON r.id = a.run_id WHERE a.id = ? AND r.scope_id = ? AND a.status = 'available'").get(evidenceId, scopeId(scope)) as Row | undefined;
    if (!row || (runId && row.run_id !== runId)) throw new Error('Missing or cross-scope evidence');
  }
  private state(row: Row): UIState { return { id: String(row.id), scopeId: String(row.scope_id), locationId: String(row.location_id), observation: JSON.parse(String(row.observation_json)) as NormalizedObservation, evidenceId: String(row.evidence_id), observedAt: Number(row.observed_at) }; }
  saveState(scope: Scope, observation: NormalizedObservation, evidenceId: string): UIState {
    return this.atomic(() => {
      const record = this.scoped(scope); this.assertEvidence(scope, evidenceId);
      httpUrlSchema.parse(observation.url); if (!this.assertScope(scope).allowedOrigins.includes(new URL(observation.url).origin)) throw new Error('State origin is not allowed');
      if (normalizeObservation(observation, record.config).fingerprint !== observation.fingerprint) throw new Error('Invalid state fingerprint');
      const locationId = hash([record.id, observation.url]); const id = hash([record.id, observation.fingerprint]);
      this.db.prepare('INSERT OR IGNORE INTO ui_locations VALUES (?, ?, ?)').run(locationId, record.id, observation.url);
      this.db.prepare('INSERT INTO ui_states VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET evidence_id = excluded.evidence_id, observed_at = excluded.observed_at').run(id, record.id, locationId, observation.fingerprint, JSON.stringify(observation), evidenceId, Date.now());
      return this.state(this.db.prepare('SELECT * FROM ui_states WHERE id = ?').get(id) as Row);
    });
  }
  private transition(row: Row): Transition { return { id: String(row.id), scopeId: String(row.scope_id), fromStateId: String(row.from_state_id), toStateId: String(row.to_state_id), action: navigationActionSchema.parse(JSON.parse(String(row.action_json))), precondition: JSON.parse(String(row.precondition_json)) as Transition['precondition'], postcondition: JSON.parse(String(row.postcondition_json)) as Transition['postcondition'], status: row.status as Transition['status'], successes: Number(row.successes), failures: Number(row.failures), verifiedAt: row.verified_at === null ? null : Number(row.verified_at), evidenceId: row.evidence_id === null ? null : String(row.evidence_id) }; }
  saveTransition(scope: Scope, fromStateId: string, toStateId: string, input: NavigationAction): Transition {
    return this.atomic(() => {
      const record = this.scoped(scope); const action = navigationActionSchema.parse(input);
      if (!isSafeNavigation(action, this.assertScope(scope).allowedOrigins, record.config)) throw new Error('Unsafe navigation action');
      const states = [fromStateId, toStateId].map(id => this.db.prepare('SELECT * FROM ui_states WHERE id = ? AND scope_id = ?').get(id, record.id) as Row | undefined);
      if (!states[0] || !states[1]) throw new Error('Cross-scope state reference');
      const condition = (row: Row) => { const state = this.state(row); return { url: state.observation.url, fingerprint: state.observation.fingerprint, headings: state.observation.headings }; };
      const actionId = hash([record.id, action]); const id = hash([record.id, fromStateId, toStateId, actionId]);
      this.db.prepare('INSERT OR IGNORE INTO navigation_actions VALUES (?, ?, ?)').run(actionId, record.id, JSON.stringify(action));
      this.db.prepare("INSERT OR IGNORE INTO navigation_transitions(id,scope_id,from_state_id,to_state_id,action_id,precondition_json,postcondition_json,status) VALUES (?,?,?,?,?,?,?,'candidate')").run(id, record.id, fromStateId, toStateId, actionId, JSON.stringify(condition(states[0])), JSON.stringify(condition(states[1])));
      return this.snapshot(scope).transitions.find(edge => edge.id === id)!;
    });
  }
  private run(row: Row): NavigationRun { return { id: String(row.id), scopeId: String(row.scope_id), kind: row.kind as NavigationRun['kind'], status: row.status as NavigationRun['status'], startedAt: Number(row.started_at), finishedAt: row.finished_at === null ? null : Number(row.finished_at), actions: Number(row.actions), requests: Number(row.requests), states: Number(row.states), message: String(row.message), evidenceIds: JSON.parse(String(row.evidence_ids)) as string[] }; }
  startRun(scope: Scope, kind: 'map' | 'replay'): NavigationRun {
    const record = this.scoped(scope); const id = randomUUID(); this.db.prepare("INSERT INTO navigation_runs(id,scope_id,kind,status,started_at) VALUES (?,?,?,'running',?)").run(id, record.id, kind, Date.now());
    return this.run(this.db.prepare('SELECT * FROM navigation_runs WHERE id = ?').get(id) as Row);
  }
  finishRun(id: string, result: Pick<NavigationRun, 'status' | 'actions' | 'requests' | 'states' | 'message' | 'evidenceIds'>): NavigationRun {
    this.db.prepare('UPDATE navigation_runs SET status=?,finished_at=?,actions=?,requests=?,states=?,message=?,evidence_ids=? WHERE id=?').run(result.status, Date.now(), result.actions, result.requests, result.states, result.message, JSON.stringify(result.evidenceIds), id);
    const row = this.db.prepare('SELECT * FROM navigation_runs WHERE id=?').get(id) as Row | undefined; if (!row) throw new Error('Unknown navigation run'); return this.run(row);
  }
  recordVerification(scope: Scope, transitionId: string, runId: string, evidenceId: string, passed: boolean): void {
    this.atomic(() => {
      this.scoped(scope); this.assertEvidence(scope, evidenceId, runId);
      const edge = this.snapshot(scope).transitions.find(item => item.id === transitionId); if (!edge) throw new Error('Unknown scoped transition');
      const time = Date.now();
      this.db.prepare('INSERT INTO navigation_verifications VALUES (?,?,?,?,?,?,?)').run(randomUUID(), scopeId(scope), transitionId, runId, evidenceId, Number(passed), time);
      const status = passed ? (edge.status === 'approved' ? 'approved' : 'verified') : 'suspect';
      this.db.prepare('UPDATE navigation_transitions SET status=?,successes=successes+?,failures=failures+?,verified_at=?,evidence_id=? WHERE id=?').run(status, Number(passed), Number(!passed), time, evidenceId, transitionId);
    });
  }
  approveBatch(scope: Scope, transitionIds: string[], approvedBy: string): NavigationApproval {
    approvalSchema.parse({ kind: 'navigation-batch', scope, candidateIds: transitionIds, approvedBy });
    return this.atomic(() => {
      const graph = this.snapshot(scope); if (!graph.scope) throw new Error('Unknown navigation scope');
      for (const id of transitionIds) {
        const edge = graph.transitions.find(edge => edge.id === id);
        if (!edge || !['verified', 'approved'].includes(edge.status) || !edge.evidenceId || !edge.successes || !isSafeNavigation(edge.action, this.assertScope(scope).allowedOrigins, graph.scope.config)) throw new Error('Batch contains unverified, unsafe or cross-scope transition');
        this.assertEvidence(scope, edge.evidenceId);
      }
      const item: NavigationApproval = { id: randomUUID(), scopeId: graph.scope.id, transitionIds, approvedBy, approvedAt: Date.now() };
      this.db.prepare('INSERT INTO navigation_approvals VALUES (?,?,?,?,?)').run(item.id, item.scopeId, item.approvedBy, item.approvedAt, JSON.stringify(item.transitionIds));
      const statement = this.db.prepare("UPDATE navigation_transitions SET status='approved' WHERE id=? AND scope_id=?"); for (const id of transitionIds) statement.run(id, item.scopeId); return item;
    });
  }
  snapshot(scope: Scope): NavigationGraph {
    this.assertScope(scope); const id = scopeId(scope); const row = this.db.prepare('SELECT * FROM navigation_scopes WHERE id=?').get(id) as Row | undefined;
    return {
      scope: row ? this.scope(row) : null,
      locations: (this.db.prepare('SELECT * FROM ui_locations WHERE scope_id=? ORDER BY id').all(id) as Row[]).map(row => ({ id: String(row.id), scopeId: id, url: String(row.url) })),
      states: (this.db.prepare('SELECT * FROM ui_states WHERE scope_id=? ORDER BY id').all(id) as Row[]).map(row => this.state(row)),
      transitions: (this.db.prepare('SELECT t.*, a.action_json FROM navigation_transitions t JOIN navigation_actions a ON a.id=t.action_id WHERE t.scope_id=? ORDER BY t.id').all(id) as Row[]).map(row => this.transition(row)),
      approvals: (this.db.prepare('SELECT * FROM navigation_approvals WHERE scope_id=? ORDER BY approved_at').all(id) as Row[]).map(row => ({ id: String(row.id), scopeId: id, approvedBy: String(row.approved_by), approvedAt: Number(row.approved_at), transitionIds: JSON.parse(String(row.transition_ids)) as string[] })),
      runs: (this.db.prepare('SELECT * FROM navigation_runs WHERE scope_id=? ORDER BY started_at').all(id) as Row[]).map(row => this.run(row))
    };
  }
}
