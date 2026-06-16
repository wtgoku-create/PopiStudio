export type AgentSource = 'custom' | 'preset';

export interface AgentSubagentConfig {
  agentId: string;
  label: string;
  description: string;
  enabled: boolean;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  identity: string;
  model: string;
  workingDirectory: string;
  icon: string;
  skillIds: string[];
  subagents: AgentSubagentConfig[];
  enabled: boolean;
  pinned: boolean;
  pinOrder?: number | null;
  isDefault: boolean;
  source: AgentSource;
  presetId: string;
  createdAt: number;
  updatedAt: number;
}

export interface PresetAgent {
  id: string;
  name: string;
  nameEn: string;
  icon: string;
  description: string;
  descriptionEn: string;
  identity?: string;
  identityEn?: string;
  systemPrompt: string;
  systemPromptEn: string;
  skillIds: string[];
  installed?: boolean;
}

export interface CreateAgentRequest {
  id?: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  identity?: string;
  model?: string;
  workingDirectory?: string;
  icon?: string;
  skillIds?: string[];
  subagents?: AgentSubagentConfig[];
  source?: string;
  presetId?: string;
}

export interface UpdateAgentRequest {
  name?: string;
  description?: string;
  systemPrompt?: string;
  identity?: string;
  model?: string;
  workingDirectory?: string;
  icon?: string;
  skillIds?: string[];
  subagents?: AgentSubagentConfig[];
  enabled?: boolean;
  pinned?: boolean;
}
