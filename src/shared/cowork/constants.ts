/** Default page size for session list pagination. */
export const COWORK_SESSION_PAGE_SIZE = 50;

/** Default page size for message history pagination. */
export const COWORK_MESSAGE_PAGE_SIZE = 30;

export const CoworkSessionSourceKind = {
  AgentHome: 'agentHome',
  ScheduledTask: 'scheduledTask',
  IM: 'im',
} as const;

export type CoworkSessionSourceKind =
  typeof CoworkSessionSourceKind[keyof typeof CoworkSessionSourceKind];

export const CoworkSessionModeValue = {
  Single: 'single',
  Multi: 'multi',
} as const;

export type CoworkSessionMode =
  typeof CoworkSessionModeValue[keyof typeof CoworkSessionModeValue];

export const CoworkIpcChannel = {
  ListAgentSidebarSessions: 'cowork:session:listAgentSidebar',
} as const;

export type CoworkIpcChannel =
  typeof CoworkIpcChannel[keyof typeof CoworkIpcChannel];
