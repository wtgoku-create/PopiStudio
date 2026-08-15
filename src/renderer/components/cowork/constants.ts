export const CoworkUiEvent = {
  OpenShareOptions: 'cowork:open-share-options',
  SelectSubagent: 'cowork:select-subagent',
  CollapseCurrentAgentTasks: 'cowork:collapse-current-agent-tasks',
} as const;

export type CoworkUiEvent = typeof CoworkUiEvent[keyof typeof CoworkUiEvent];

export interface CoworkOpenShareOptionsEventDetail {
  sessionId: string;
}
