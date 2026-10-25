import type { TicketPlan } from './TicketPlanning.js';
import type { ExecutionBridge } from './execution-types.js';
export interface ExecutionBinding {
  context: { projectId: string; mode: 'selected' | 'controlled'; url: string };
  note: string;
  initialState?: { selector: string; name: string; empty: boolean; enabled: boolean }[];
  scenarios: {
    scenarioId: string; planJson: string;
    assertionSources: { index: number; description: string; assertionJson: string }[];
    prerequisites: { description: string; resolution: 'navigation' | 'setup' | 'unresolved'; stepNumbers: number[] }[];
    blockers: string[];
  }[];
}
export interface ReviewContent {
  scenarios: TicketPlan['scenarios'];
  assumptions: { id: string; decision: 'unresolved' | 'confirmed' | 'rejected'; note: string }[];
  criteria: { criterionId: string; confirmed: boolean; note: string }[];
  executionRequired?: true;
  execution?: ExecutionBinding;
}
export interface ReviewSnapshot {
  planId: string; revision: number; version: number; status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED'; hash: string;
  original: TicketPlan; content: ReviewContent;
  coverage: { criterionId: string; text: string; scenarioIds: string[]; planned: string; blockingAssumptionIds: string[]; executed: string }[];
  issues: string[];
  approvals: { id: string; revision: number; hash: string; approvedAt: string; reviewer: string }[];
  revisions: { number: number; status: string }[];
  events: { revision: number; type: string; details: unknown; createdAt: string }[];
}
export type ReviewAction =
  | { type: 'edit-scenario'; scenarioId: string; title: string; steps: TicketPlan['scenarios'][number]['steps']; assertionDescriptions: string[] }
  | { type: 'remove-scenario'; scenarioId: string }
  | { type: 'assumption'; id: string; decision: 'unresolved' | 'confirmed' | 'rejected'; note: string }
  | { type: 'criterion'; criterionId: string; confirmed: boolean; note: string }
  | { type: 'confirm-execution'; note: string }
  | { type: 'start-review' } | { type: 'fork' } | { type: 'approve'; hash: string };
export type ReviewReply<T> = { status: 'ok'; value: T } | { status: 'error'; message: string };
export interface SavedPlan { id: string; title: string; revision: number; status: string }
export interface ReviewBridge extends ExecutionBridge {
  listPlans: () => Promise<ReviewReply<SavedPlan[]>>;
  getPlan: (input: { planId: string; revision?: number }) => Promise<ReviewReply<ReviewSnapshot>>;
  reviewPlan: (input: { planId: string; revision: number; version: number; action: ReviewAction }) => Promise<ReviewReply<ReviewSnapshot>>;
}
