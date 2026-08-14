import { CheckIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import React from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import type { SubagentSessionSummary } from '../../types/cowork';
import { getAgentDisplayName } from '../../utils/agentDisplay';

const SubagentSpawnCard: React.FC<{
  subagents: SubagentSessionSummary[];
  onSelectSubagent: (subagent: SubagentSessionSummary) => void;
}> = ({ subagents, onSelectSubagent }) => {
  const agents = useSelector((state: RootState) => state.agent.agents);

  if (subagents.length === 0) return null;

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border divide-y divide-border">
      {subagents.map(subagent => {
        const agent = subagent.agentId
          ? agents.find(candidate => candidate.id === subagent.agentId)
          : undefined;
        const displayName = subagent.label?.trim()
          || (agent ? getAgentDisplayName(agent) : null)
          || subagent.agentId?.trim()
          || i18nService.t('subagentUnnamed');

        return (
          <button
            key={subagent.id}
            type="button"
            onClick={() => onSelectSubagent(subagent)}
            className="group flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-raised/40"
            aria-label={displayName}
          >
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {displayName.slice(0, 1).toUpperCase() || 'S'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
                {subagent.status === 'running' && (
                  <span className="shimmer-text flex-shrink-0 text-xs text-secondary">
                    {i18nService.t('subagentRunning')}
                  </span>
                )}
                {subagent.status === 'error' && (
                  <span className="flex-shrink-0 text-xs text-red-500">
                    {i18nService.t('subagentFailed')}
                  </span>
                )}
                {subagent.status === 'done' && (
                  <span className="flex flex-shrink-0 items-center gap-1 text-xs text-muted">
                    <CheckIcon className="h-3 w-3 text-green-500" />
                    {i18nService.t('subagentCompleted')}
                  </span>
                )}
              </span>
              {subagent.task && (
                <span className="mt-0.5 block truncate text-xs text-muted">{subagent.task}</span>
              )}
            </span>
            <ChevronRightIcon className="h-3.5 w-3.5 flex-shrink-0 text-muted transition-colors group-hover:text-secondary" />
          </button>
        );
      })}
    </div>
  );
};

export default SubagentSpawnCard;
