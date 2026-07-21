/** Default page size for session list pagination. */
export const COWORK_SESSION_PAGE_SIZE = 50;

/** Default page size for message history pagination. */
export const COWORK_MESSAGE_PAGE_SIZE = 30;

/**
 * Sentinel sessionId for permission requests that arrive without a resolvable
 * OpenClaw session key, such as AskUserQuestion callbacks missing sessionKey.
 */
export const SESSION_AGNOSTIC_PERMISSION_SESSION_ID = '__session_agnostic_permission__';

export const ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion';

export const CoworkSessionSourceKind = {
  AgentHome: 'agentHome',
  ScheduledTask: 'scheduledTask',
  IM: 'im',
} as const;

export type CoworkSessionSourceKind =
  typeof CoworkSessionSourceKind[keyof typeof CoworkSessionSourceKind];

export const CoworkIpcChannel = {
  SessionsChanged: 'cowork:sessions:changed',
  ListAgentSidebarSessions: 'cowork:session:listAgentSidebar',
  GetMessageRailIndex: 'cowork:session:getMessageRailIndex',
  GetMessages: 'cowork:session:getMessages',
  SubTaskHistory: 'cowork:subTask:history',
  SubagentList: 'cowork:subagent:list',
  SubagentDelete: 'cowork:subagent:delete',
  GoalCommand: 'cowork:session:goalCommand',
  SubmitSteer: 'cowork:session:submitSteer',
  StreamGoal: 'cowork:stream:goal',
  SubagentMessagesChanged: 'cowork:subagent:messagesChanged',
  MarkSessionViewed: 'cowork:session:markViewed',
  OpenSessionFromNotification: 'cowork:session:openFromNotification',
} as const;

export type CoworkIpcChannel =
  typeof CoworkIpcChannel[keyof typeof CoworkIpcChannel];

export interface CoworkSessionsChangedPayload {
  sessionIds: string[];
}

export interface CoworkSubagentMessageChangedMessage {
  id: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface CoworkSubagentMessagesChangedEvent {
  parentSessionId: string;
  runId: string;
  sessionKey?: string;
  status?: 'running' | 'done' | 'error';
  messages?: CoworkSubagentMessageChangedMessage[];
}
