export const AgentSidebarIndicator = {
  None: 'none',
  Running: 'running',
  CompletedUnread: 'completed_unread',
} as const;

export type AgentSidebarIndicator =
  typeof AgentSidebarIndicator[keyof typeof AgentSidebarIndicator];

export const AgentSidebarPreferenceKey = {
  State: 'myAgentSidebar.state',
} as const;

export const AgentSidebarTaskTab = {
  Main: 'main',
  Scheduled: 'scheduled',
} as const;

export type AgentSidebarTaskTab =
  typeof AgentSidebarTaskTab[keyof typeof AgentSidebarTaskTab];

export const AgentSidebarPageSize = {
  Preview: 20,
  AllBatch: 100,
} as const;
