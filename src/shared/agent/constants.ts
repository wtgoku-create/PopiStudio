export const AgentId = {
  Main: 'main',
} as const;

export type AgentId = typeof AgentId[keyof typeof AgentId];

export const AgentIpcChannel = {
  List: 'agents:list',
  Get: 'agents:get',
  Create: 'agents:create',
  Update: 'agents:update',
  Delete: 'agents:delete',
  Presets: 'agents:presets',
  PresetTemplates: 'agents:presetTemplates',
  AddPreset: 'agents:addPreset',
} as const;

export type AgentIpcChannel = typeof AgentIpcChannel[keyof typeof AgentIpcChannel];

export const LegacyAgentName = {
  Main: 'main',
} as const;

export const DefaultAgentProfile = {
  Name: 'Popiai',
  Description: '7×24 小时帮你干活的全场景个人助理 Agent',
} as const;
