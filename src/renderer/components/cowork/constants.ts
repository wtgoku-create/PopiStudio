export const CoworkUiEvent = {
  OpenShareOptions: 'cowork:open-share-options',
  SelectSubagent: 'cowork:select-subagent',
  SessionSummaryChanged: 'cowork:session-summary-changed',
} as const;

export type CoworkUiEvent = typeof CoworkUiEvent[keyof typeof CoworkUiEvent];

export interface CoworkOpenShareOptionsEventDetail {
  sessionId: string;
}

export interface CoworkSessionSummaryChangedEventDetail {
  sessionId: string;
  agentId: string;
}
