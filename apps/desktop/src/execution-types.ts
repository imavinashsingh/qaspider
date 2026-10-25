import type { ReviewReply } from './review-types.js';
export interface ExecutionIdentity { planId: string; revision: number; version: number; hash: string }
export interface Compatibility {
  scenarioId: string; title: string; classification: string;
  checks: { source: string; classification: string; reason: string }[];
}
export interface Preparation {
  preparationId: string; environment: 'owned-login-fixture' | 'owned-qa-fixtures' | 'user-selected-application'; origin: string; expiresAt: string;
  fixturesReady: boolean; compatibility: Compatibility[];
}
export interface TicketReport {
  id: string; planId: string; title: string; revision: number; hash: string; status: string; outcome: string;
  environment: string; origin: string; startedAt: string; completedAt?: string; gaps: string[];
  coverage: { criterionId: string; text: string; planned: string; executed: string; verified: boolean }[];
  scenarios: { scenarioId: string; title: string; status: string; outcome: string; message?: string; startedAt?: string; completedAt?: string;
    result?: { knowledge?: { metrics: { reusedSteps: number; aiCalls: number; discoveryCalls: number; durationMs: number; totalTokens: number | null } }; adaptations?: { requested: string; actualNames: string[]; resolvedSelector: string; evidenceId?: string }[]; assertionsExecuted: number; browserClosed: boolean; steps: { number: number; kind: string; resolvedTarget?: string; outcome: string; expected?: unknown; actual?: unknown; message: string; evidenceId?: string }[]; evidence: { id: string; stepNumber: number; screenshot: string; url: string }[] };
  }[];
}
export interface ExecutionBridge {
  preparePlan: (input: ExecutionIdentity & { url?: string }) => Promise<ReviewReply<Preparation>>;
  executePlan: (input: ExecutionIdentity & { preparationId: string; environment: Preparation['environment']; origin: string; authorized: true }) => Promise<ReviewReply<TicketReport>>;
  planReports: (input: { planId: string; revision: number }) => Promise<ReviewReply<TicketReport[]>>;
}
