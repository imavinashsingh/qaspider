import type { ReviewReply, ReviewSnapshot } from './review-types.js';
import type { TicketReport } from './execution-types.js';
export interface ApplicationContext { mode: 'selected' | 'controlled'; url: string }
export interface Conversation {
  id: string; projectId: string; title: string; version: number; context: ApplicationContext;
  messages: { id: string; role: 'user' | 'assistant'; body: string; planId: string | null; reportId: string | null; createdAt: string }[];
}
export type ProjectTopic = 'purpose' | 'domain' | 'roles' | 'environments' | 'sources' | 'setup';
export interface ProjectProfile {
  id: string; title: string; description: string; agentId: string; archived: boolean; version: number;
  createdAt: string; updatedAt: string; skipped: ProjectTopic[];
  notes: { id: string; topic: ProjectTopic; body: string; authority: 'USER_STATEMENT'; createdAt: string }[];
  nextQuestion: { topic: ProjectTopic; text: string } | null;
}
export interface Project extends ProjectProfile { conversations: { id: string; title: string }[] }
export interface ProjectMutation { projectId: string; version: number; action:
  | { type: 'profile'; title: string; description: string }
  | { type: 'archive'; archived: boolean }
  | { type: 'note'; topic: ProjectTopic; text: string }
  | { type: 'skip'; topic: ProjectTopic }
}
export interface DesktopSettings { provider: 'codex' | 'none'; model: string; headless: boolean; chromePath: string }
export interface AgentScope { projectId: string; conversationId: string }
export interface AgentSource { id: string; kind: 'project' | 'note' | 'plan' | 'report' | 'workflow'; label: string }
export interface AgentHistory extends AgentScope {
  threadId: string | null; agentId: string;
  turns: { id: string; status: 'RUNNING' | 'COMPLETED' | 'UNAVAILABLE' | 'ERROR' | 'INTERRUPTED'; createdAt: string; completedAt: string | null; userText: string; reply: string | null; sources: AgentSource[]; metrics: { modelCalls?: number; totalTokens?: number | null; durationMs?: number } }[];
}
export interface AgentStatus {
  busy: boolean; laneBusy: boolean; phase: string; activeTurnId: string | null; error: string | null;
  qa: { planId: string; title: string; revision: number; reviewStatus: string; scenarioCount: number; reports: { reportId: string; outcome: string; status: string }[] }[];
}
export interface ChatBridge {
  agentStart: (scope: AgentScope) => Promise<ReviewReply<AgentHistory>>;
  agentSend: (request: AgentScope & { requestId: string; text: string }) => Promise<ReviewReply<AgentHistory>>;
  agentHistory: (scope: AgentScope) => Promise<ReviewReply<AgentHistory>>;
  agentStatus: (scope: AgentScope) => Promise<ReviewReply<AgentStatus>>;
  projects: () => Promise<ReviewReply<Project[]>>;
  createProject: (request: { title: string; description?: string }) => Promise<ReviewReply<string>>;
  projectProfile: (id: string) => Promise<ReviewReply<ProjectProfile>>;
  updateProject: (request: ProjectMutation) => Promise<ReviewReply<ProjectProfile>>;
  createConversation: (request: { projectId: string; title: string; context: ApplicationContext }) => Promise<ReviewReply<Conversation>>;
  conversation: (id: string) => Promise<ReviewReply<Conversation>>;
  report: (request: { planId: string; reportId: string }) => Promise<ReviewReply<TicketReport>>;
  setContext: (request: { conversationId: string; version: number; context: ApplicationContext }) => Promise<ReviewReply<Conversation>>;
  sendMessage: (request: { conversationId: string; text: string }) => Promise<ReviewReply<Conversation>>;
  prepareDraft: (request: { planId: string; revision: number; version: number }) => Promise<ReviewReply<ReviewSnapshot>>;
  operationStatus: () => Promise<ReviewReply<{ busy: boolean; channel?: string; startedAt?: string }>>;
  settings: () => Promise<ReviewReply<DesktopSettings> & { synthetic?: boolean }>;
  saveSettings: (request: DesktopSettings) => Promise<ReviewReply<DesktopSettings>>;
}
