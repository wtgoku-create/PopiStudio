import path from 'path';

import { AgentId } from '../shared/agent';

export const resolveMainAgentWorkingDirectory = (workingDirectoryRoot: string): string => {
  return path.join(workingDirectoryRoot.trim(), AgentId.Main);
};
