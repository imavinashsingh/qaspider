import type { ReviewReply, ReviewSnapshot } from './review-types.js';
import type { TicketReport } from './execution-types.js';
export interface ApplicationContext { mode: 'selected' | 'controlled'; url: string }
export interface Conversation {
  id: string; projectId: string; title: string; version: number; context: ApplicationContext;
  messages: { id: string; role: 'user' | 'assistant'; body: string; planId: string | null; reportId: string | null; createdAt: string }[];
}
export interface Project { id: string; title: string; conversations: { id: string; title: string }[] }
export interface DesktopSettings { provider: 'codex' | 'none'; model: string; headless: boolean; chromePath: string }
export interface ChatBridge {
  projects: () => Promise<ReviewReply<Project[]>>;
  createProject: (request: { title: string }) => Promise<ReviewReply<string>>;
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
