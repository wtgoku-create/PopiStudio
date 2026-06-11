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

export const AgentSidebarPageSize = {
  Preview: 1,
  AllBatch: 100,
} as const;
