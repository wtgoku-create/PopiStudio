export const OpenClawSessionResponseUsage = {
  Off: 'off',
  Tokens: 'tokens',
  Full: 'full',
} as const;

export type OpenClawSessionResponseUsage =
  typeof OpenClawSessionResponseUsage[keyof typeof OpenClawSessionResponseUsage];

export const OpenClawSessionSendPolicy = {
  Allow: 'allow',
  Deny: 'deny',
} as const;

export type OpenClawSessionSendPolicy =
  typeof OpenClawSessionSendPolicy[keyof typeof OpenClawSessionSendPolicy];

export const OpenClawSessionReasoningLevel = {
  Off: 'off',
  On: 'on',
  Stream: 'stream',
} as const;

export type OpenClawSessionReasoningLevel =
  typeof OpenClawSessionReasoningLevel[keyof typeof OpenClawSessionReasoningLevel];

export const OpenClawSessionThinkingLevel = {
  Off: 'off',
  Medium: 'medium',
} as const;

export type OpenClawSessionThinkingLevel =
  typeof OpenClawSessionThinkingLevel[keyof typeof OpenClawSessionThinkingLevel];

export interface OpenClawSessionPatch {
  model?: string | null;
  thinkingLevel?: OpenClawSessionThinkingLevel | string | null;
  reasoningLevel?: OpenClawSessionReasoningLevel | string | null;
  elevatedLevel?: string | null;
  responseUsage?: OpenClawSessionResponseUsage | null;
  sendPolicy?: OpenClawSessionSendPolicy | null;
}
